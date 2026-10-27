/* audio.generate: Text-to-speech generation via ElevenLabs API.
   Converts script text to MP3 audio with consistent narrator voice.
   Credentials: ELEVENLABS_API_KEY environment variable.
   Write-scoped (creates file) + consent-gated + network required. */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const API_BASE = 'https://api.elevenlabs.io/v1';

module.exports = function(tools) {
  return {
    properties: {
      id: 'audio.generate',
      summary: 'Generate audio narration from text via ElevenLabs TTS',
      description: 'Converts script text to high-quality MP3 audio using ElevenLabs text-to-speech. Ensures consistent narrator voice across all scenes and episodes.',
      tags: ['studio', 'audio', 'narration', 'tts', 'elevenlabs'],
      scope: 'write',
      requiresConsent: true,
      network: true,
    },
    schema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Script text to convert to speech. Include punctuation for natural pacing.',
          minLength: 10,
          maxLength: 5000,
        },
        voiceId: {
          type: 'string',
          description: 'ElevenLabs voice ID. Default: "rachel" (warm, professional narrator voice).',
          default: 'rachel',
        },
        stability: {
          type: 'number',
          description: 'Voice stability (0.0-1.0). 0.75 = consistent, professional. Default: 0.75.',
          minimum: 0,
          maximum: 1,
          default: 0.75,
        },
        similarityBoost: {
          type: 'number',
          description: 'Similarity to voice clone (0.0-1.0). 0.75 = strong similarity. Default: 0.75.',
          minimum: 0,
          maximum: 1,
          default: 0.75,
        },
        filename: {
          type: 'string',
          description: 'Output filename (no extension). Will be saved as {filename}.mp3 in workspace.',
          pattern: '^[a-zA-Z0-9_-]+$',
          default: 'narration',
        },
      },
      required: ['text'],
    },
    async invoke(args, context) {
      const { text, voiceId = 'rachel', stability = 0.75, similarityBoost = 0.75, filename = 'narration' } = args;
      const { fs: fsp, workspaceRoot, agentId } = context;

      // Validate inputs
      if (!text || text.trim().length < 10) {
        return { ok: false, error: 'Text must be at least 10 characters' };
      }

      // Get API credentials
      const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!apiKey) {
        return { ok: false, error: 'ELEVENLABS_API_KEY not set in environment. Cannot generate audio.' };
      }

      const audioPath = path.join(workspaceRoot, agentId, `${filename}.mp3`);

      try {
        // Submit TTS request to ElevenLabs
        const ttsRes = await fetch(`${API_BASE}/text-to-speech/${voiceId}`, {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text,
            voice_settings: {
              stability,
              similarity_boost: similarityBoost,
            },
          }),
        });

        if (!ttsRes.ok) {
          const err = await ttsRes.text();
          return {
            ok: false,
            error: `ElevenLabs API error (${ttsRes.status}): ${err}`,
          };
        }

        // Write audio file
        const audioBuffer = await ttsRes.buffer();
        await fsp.writeFile(audioPath, audioBuffer);

        // Calculate duration estimate (ElevenLabs: ~150 words/min)
        const wordCount = text.trim().split(/\s+/).length;
        const estimatedDurationSec = Math.ceil((wordCount / 150) * 60);

        const stat = await fsp.stat(audioPath);
        return {
          ok: true,
          audioPath,
          filename: path.basename(audioPath),
          fileSize: stat.size,
          textLength: text.length,
          estimatedDurationSec,
          voiceId,
          message: `Audio generated successfully: ${path.basename(audioPath)} (${Math.round(stat.size / 1024)}KB, ~${estimatedDurationSec}s)`,
        };

      } catch (err) {
        return {
          ok: false,
          error: `Audio generation failed: ${err.message}`,
          audioPath,
        };
      }
    },
  };
};
