/* video.generate: Text-to-video generation via Pika Labs REST API v2.
   Submits async job, polls for completion, downloads MP4 to workspace.
   Credentials: PIKA_API_KEY environment variable.
   Write-scoped (creates file) + consent-gated + network required. */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 300; // 10 minutes max (300 * 2s)
const API_BASE = 'https://api.pika.art/v2';

module.exports = function(tools) {
  return {
    properties: {
      id: 'video.generate',
      summary: 'Generate video from text prompt via Pika Labs',
      description: 'Submits a text-to-video generation job to Pika Labs API, polls for completion, and downloads the MP4 file into the workspace. Async operation: may take 30-120 seconds.',
      tags: ['studio', 'video', 'generation', 'pika'],
      scope: 'write',
      requiresConsent: true,
      network: true,
    },
    schema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed text description of the video scene to generate. Include visual style, action, characters, environment, lighting, duration guidance.',
          minLength: 10,
          maxLength: 2000,
        },
        duration: {
          type: 'number',
          description: 'Target video duration in seconds (typically 10-60). Default: 30.',
          minimum: 10,
          maximum: 120,
          default: 30,
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
      },
      required: ['prompt'],
    },
    async invoke(args, context) {
      const { prompt, duration = 30, aspect_ratio = '16:9', filename = 'video' } = args;
      const { fs: fsp, workspaceRoot, agentId } = context;

      // Validate inputs
      if (!prompt || prompt.trim().length < 10) {
        return { ok: false, error: 'Prompt must be at least 10 characters' };
      }

      // Get API credentials
      const apiKey = process.env.PIKA_API_KEY;
      if (!apiKey) {
        return { ok: false, error: 'PIKA_API_KEY not set in environment. Cannot generate video.' };
      }

      const videoPath = path.join(workspaceRoot, agentId, `${filename}.mp4`);

      try {
        // Step 1: Submit job to Pika Labs
        const submitRes = await fetch(`${API_BASE}/video-generation`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt,
            duration,
            aspect_ratio,
          }),
        });

        if (!submitRes.ok) {
          const err = await submitRes.text();
          return {
            ok: false,
            error: `Pika API error (${submitRes.status}): ${err}`,
          };
        }

        const job = await submitRes.json();
        const jobId = job.job_id || job.id;

        if (!jobId) {
          return { ok: false, error: 'No job ID returned from Pika API' };
        }

        // Step 2: Poll for completion
        let attempts = 0;
        let status = null;
        let downloadUrl = null;

        while (attempts < MAX_POLL_ATTEMPTS) {
          attempts++;
          await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

          const statusRes = await fetch(`${API_BASE}/video-generation/${jobId}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
          });

          if (!statusRes.ok) {
            return { ok: false, error: `Status check failed (${statusRes.status})` };
          }

          const data = await statusRes.json();
          status = data.status;

          if (status === 'completed') {
            downloadUrl = data.video_url || data.output_video_url;
            break;
          }

          if (status === 'failed' || status === 'error') {
            return {
              ok: false,
              error: `Video generation failed: ${data.error_message || status}`,
              jobId,
            };
          }

          if (attempts % 10 === 0) {
            process.stderr.write(`[video.generate] Job ${jobId} in progress (${attempts * 2}s elapsed)...\n`);
          }
        }

        if (!downloadUrl) {
          return {
            ok: false,
            error: `Video generation timed out after ${attempts * 2}s`,
            jobId,
          };
        }

        // Step 3: Download video file
        const downloadRes = await fetch(downloadUrl);
        if (!downloadRes.ok) {
          return {
            ok: false,
            error: `Download failed (${downloadRes.status})`,
            jobId,
          };
        }

        // Write to workspace
        await fsp.writeFile(videoPath, await downloadRes.buffer());

        // Return success with metadata
        const stat = await fsp.stat(videoPath);
        return {
          ok: true,
          videoPath,
          filename: path.basename(videoPath),
          jobId,
          status,
          fileSize: stat.size,
          duration,
          aspectRatio: aspect_ratio,
          message: `Video generated successfully: ${path.basename(videoPath)} (${Math.round(stat.size / 1024 / 1024)}MB, ${attempts * 2}s)`,
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
};
