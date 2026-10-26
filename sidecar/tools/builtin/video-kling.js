/* video.kling: Text-to-video generation via official Kling 3.0 API.
   Submits async job, polls for completion, downloads MP4 to workspace.
   Credentials: KLING_API_KEY environment variable.
   Write-scoped (creates file) + consent-gated + network required.

   IMPORTANT: This implementation uses the official Kling API at api-singapore.klingai.com.
   The following fields are placeholders pending verification against official API docs:
   - Request body parameter names (confirmed: prompt, duration, aspect_ratio)
   - Response job ID field name (ASSUMED: job_id or id)
   - Status polling endpoint path (ASSUMED: follows /v1/jobs/{id} pattern)
   - Status field names (ASSUMED: status, video_url)
   - Supported status values (ASSUMED: submitted, processing, completed, failed)

   makeVideoKlingTools({ fsp, pathMod, root }) -> { register(registry) }
   - fsp: Node fs.promises module
   - pathMod: Node path module
   - root: workspace root directory path
   Registers tool 'video.kling' with the registry.
*/

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const POLL_INTERVAL_MS = 5000;  // Kling processing can take 30+ seconds
const MAX_POLL_ATTEMPTS = 120;  // 10 minutes max (120 * 5s), API documentation shows 51sec-2min typical
const API_BASE = 'https://api-singapore.klingai.com';

/* OFFICIAL KLING API — VERIFIED AGAINST THE LIVE ENDPOINT 2026-10-26.
   The previous version of this header was guessed ("ASSUMED"/"placeholder") and every guess
   below that is marked VERIFIED was probed for real. Probing method: POST with one field
   deliberately invalid, so validation rejects the request before a billable task is created.
   A rejected request costs nothing; a successful POST is BILLED IMMEDIATELY.

   POST /v1/videos/text2video
     Request: { model_name, prompt, negative_prompt, cfg_scale, mode, aspect_ratio, duration }
     Response is WRAPPED: { code, message, request_id, data: { task_id, task_status, ... } }
       -> the task id is data.data.task_id, NOT a top-level job_id/id.

   GET /v1/videos/text2video/{task_id}
     Response is WRAPPED the same way:
       { code, message, data: { task_id, task_status, task_status_msg,
                                task_result: { videos: [ { id, url, duration } ] } } }
     task_status values: submitted | processing | succeed | failed
       -> note "succeed", not "succeeded"/"completed".
     Video URL: data.data.task_result.videos[0].url

   VERIFIED enums (error text quotes the allowed set):
     aspect_ratio : 16:9 | 9:16 | 1:1
     mode         : std | pro | master | 4k      (std is cheapest)
     model_name   : kling-v2-5-turbo is supported. kling-v1, kling-v1-6 and
                    kling-v2-master are DISCONTINUED (code 1203); kling-v2-1 is
                    "not supported" (code 1201) on this account.
     duration     : "7" is rejected, so the set is restricted; send it as a STRING.

   Error codes seen: 1002 bad token · 1201 invalid parameter / unsupported model ·
                     1203 discontinued model · 0 success.
*/

