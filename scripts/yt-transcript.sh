#!/data/data/com.termux/files/usr/bin/bash
# yt-transcript.sh <youtube-url> [--model <id>] [--out <dir>] [--fps <n>]
#
# Transcribe a PUBLIC YouTube video with the Gemini API, including on-screen code.
#
# WHY THIS EXISTS: yt-dlp on this phone is blocked by YouTube's "Sign in to confirm you're not
# a bot" gate — every extractor client, the learn skill's own venv fetcher, and a local Chromium
# cookie store all fail identically, because the block is IP-level against this device. Gemini
# accepts a YouTube URL as `file_data.file_uri` and fetches it SERVER-SIDE, so the device gate
# never applies. That is the whole trick.
#
# The key is read from ~/.config/starnet/env into a shell variable and is never echoed, never
# written to the output file, and never placed in a command line (it goes in the URL of a curl
# --data-binary POST read from stdin, so it does not appear in `ps`).
set -uo pipefail

URL=""; MODEL=""; OUT="$HOME/transcripts"; FPS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --model) MODEL="${2:-}"; shift 2 ;;
    --out)   OUT="${2:-}"; shift 2 ;;
    --fps)   FPS="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) URL="$1"; shift ;;
  esac
done
[ -n "$URL" ] || { echo "usage: yt-transcript.sh <youtube-url> [--model id] [--out dir] [--fps n]" >&2; exit 2; }

ENVFILE="${STARNET_ENVFILE:-$HOME/.config/starnet/env}"
[ -r "$ENVFILE" ] || { echo "no env file at $ENVFILE" >&2; exit 3; }
# shellcheck disable=SC1090
set -a; . "$ENVFILE"; set +a
KEY="${GEMINI_API_KEY:-${GOOGLE_API_KEY:-${GOOGLE_AI_API_KEY:-}}}"
[ -n "$KEY" ] || { echo "NO GEMINI KEY: set GEMINI_API_KEY (or GOOGLE_API_KEY) in $ENVFILE" >&2; exit 4; }

# Video id: watch?v=ID, youtu.be/ID, /shorts/ID, /embed/ID. Share params (?is=, ?si=) are tracking
# tokens, not auth — they are stripped, they never help, and they must not reach the filename.
ID="$(printf '%s' "$URL" | sed -E 's#.*[?&]v=([A-Za-z0-9_-]{11}).*#\1#; t; s#.*(youtu\.be|/shorts|/embed)/([A-Za-z0-9_-]{11}).*#\2#; t; s#.*##')"
[ -n "$ID" ] || { echo "could not find an 11-character video id in: $URL" >&2; exit 5; }
CANON="https://www.youtube.com/watch?v=$ID"
mkdir -p "$OUT"

# Newest flash first, then down. A 503 here means the model is busy, not that the request is wrong,
# so the ladder retries a DIFFERENT model rather than hammering the same one.
if [ -n "$MODEL" ]; then LADDER="$MODEL"
else LADDER="gemini-3.8-flash gemini-3.6-flash gemini-3.5-flash gemini-flash-latest gemini-2.5-flash"; fi

VIDEO_META='{}'
[ -n "$FPS" ] && VIDEO_META="{\"fps\":$FPS}"

PROMPT='Transcribe this YouTube video completely and factually.
Output EXACTLY these sections in markdown:
## META
title: <exact video title>
channel: <exact channel name>
duration: <mm:ss or hh:mm:ss>
## TRANSCRIPT
Verbatim spoken words with [mm:ss] timestamps at least every 30 seconds. Do not summarise, do not paraphrase, do not skip sections.
## ON-SCREEN CODE AND COMMANDS
Every piece of code, terminal command, file path, config or URL VISIBLE ON SCREEN, transcribed character-for-character, each with its [mm:ss]. If none, write: none.
If you cannot access the video, reply with exactly: CANNOT_ACCESS'

REQ="$(FPS_JSON="$VIDEO_META" URI="$CANON" P="$PROMPT" node -e '
const parts=[{file_data:{file_uri:process.env.URI}}];
const vm=JSON.parse(process.env.FPS_JSON||"{}");
if(Object.keys(vm).length) parts[0].video_metadata=vm;
parts.push({text:process.env.P});
process.stdout.write(JSON.stringify({contents:[{parts}],generationConfig:{temperature:0,maxOutputTokens:65536}}));')"

for M in $LADDER; do
  echo "[yt-transcript] $ID via $M ..." >&2
  RESP="$(printf '%s' "$REQ" | curl -sS --max-time 900 \
      -H 'Content-Type: application/json' --data-binary @- \
      "https://generativelanguage.googleapis.com/v1beta/models/$M:generateContent?key=$KEY")" || RESP=''
  [ -n "$RESP" ] || { echo "[yt-transcript] $M: no response" >&2; continue; }

  # Parse with node so the key never touches the parsing surface, and redact it from any error text.
  OUTFILE="$OUT/$ID.md" RAW="$RESP" MODEL_USED="$M" SRC="$CANON" node -e '
    const fs=require("fs");
    let j; try{ j=JSON.parse(process.env.RAW); }catch(e){ console.error("[yt-transcript] unparseable response"); process.exit(9); }
    if(j.error){ console.error("[yt-transcript] "+j.error.code+" "+j.error.status+": "+String(j.error.message).slice(0,160)); process.exit(j.error.code===503||j.error.code===429?8:7); }
    const c=(j.candidates||[])[0]||{};
    const txt=((c.content&&c.content.parts)||[]).map(p=>p.text||"").join("").trim();
    if(!txt || /^CANNOT_ACCESS/.test(txt)){ console.error("[yt-transcript] model could not access the video"); process.exit(6); }
    const u=j.usageMetadata||{};
    const head=["<!-- yt-transcript "+JSON.stringify({source:process.env.SRC,model:process.env.MODEL_USED,
      finishReason:c.finishReason,promptTokens:u.promptTokenCount,outputTokens:u.candidatesTokenCount,
      at:new Date().toISOString()})+" -->",""].join("\n");
    fs.writeFileSync(process.env.OUTFILE, head+txt+"\n");
    console.log("[yt-transcript] wrote "+process.env.OUTFILE+" ("+txt.length+" chars, finish="+c.finishReason+", promptTokens="+(u.promptTokenCount||"?")+")");
  '
  RC=$?
  [ $RC -eq 0 ] && exit 0
  [ $RC -eq 8 ] && { echo "[yt-transcript] $M busy/over quota — trying next model" >&2; continue; }
  exit $RC
done
echo "[yt-transcript] every model in the ladder failed for $ID" >&2
exit 1
