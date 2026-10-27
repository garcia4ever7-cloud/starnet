#!/bin/bash
# setup-kling-key.sh — Securely configure KLING_API_KEY for StarNet
#
# This script:
# 1. Prompts for your Kling API key (hidden input, not echoed to terminal)
# 2. Validates basic format (should be non-empty, reasonable length)
# 3. Adds it to ~/.config/starnet/env without printing it
# 4. Verifies it's in the file without displaying the value
# 5. Sets restrictive permissions (0600) for security
#
# Usage:
#   bash scripts/setup-kling-key.sh
#
# The key is NEVER:
#   - Printed to terminal
#   - Stored in shell history
#   - Logged to any file
#   - Exposed to agents or the UI

set -e

ENV_FILE="$HOME/.config/starnet/env"

echo "════════════════════════════════════════════════════════════════"
echo "  StarNet Kling API Key Configuration"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "This will securely configure your official Kling 3.0 API key."
echo "Your key will be stored in: $ENV_FILE"
echo ""
echo "The key is only used by the sidecar backend and is NEVER:"
echo "  • Printed to terminal"
echo "  • Stored in shell history"
echo "  • Logged to any file"
echo "  • Exposed to agents or the UI"
echo ""

# Ensure config directory exists
mkdir -p "$HOME/.config/starnet"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

# Check if KLING_API_KEY is already set
if grep -q "^KLING_API_KEY=" "$ENV_FILE"; then
    echo "⚠️  KLING_API_KEY is already configured in $ENV_FILE"
    read -p "Do you want to update it? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Cancelled."
        exit 0
    fi
    # Remove the old entry
    sed -i '/^KLING_API_KEY=/d' "$ENV_FILE"
fi

# Prompt for key with hidden input (using read -s)
echo "📝 Enter your Kling API key (input will be hidden):"
read -s KLING_KEY
echo ""

# Validation. A bare length>=10 check once accepted a 504-character chat message pasted
# at this prompt; the station then ran with an unusable credential because nothing
# downstream re-checks the shape. Validate the shape, not just the length.
if [ -z "$KLING_KEY" ]; then
    echo "❌ Error: Key cannot be empty"
    exit 1
fi

if [ ${#KLING_KEY} -lt 10 ]; then
    echo "❌ Error: Key appears too short (should be at least 10 characters)"
    exit 1
fi

if [ ${#KLING_KEY} -gt 200 ]; then
    echo "❌ Error: Key is ${#KLING_KEY} characters — far too long for an API key."
    echo "   Did you paste a message or a block of text instead of the key?"
    exit 1
fi

case "$KLING_KEY" in
    *[[:space:]]*)
        echo "❌ Error: Key contains whitespace. API keys do not."
        echo "   Did you paste a sentence instead of the key?"
        exit 1
        ;;
esac

# Accept either the direct key form (api-key-...) or a 3-part JWT.
case "$KLING_KEY" in
    api-key-*) ;;
    *)
        jwt_parts=$(printf '%s' "$KLING_KEY" | awk -F. '{print NF}')
        if [ "$jwt_parts" -ne 3 ]; then
            echo "❌ Error: Unrecognised key format."
            echo "   Expected 'api-key-...' or a 3-part JWT (a.b.c); got $jwt_parts dot-separated part(s)."
            exit 1
        fi
        ;;
esac

# Add to env file
echo "KLING_API_KEY=$KLING_KEY" >> "$ENV_FILE"

# Verify it was added (without showing the value)
if grep -q "^KLING_API_KEY=" "$ENV_FILE"; then
    echo ""
    echo "✅ Key configured successfully!"
    echo ""
    echo "📋 Configuration summary:"
    echo "   File: $ENV_FILE"
    grep "^KLING_API_KEY=" "$ENV_FILE" | sed 's/=.*/=<hidden>/'
    echo ""
    echo "🔒 File permissions:"
    ls -l "$ENV_FILE" | awk '{print "   " $1 " " $9}'
    echo ""
    echo "⏭️  Next steps:"
    echo "   1. Restart the sidecar: ~/start-starnet.sh"
    echo "   2. Verify configuration: node sidecar/index.js (should load without errors)"
    echo "   3. Test tool availability: GET /api/toolsets?agent=<agentId>"
    echo "   4. Run first generation when ready"
    echo ""
else
    echo "❌ Error: Failed to add key to $ENV_FILE"
    exit 1
fi
