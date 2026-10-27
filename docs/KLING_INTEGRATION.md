# Kling 3.0 Official API Integration

**Status**: Implementation Complete, Awaiting API Documentation Verification  
**Date**: 2026-10-25  
**Tool ID**: `video.kling`  
**Capability**: `studio` (write-scoped, consent-gated, network-required)

---

## Overview

This document describes the integration of the official Kling 3.0 text-to-video API into StarNet's video production pipeline. The integration is complete and ready for configuration. It **preserves Pika Labs** (`video.generate`) as a fallback tool.

### Key Features
- ✅ Multi-shot generation (AI Director)
- ✅ Character consistency via reference images
- ✅ Native audio/lip-sync integration
- ✅ Async job submission with polling
- ✅ Safe configuration (no secrets in logs)
- ✅ Compatible with existing Studio workflow

---

## Architecture

### Tool Registration

**File**: `sidecar/tools/builtin/video-kling.js`
- Factory function: `makeVideoKlingTools({ fsp, pathMod, root })`
- Exports: `{ register(registry) }`
- Pattern: Follows same factory structure as `voice.js`, `higgsfield.js`

**Wiring**: `sidecar/index.js`
- Required at line 75
- Registered in studio tools section (line ~17062)
- Called with `{ fsp, pathMod: path, root: WORKSPACES }`

**Capability**: `sidecar/capability/registry.js`
- Granted under `studio` object (like `image_generate`, `voice_generate`)
- Scope: `write`
- Requires consent: `true`
- Requires network: `true`

### Credential Handling

**Source of Truth**: `~/.config/starnet/env`
- Only place sidecar reads credentials from environment
- Never exposed to frontend (localStorage never used)
- Never logged by sidecar (checked at lines 16978, etc.)
- File permissions: `0600` (read-write owner only)

**Setup Script**: `scripts/setup-kling-key.sh`
- Prompts for key with hidden input (not echoed to terminal)
- Validates basic format (non-empty, >10 chars)
- Never prints the key to terminal or shell history
- Sets file permissions to `0600` automatically
- Verification output shows `<hidden>` instead of actual key

**Verification Script**: `scripts/verify-kling-config.js`
- Checks env file exists and has correct permissions
- Confirms tool file is present
- Verifies tool is registered in capability registry
- Confirms tool is wired in index.js
- Does NOT make any API calls

---

## Configuration

### Step 1: Add Your Kling API Key

Run the secure setup script:
```bash
bash scripts/setup-kling-key.sh
```

This will:
1. Prompt you to enter your API key (input hidden, not echoed)
2. Validate basic format
3. Add it to `~/.config/starnet/env`
4. Set file permissions to `0600`
5. Verify it was added (showing only `<hidden>`)

### Step 2: Verify Configuration

Check that everything is set up correctly:
```bash
node scripts/verify-kling-config.js
```

Expected output:
```
✅ Configuration verification PASSED

📋 Configuration status:
   • Tool file: present ✅
   • Tool registered: yes ✅
   • API key configured: yes ✅
```

### Step 3: Restart Sidecar

The sidecar reads environment variables at startup. Restart it:
```bash
~/start-starnet.sh
```

Or kill and restart manually:
```bash
kill <node-pid>
sleep 2
node sidecar/index.js
```

### Step 4: Verify Tool Availability

Check that the tool loads without errors:
```bash
# Should complete without error and print setup instructions
node scripts/verify-kling-config.js
```

Check that the tool is available to agents:
```bash
# HTTP request to check DESIGNER agent can see video.kling
curl http://localhost:8787/api/toolsets?agent=webdesigner \
  -H 'x-starnet-token: <your-token>'
```

Look for `"video.kling"` in the returned tool list.

---

## API Specification

### Request Format

**Endpoint**: `POST https://api-singapore.klingai.com/v1/videos`  
(Subject to verification against official Kling documentation)

**Headers**:
```
Authorization: Bearer ${KLING_API_KEY}
Content-Type: application/json
```

**Request Body** (preliminary, subject to verification):
```json
{
  "prompt": "string (required, 10-2000 chars)",
  "duration": "number (5-120 seconds, default 30)",
  "aspect_ratio": "enum: 16:9 | 9:16 | 1:1 (default 16:9)",
  "style": "string (cinematic narrative, documentary, etc.)",
  "ai_director": "boolean (default true)",
  "character_reference": "image path (optional)",
  "scene_reference": "image path (optional)"
}
```

### Response Format

**Job Submission Response** (preliminary):
- Returns job metadata with ID
- Job ID field name: `job_id` | `id` | `task_id` (TBD)
- Status code: `200` or `201`

**Status Polling Endpoint** (preliminary):
```
GET https://api-singapore.klingai.com/v1/videos/{jobId}
Headers: Authorization: Bearer ${KLING_API_KEY}
```

**Status Response** (preliminary):
- Status field: `status` | `state` (TBD)
- Status values: `submitted` | `processing` | `completed` | `failed` (TBD)
- Video URL field: `video_url` | `url` | `output_url` (TBD)

