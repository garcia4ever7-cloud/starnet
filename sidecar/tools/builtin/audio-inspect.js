/* audio.inspect: Analyze audio file technical properties.
   Uses ffprobe and basic audio analysis to extract sample rate, channels, bitrate,
   duration, and detect audio issues (silence, clipping, sync problems).
   Scope: read, no consent needed, local operation. */

'use strict';

const { guardChildProcess } = require('../../child-env.js');
const { execSync } = guardChildProcess(require('node:child_process'));
const fs = require('node:fs');
const path = require('node:path');

module.exports = function(tools) {
  return {
    properties: {
      id: 'audio.inspect',
      summary: 'Analyze audio technical properties (sample rate, channels, duration, quality)',
      description: 'Uses ffprobe to extract audio stream information. Returns sample rate, channels, bitrate, codec, duration, and audio quality assessments. Detects potential issues like silence, low levels, or clipping. Essential for QC and sync verification.',
      tags: ['studio', 'audio', 'qc', 'inspect', 'technical'],
      scope: 'read',
      requiresConsent: false,
      network: false,
    },
    schema: {
      type: 'object',
      properties: {
        audioPath: {
          type: 'string',
          description: 'Path to audio file to inspect (relative to workspace root, or absolute)',
          minLength: 1,
          maxLength: 1024,
        },
        videoPath: {
          type: 'string',
          description: 'Optional: path to video file to check audio sync (provide audio and video for sync analysis)',
          minLength: 0,
          maxLength: 1024,
        },
        detailed: {
          type: 'boolean',
          description: 'If true, analyze peak levels and detect silence regions (slower). Default: false.',
          default: false,
        },
      },
      required: ['audioPath'],
    },
    async invoke(args, context) {
      const { audioPath, videoPath, detailed = false } = args;
      const { workspaceRoot, agentId } = context;

      // Resolve full path
      let fullPath;
      if (path.isAbsolute(audioPath)) {
        fullPath = audioPath;
      } else {
        fullPath = path.join(workspaceRoot, agentId, audioPath);
      }

      // Check file exists
      if (!fs.existsSync(fullPath)) {
        return { ok: false, error: `Audio file not found: ${audioPath}` };
      }

      try {
        // Get basic info with ffprobe (using -of json for output format)
        const ffprobeCmd = `ffprobe -v error -show_format -show_streams -of json "${fullPath}"`;
        const output = execSync(ffprobeCmd, { encoding: 'utf8', timeout: 10000 });
        const data = JSON.parse(output);

        // Extract key information
        const format = data.format || {};
        const streams = data.streams || [];

        // Find audio stream
        const audioStream = streams.find(s => s.codec_type === 'audio') || streams[0];

        if (!audioStream) {
          return { ok: false, error: 'No audio stream found in file' };
        }

        // Build report
        const report = {
          ok: true,
          file: path.basename(fullPath),
          size: {
            bytes: parseInt(format.size || 0),
            mb: (parseInt(format.size || 0) / 1024 / 1024).toFixed(2),
          },
          duration: {
            seconds: parseFloat(audioStream.duration || format.duration || 0),
            formatted: formatDuration(parseFloat(audioStream.duration || format.duration || 0)),
          },
          audio: {
            codec: audioStream.codec_name,
            sample_rate: audioStream.sample_rate,
            sample_rate_khz: (audioStream.sample_rate / 1000).toFixed(1),
            channels: audioStream.channels,
            channel_layout: audioStream.channel_layout,
            bitrate: audioStream.bit_rate ? `${(parseInt(audioStream.bit_rate) / 1000).toFixed(0)} kbps` : 'variable',
            bitrate_bps: parseInt(audioStream.bit_rate || 0),
            bit_depth: audioStream.bits_per_raw_sample || 'unknown',
          },
          quality_assessment: assessAudioQuality(audioStream),
        };

        // Detailed analysis if requested
        if (detailed) {
          report.detailed_analysis = performDetailedAnalysis(fullPath, audioStream);
        }

        // Sync check if video provided
        if (videoPath) {
          const videoFullPath = path.isAbsolute(videoPath)
            ? videoPath
            : path.join(workspaceRoot, agentId, videoPath);

          if (fs.existsSync(videoFullPath)) {
            report.sync_check = checkAudioVideoSync(fullPath, videoFullPath);
          }
        }

        return report;

      } catch (err) {
        return {
          ok: false,
          error: `Failed to inspect audio: ${err.message}`,
          audioPath,
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

function assessAudioQuality(audioStream) {
  const notes = [];

  // Sample rate check
  const sampleRate = parseInt(audioStream.sample_rate || 0);
  if (sampleRate >= 48000) {
    notes.push(`✅ Professional sample rate: ${sampleRate} Hz`);
  } else if (sampleRate >= 44100) {
    notes.push(`✅ Standard sample rate: ${sampleRate} Hz`);
  } else if (sampleRate >= 16000) {
    notes.push(`⚠️  Low sample rate: ${sampleRate} Hz (44.1kHz+ recommended for broadcast)`);
  } else {
    notes.push(`❌ Very low sample rate: ${sampleRate} Hz`);
  }

  // Channel check
  const channels = parseInt(audioStream.channels || 0);
  if (channels >= 2) {
    notes.push(`✅ Stereo audio: ${channels} channels (${audioStream.channel_layout})`);
  } else if (channels === 1) {
    notes.push(`⚠️  Mono audio: ${channels} channel (stereo preferred)`);
  } else {
    notes.push(`❌ Unknown channel configuration`);
  }

  // Bitrate check
  const bitrate = parseInt(audioStream.bit_rate || 0);
  if (bitrate >= 192000) {
    notes.push(`✅ High-quality bitrate: ${(bitrate / 1000).toFixed(0)} kbps`);
  } else if (bitrate >= 128000) {
    notes.push(`✅ Adequate bitrate: ${(bitrate / 1000).toFixed(0)} kbps`);
  } else if (bitrate >= 64000) {
    notes.push(`⚠️  Low bitrate: ${(bitrate / 1000).toFixed(0)} kbps (may sound compressed)`);
  } else if (bitrate > 0) {
    notes.push(`❌ Very low bitrate: ${(bitrate / 1000).toFixed(0)} kbps`);
  } else {
    notes.push(`⚠️  Variable bitrate (VBR) — bitrate varies`);
  }

  // Codec check
  const codec = (audioStream.codec_name || '').toLowerCase();
  if (codec === 'aac' || codec === 'mp3' || codec === 'flac') {
    notes.push(`✅ Standard codec: ${codec}`);
  } else if (codec === 'opus') {
    notes.push(`✅ Modern efficient codec: ${codec}`);
  } else {
    notes.push(`⚠️  Unusual codec: ${codec}`);
  }

  // Bit depth
  const bitDepth = parseInt(audioStream.bits_per_raw_sample || 0);
  if (bitDepth >= 24) {
    notes.push(`✅ High bit depth: ${bitDepth}-bit`);
  } else if (bitDepth === 16) {
    notes.push(`✅ Standard bit depth: ${bitDepth}-bit`);
  } else if (bitDepth > 0) {
    notes.push(`⚠️  Low bit depth: ${bitDepth}-bit`);
  }

  if (notes.length === 0) {
    notes.push('✅ Audio appears to meet quality standards');
  }

  return notes;
}

function performDetailedAnalysis(audioPath, audioStream) {
  // Analyze peak levels, RMS, and silence regions
  try {
    // Use ffmpeg to analyze audio peaks
    const analyzeCmd = `ffmpeg -i "${audioPath}" -af "volumedetect" -f null - 2>&1 | grep -oE "(max_volume|mean_volume): -?[0-9.]+ dB"`;
    const analysisOutput = execSync(analyzeCmd, { encoding: 'utf8', timeout: 30000 }).trim();

    // Parse output
    const peakMatch = analysisOutput.match(/max_volume: (-?[0-9.]+) dB/);
    const meanMatch = analysisOutput.match(/mean_volume: (-?[0-9.]+) dB/);

    const peakDb = peakMatch ? parseFloat(peakMatch[1]) : null;
    const meanDb = meanMatch ? parseFloat(meanMatch[1]) : null;

    return {
      peak_level_db: peakDb,
      mean_level_db: meanDb,
      clipping_detected: peakDb > -0.1,
      level_assessment: assessLevels(peakDb, meanDb),
      silence_scan: detectSilence(audioPath),
    };
  } catch (e) {
    return { error: 'Detailed analysis failed', note: e.message };
  }
}

function assessLevels(peakDb, meanDb) {
  const notes = [];

  if (peakDb === null) {
    return ['Unable to analyze levels'];
  }

  if (peakDb > -0.1) {
    notes.push('❌ CLIPPING DETECTED: Audio peaks reach 0dB (distortion likely)');
  } else if (peakDb > -3) {
    notes.push('⚠️  High peak level: Risk of clipping on some playback systems');
  } else if (peakDb > -6) {
    notes.push('✅ Good peak level: Safe headroom, professional loudness');
  } else if (peakDb > -12) {
    notes.push('⚠️  Quiet audio: May need level adjustment for broadcast');
  } else {
    notes.push('❌ Very quiet audio: Far below professional standards');
  }

  if (meanDb && meanDb < -30) {
    notes.push('⚠️  Very quiet average level: Audio appears compressed or quiet');
  }

  return notes;
}

function detectSilence(audioPath) {
  // Detect regions of silence (< -40dB for > 0.5 seconds)
  try {
    const cmd = `ffmpeg -i "${audioPath}" -af "silencedetect=n=-40dB:d=0.5" -f null - 2>&1 | grep -oE "silence_start: [0-9.]+|silence_end: [0-9.]+" | wc -l`;
    const silenceCount = parseInt(execSync(cmd, { encoding: 'utf8', timeout: 30000 }).trim()) || 0;

    return {
      silence_regions_detected: Math.floor(silenceCount / 2),
      note: silenceCount > 0 ? '⚠️  Silent regions detected (check for dropped audio)' : '✅ No long silences detected',
    };
  } catch (e) {
    return { error: 'Silence detection failed' };
  }
}

function checkAudioVideoSync(audioPath, videoPath) {
  // Check if audio and video have matching durations
  try {
    const audioDuration = parseFloat(
      execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
        { encoding: 'utf8', timeout: 10000 }
      ).trim()
    );

    const videoDuration = parseFloat(
      execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
        { encoding: 'utf8', timeout: 10000 }
      ).trim()
    );

    const drift = Math.abs(audioDuration - videoDuration);
    const driftPercent = (drift / videoDuration) * 100;

    return {
      audio_duration: audioDuration.toFixed(2),
      video_duration: videoDuration.toFixed(2),
      drift_seconds: drift.toFixed(2),
      drift_percent: driftPercent.toFixed(1),
      sync_status: driftPercent < 0.1 ? '✅ Sync OK' : driftPercent < 1 ? '⚠️  Minor drift' : '❌ Significant sync drift',
    };
  } catch (e) {
    return { error: 'Sync check failed', note: e.message };
  }
}