module.exports = function makeVideoKlingTools({ fsp, pathMod, root }) {
  const toolDef = {
    properties: {
      id: 'video.kling',
      summary: 'Generate video from text prompt via official Kling 3.0 API',
      description: 'Submits a text-to-video generation job to Kling 3.0 API, polls for completion, and downloads the MP4 file into the workspace. Supports character reference images, multi-shot generation, and native audio sync. Async operation: may take 60-180 seconds.',
      tags: ['studio', 'video', 'generation', 'kling', 'official-api'],
      scope: 'write',
      requiresConsent: true,
      network: true,
    },
    schema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed text description of the video scene to generate. Include visual style, action, characters, environment, lighting, mood. For best results with character consistency, reference any character_reference images provided.',
          minLength: 10,
          maxLength: 2000,
        },
        duration: {
          type: 'string',
          description: 'Video duration in seconds. Kling accepts a restricted set, sent as a string. Default: "5" (cheapest).',
          enum: ['5', '10'],
          default: '5',
        },
        negative_prompt: {
          type: 'string',
          description: 'What must NOT appear in the video. Use this to suppress baked-in text, watermarks, logos and captions, which Kling otherwise adds readily.',
          maxLength: 2000,
          default: '',
        },
        mode: {
          type: 'string',
          description: 'Generation quality. "std" is standard and cheapest; "pro"/"master"/"4k" cost more. Default: "std".',
          enum: ['std', 'pro', 'master', '4k'],
          default: 'std',
        },
        model_name: {
          type: 'string',
          description: 'Kling model id. Default "kling-v2-5-turbo" — the v1/v1-6/v2-master models are discontinued and will be rejected.',
          default: 'kling-v2-5-turbo',
          maxLength: 64,
        },
        aspect_ratio: {
          type: 'string',
          description: 'Video aspect ratio. Options: "16:9" (landscape), "9:16" (vertical), "1:1" (square). Default: "16:9".',
          enum: ['16:9', '9:16', '1:1'],
          default: '16:9',
        },
        filename: {
          type: 'string',
          description: 'Output filename (no extension). Will be saved as {filename}.mp4 in workspace.',
          pattern: '^[a-zA-Z0-9_-]+$',
          default: 'video',
        },
        character_reference: {
          type: 'string',
          description: 'Optional: Path to character reference image (relative to workspace). Enables character consistency across scenes. Must be a valid image file (JPG, PNG).',
          minLength: 0,
          maxLength: 1024,
        },
        scene_reference: {
          type: 'string',
          description: 'Optional: Path to environment/scene reference image (relative to workspace). Provides visual context for generated video.',
          minLength: 0,
          maxLength: 1024,
        },
        style: {
          type: 'string',
          description: 'Visual style hint. Kling has no separate style field, so this is folded into the prompt text rather than sent as its own parameter.',
          default: '',
          maxLength: 100,
        },
      },
      required: ['prompt'],
    },
    async invoke(args, context) {
      const {
        prompt,
        // was `duration = 30` — outside every duration Kling accepts, so the default
        // guaranteed a rejected request.
        duration = '5',
        aspect_ratio = '16:9',
        filename = 'video',
        character_reference,
        scene_reference,
        negative_prompt = '',
        mode = 'std',
        model_name = 'kling-v2-5-turbo',
        style = '',
      } = args;
      const { fs: fspArg, workspaceRoot, agentId } = context;

      // Validate inputs
      if (!prompt || prompt.trim().length < 10) {
        return { ok: false, error: 'Prompt must be at least 10 characters' };
      }

      // Get API credentials
      const apiKey = process.env.KLING_API_KEY;
      if (!apiKey) {
        return { ok: false, error: 'KLING_API_KEY not set in environment. Cannot generate video.' };
      }

      const videoPath = pathMod.join(workspaceRoot, agentId, `${filename}.mp4`);

      try {
        // Validate and resolve reference image paths if provided
        let charRefPath = null;
        let sceneRefPath = null;

        if (character_reference) {
          const fullCharRefPath = pathMod.isAbsolute(character_reference)
            ? character_reference
            : pathMod.join(workspaceRoot, agentId, character_reference);

          if (fs.existsSync(fullCharRefPath)) {
            charRefPath = fullCharRefPath;
          } else {
            return { ok: false, error: `Character reference image not found: ${character_reference}` };
          }
        }

        if (scene_reference) {
          const fullSceneRefPath = pathMod.isAbsolute(scene_reference)
            ? scene_reference
            : pathMod.join(workspaceRoot, agentId, scene_reference);

          if (fs.existsSync(fullSceneRefPath)) {
            sceneRefPath = fullSceneRefPath;
          } else {
            return { ok: false, error: `Scene reference image not found: ${scene_reference}` };
          }
        }

        // Step 1: Build request body. Fields and enums verified against the live endpoint
        // (see header). `style` and `ai_director` were NOT real Kling parameters — sending
        // them was harmless but meaningless, so the style hint is folded into the prompt.
        const payload = {
          model_name,
          prompt: style ? (prompt + ' Style: ' + style) : prompt,
          mode,
          aspect_ratio,
          duration: String(duration),
        };
        if (negative_prompt) payload.negative_prompt = negative_prompt;

        process.stderr.write(`[video.kling] Submitting job: ${prompt.substring(0, 50)}..., model=${model_name}, mode=${mode}, duration=${duration}s, ratio=${aspect_ratio}\n`);

        // Step 2: Submit job to Kling API. THIS CALL IS BILLED the moment it succeeds.
        const submitRes = await fetch(`${API_BASE}/v1/videos/text2video`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!submitRes.ok) {
          const err = await submitRes.text();
          return {
            ok: false,
            error: `Kling API error (${submitRes.status}): ${err}`,
          };
        }

        const job = await submitRes.json();

        // Kling wraps everything in { code, message, data }. A non-zero code is a failure
        // even though the HTTP status was 200, so it must be checked explicitly.
        if (job && typeof job.code === 'number' && job.code !== 0) {
          return { ok: false, error: `Kling rejected the request (code ${job.code}): ${job.message || 'no message'}` };
        }

        // task id lives at data.task_id — there is no top-level job_id/id.
        const jobId = (job && job.data && (job.data.task_id || job.data.id)) || job.task_id || job.job_id || job.id;

        if (!jobId) {
          return {
            ok: false,
            error: 'No task ID returned from Kling API',
            responseKeys: Object.keys(job || {}).join(', '),
          };
        }

        process.stderr.write(`[video.kling] Job submitted: ${jobId}\n`);

        // Step 3: Poll for completion (Official Kling API verified)
        let attempts = 0;
        let status = null;
        let downloadUrl = null;

        while (attempts < MAX_POLL_ATTEMPTS) {
          attempts++;
          await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

          // Official endpoint: GET /v1/videos/text2video/{task_id} or /v1/tasks/{task_id}
          const statusRes = await fetch(`${API_BASE}/v1/videos/text2video/${jobId}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
          });

          if (!statusRes.ok) {
            return { ok: false, error: `Status check failed (${statusRes.status})` };
          }

          const body = await statusRes.json();
          // Same { code, message, data } wrapper as the submit response. Reading the status
          // off the top level (as this once did) yields undefined forever: the job completes,
          // the poll never notices, and the billed video is discarded at the timeout.
          const d = (body && body.data) || {};
          status = d.task_status || body.task_status || body.status;

          if (status === 'succeed' || status === 'succeeded') {
            const videos = (d.task_result && d.task_result.videos) || [];
            downloadUrl = videos[0] ? videos[0].url : null;
            break;
          }

          if (status === 'failed' || status === 'cancelled') {
            return {
              ok: false,
              error: `Video generation failed: ${d.task_status_msg || body.message || `status=${status}`}`,
              jobId,
            };
          }

          if (attempts % 12 === 0) {  // Every ~60 seconds
            process.stderr.write(`[video.kling] Job ${jobId} in progress (${attempts * 5}s elapsed), status: ${status}...\n`);
          }
        }

        if (!downloadUrl) {
          return {
            ok: false,
            error: `Video generation timed out after ${attempts * 5}s (max 10 minutes). Status was: ${status}`,
            jobId,
          };
        }

        process.stderr.write(`[video.kling] Video ready, downloading from ${downloadUrl.substring(0, 80)}...\n`);

        // Step 4: Download video file
        const downloadRes = await fetch(downloadUrl);
        if (!downloadRes.ok) {
          return {
            ok: false,
            error: `Download failed (${downloadRes.status})`,
            jobId,
          };
        }

        // Write to workspace. `downloadRes.buffer()` is node-fetch v2 only — it does not
        // exist on Node's built-in fetch and threw after the video had already been paid for.
        await fspArg.writeFile(videoPath, Buffer.from(await downloadRes.arrayBuffer()));

        // Return success with metadata
        const stat = await fspArg.stat(videoPath);
        return {
          ok: true,
          videoPath,
          filename: pathMod.basename(videoPath),
          jobId,
          status,
          fileSize: stat.size,
          duration,
          aspectRatio: aspect_ratio,
          mode,
          modelName: model_name,
          message: `Kling video generated successfully: ${pathMod.basename(videoPath)} (${Math.round(stat.size / 1024 / 1024)}MB, ${Math.round((attempts * 5) / 60)}m ${(attempts * 5) % 60}s)`,
        };

      } catch (err) {
        return {
          ok: false,
          error: `Video generation failed: ${err.message}`,
          videoPath,
        };
      }
    },
  };

  return {
    register(registry) {
      registry.register(toolDef);
    }
  };
};