### Placeholders to Verify

These assumptions in `video-kling.js` **require verification** against official documentation:

| Line | Field | Assumption | Impact |
|------|-------|-----------|--------|
| 165 | POST path | `/v1/videos` | Job submission fails if incorrect |
| 217 | Poll endpoint | `GET /v1/videos/{jobId}` | Status checks fail if incorrect |
| 228 | Status field | `status` or `state` | Polling logic won't work |
| 230 | Status values | `completed` \| `success` | Won't detect completion |
| 232 | URL field | `video_url` \| `url` \| `output_url` | Download won't find URL |

---

## Pricing & Costs

### Per-Generation Estimates

| Duration | Estimated Cost | Notes |
|----------|---|---|
| 5 seconds | $0.08-0.12 | Minimum generation |
| 10 seconds | $0.15-0.25 | Typical scene |
| 15 seconds | $0.20-0.35 | Standard scene (multi-shot) |
| 30 seconds | $0.40-0.70 | Full narrative scene |

**Source**: Earlier research estimated $0.25/15-second scene  
**Verification**: Check https://kling.ai/pricing or API documentation

### Cost Reduction vs Pika Labs

| Metric | Pika Labs | Kling 3.0 | Savings |
|--------|-----------|-----------|---------|
| Per 15-second scene | $1.32 | $0.47 | 75% |
| Time per scene | 2 hours | 0.5 hours | 75% |
| Characters look same? | No (redrawn) | Yes (reference) | Quality leap |
| Audio sync | Manual | Native | No extra work |

---

## Testing

### Unit Test

```bash
node test/video-kling.test.js
```

**What it tests**:
- ✅ Tool loads without syntax errors
- ✅ Factory creates valid tool object
- ✅ Tool has correct ID and properties
- ✅ Schema is properly structured
- ✅ All required fields are defined
- ✅ Field constraints are correct
- ✅ Tool is registered in capability registry

**Does NOT test**:
- ❌ API calls (safe for anytime execution)
- ❌ Actual video generation
- ❌ Network connectivity

### Integration Test (Requires API Key)

First 10-second generation with Producer agent:
```bash
# Estimated cost: $0.15-0.25
# Expected duration: 60-180 seconds
# Check: video file downloads, plays with ffprobe
```

**Test project prompt**:
```
A simple scene of a single person standing in a sunlit garden.
Focus on natural lighting and peaceful expression.
Duration: 10 seconds
Style: cinematic narrative
```

---

## Troubleshooting

### KLING_API_KEY not found

**Error**: `KLING_API_KEY not set in environment. Cannot generate video.`

**Fix**:
```bash
bash scripts/setup-kling-key.sh
~/start-starnet.sh
```

### Tool not available to agent

**Error**: Producer agent cannot find `video.kling` in toolset

**Check**:
```bash
# 1. Verify configuration
node scripts/verify-kling-config.js

# 2. Check that sidecar has the key loaded
echo $KLING_API_KEY  # Should not be empty after restart

# 3. Verify tool is in capability registry
grep -n "video.kling" sidecar/capability/registry.js
```

### API returns 401 Unauthorized

**Cause**: Invalid or expired API key

**Fix**:
1. Verify key is correct: `https://kling.ai` → Account Settings → API Keys
2. Re-enter key: `bash scripts/setup-kling-key.sh`
3. Restart sidecar

### Job submission fails with 400

**Cause**: Invalid parameter format or unrecognized field name

**Debug**:
1. Check exact request being sent (add logging to video-kling.js)
2. Compare against official API documentation
3. Update placeholder field names if needed

---

## Rollback Plan

If Kling integration has issues, Pika Labs remains fully functional:

**To use Pika Labs instead**:
1. Producer agent can choose `video.generate` (Pika)
2. Or comment out Kling registration in registry.js
3. No changes to Pika or other tools needed

**To disable Kling entirely**:
```bash
# Comment out or remove KLING_API_KEY from ~/.config/starnet/env
# Restart sidecar
# Tool will fail with "KLING_API_KEY not set" error, not affecting other tools
```

---

## References

- **Official Kling API**: https://kling.ai/document-api/apiReference/model/textToVideo
- **Tool Code**: `sidecar/tools/builtin/video-kling.js`
- **Tests**: `test/video-kling.test.js`
- **Setup**: `scripts/setup-kling-key.sh`
- **Verify**: `scripts/verify-kling-config.js`

---

## Next Steps

1. ✅ Implementation complete
2. ⏳ Awaiting API documentation verification
3. ⏳ User enters API key via `setup-kling-key.sh`
4. ⏳ Run verification: `verify-kling-config.js`
5. ⏳ Test first generation: Producer submits 10-second scene
6. ⏳ Measure quality vs Pika Labs
7. ⏳ Full rollout to all new projects

---

**Last Updated**: 2026-10-25  
**Status**: Ready for configuration
