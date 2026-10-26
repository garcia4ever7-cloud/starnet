/* video.inspect: Analyze video file technical properties.
   Uses ffprobe to extract resolution, frame rate, duration, codec, bitrate, streams.
   Scope: read, no consent needed, local operation. */

'use strict';

const { guardChildProcess } = require('../../child-env.js');
const { execSync } = guardChildProcess(require('node:child_process'));
const fs = require('node:fs');
const path = require('node:path');

module.exports = function(tools) {
  return {
    properties: {
      id: 'video.inspect',
      summary: 'Analyze video technical properties (codec, resolution, duration, frame rate)',
      description: 'Uses ffprobe to extract detailed technical information from a video file. Returns resolution, frame rate, codec, bitrate, duration, stream info, and color space. Essential for QC and debugging.',
      tags: ['studio', 'video', 'qc', 'inspect', 'technical'],
      scope: 'read',
      requiresConsent: false,
      network: false,
    },
    schema: {
      type: 'object',
      properties: {
        videoPath: {
          type: 'string',
          description: 'Path to video file to inspect (relative to workspace root)',
          minLength: 1,
          maxLength: 1024,
        },
        detailed: {
          type: 'boolean',
          description: 'If true, include frame-by-frame analysis (slower). Default: false.',
          default: false,
        },
      },
      required: ['videoPath'],
    },
    async invoke(args, context) {
      const { videoPath, detailed = false } = args;
      const { workspaceRoot, agentId } = context;

      // Resolve full path
      let fullPath;
      if (path.isAbsolute(videoPath)) {
        fullPath = videoPath;
      } else {
        fullPath = path.join(workspaceRoot, agentId, videoPath);
      }

      // Check file exists
      if (!fs.existsSync(fullPath)) {
        return { ok: false, error: `Video file not found: ${videoPath}` };
      }

      try {
        // Get basic info with ffprobe (using -of json for output format)
        const ffprobeCmd = `ffprobe -v error -show_format -show_streams -of json "${fullPath}"`;
        const output = execSync(ffprobeCmd, { encoding: 'utf8', timeout: 10000 });
        const data = JSON.parse(output);

        // Extract key information
        const format = data.format || {};
        const streams = data.streams || [];

        // Find video stream
        const videoStream = streams.find(s => s.codec_type === 'video');
        const audioStream = streams.find(s => s.codec_type === 'audio');

        // Build report
        const report = {
          ok: true,
          file: path.basename(fullPath),
          size: {
            bytes: parseInt(format.size || 0),
            mb: (parseInt(format.size || 0) / 1024 / 1024).toFixed(2),
          },
          duration: {
            seconds: parseFloat(format.duration || 0),
            formatted: formatDuration(parseFloat(format.duration || 0)),
          },
          video: videoStream ? {
            codec: videoStream.codec_name,
            profile: videoStream.profile,
            resolution: `${videoStream.width}x${videoStream.height}`,
            width: videoStream.width,
            height: videoStream.height,
            fps: videoStream.r_frame_rate ? evaluateFps(videoStream.r_frame_rate) : 'unknown',
            frame_rate_raw: videoStream.r_frame_rate,
            bitrate: videoStream.bit_rate ? `${(parseInt(videoStream.bit_rate) / 1000).toFixed(0)} kbps` : 'variable',
            bitrate_bps: parseInt(videoStream.bit_rate || 0),
            color_space: videoStream.color_space || 'unknown',
            pixel_format: videoStream.pix_fmt,
            aspect_ratio: videoStream.display_aspect_ratio || 'unknown',
            duration_seconds: videoStream.duration ? parseFloat(videoStream.duration) : parseFloat(format.duration || 0),
          } : null,
          audio: audioStream ? {
            codec: audioStream.codec_name,
            sample_rate: audioStream.sample_rate,
            channels: audioStream.channels,
            channel_layout: audioStream.channel_layout,
            bitrate: audioStream.bit_rate ? `${(parseInt(audioStream.bit_rate) / 1000).toFixed(0)} kbps` : 'variable',
            bitrate_bps: parseInt(audioStream.bit_rate || 0),
            duration_seconds: audioStream.duration ? parseFloat(audioStream.duration) : parseFloat(format.duration || 0),
          } : null,
          overall: {
            streams: streams.length,
            video_count: streams.filter(s => s.codec_type === 'video').length,
            audio_count: streams.filter(s => s.codec_type === 'audio').length,
            subtitle_count: streams.filter(s => s.codec_type === 'subtitle').length,
          },
        };

        // Detailed frame analysis if requested
        if (detailed && videoStream) {
          report.frame_analysis = analyzeFrames(fullPath);
        }

        // Quality assessment
        report.quality_notes = assessQuality(report);

        return report;

      } catch (err) {
        return {
          ok: false,
          error: `Failed to inspect video: ${err.message}`,
          videoPath,
        };
      }
    },
  };
};

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

function evaluateFps(fpsString) {
  // Format: "30/1" or "23.976/1" or "24"
  const parts = fpsString.split('/');
  if (parts.length === 2) {
    return (parseFloat(parts[0]) / parseFloat(parts[1])).toFixed(2);
  }
  return parseFloat(fpsString).toFixed(2);
}

function analyzeFrames(videoPath) {
  // Get frame count and detect scene cuts (expensive operation)
  try {
    const cmd = `ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=nb_read_frames -of csv=p=0 "${videoPath}"`;
    const frameCount = execSync(cmd, { encoding: 'utf8', timeout: 30000 }).trim();

    // Detect black frames and scene cuts
    const sceneCmd = `ffmpeg -i "${videoPath}" -vf "select='gt(scene,0.4)',scale=160:90" -fps_mode vfr -q:v 2 -f null - 2>&1 | grep -c "Scene" || echo 0`;
    const sceneChanges = execSync(sceneCmd, { encoding: 'utf8', timeout: 60000 }).trim();

    return {
      total_frames: parseInt(frameCount),
      scene_changes_detected: parseInt(sceneChanges),
      note: 'Detailed frame analysis completed',
    };
  } catch (e) {
    return { error: 'Frame analysis failed', note: e.message };
  }
}

function assessQuality(report) {
  const notes = [];

  if (!report.video) {
    notes.push('❌ No video stream found');
    return notes;
  }

  // Resolution check
  if (report.video.height < 720) {
    notes.push(`⚠️  Low resolution: ${report.video.resolution} (720p minimum recommended)`);
  } else if (report.video.height >= 1080) {
    notes.push(`✅ High resolution: ${report.video.resolution}`);
  } else {
    notes.push(`✅ Standard resolution: ${report.video.resolution}`);
  }

  // Frame rate check
  const fps = parseFloat(report.video.fps);
  if (fps < 24) {
    notes.push(`⚠️  Low frame rate: ${fps}fps (24fps minimum recommended)`);
  } else if (fps === 24 || fps === 25 || fps === 30 || fps === 60) {
    notes.push(`✅ Standard frame rate: ${fps}fps`);
  } else {
    notes.push(`⚠️  Non-standard frame rate: ${fps}fps`);
  }

  // Bitrate check (reasonable for resolution)
  const kbps = report.video.bitrate_bps / 1000;
  const expectedMin = (report.video.width * report.video.height) / 1000; // very rough estimate
  if (kbps < expectedMin / 2) {
    notes.push(`⚠️  Low bitrate: ${kbps.toFixed(0)}kbps (may show compression artifacts)`);
  } else {
    notes.push(`✅ Adequate bitrate: ${kbps.toFixed(0)}kbps`);
  }

  // Codec check
  if (report.video.codec === 'h264' || report.video.codec === 'h265') {
    notes.push(`✅ Modern codec: ${report.video.codec}`);
  } else if (report.video.codec === 'mpeg4') {
    notes.push(`⚠️  Older codec: ${report.video.codec} (h264/h265 preferred)`);
  } else {
    notes.push(`⚠️  Unusual codec: ${report.video.codec}`);
  }

  // Audio check
  if (report.audio) {
    if (report.audio.channels >= 2) {
      notes.push(`✅ Stereo audio: ${report.audio.channels} channels`);
    } else {
      notes.push(`⚠️  Mono audio: ${report.audio.channels} channel(s) (stereo preferred)`);
    }
  } else {
    notes.push(`❌ No audio track`);
  }

  if (notes.length === 0) {
    notes.push('✅ Video appears to meet quality standards');
  }

  return notes;
}
