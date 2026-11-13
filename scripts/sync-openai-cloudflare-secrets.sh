#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./openai-keychain-common.sh
source "$SCRIPT_DIR/openai-keychain-common.sh"

for service in "$SOHEE_GEMINI_KEYCHAIN_SERVICE" "$SOHEE_IMAGE_KEYCHAIN_SERVICE"; do
  if ! check_sohee_keychain_secret "$service"; then
    echo "Missing macOS Keychain item: $service" >&2
    echo "Run: npm run secrets:openai:keychain" >&2
    exit 1
  fi
done

echo "Uploading GEMINI_API_KEY to Cloudflare Workers Secrets..."
read_sohee_keychain_secret "$SOHEE_GEMINI_KEYCHAIN_SERVICE" \
  | npx wrangler secret put GEMINI_API_KEY

echo "Uploading OPENAI_IMAGE_API_KEY to Cloudflare Workers Secrets..."
read_sohee_keychain_secret "$SOHEE_IMAGE_KEYCHAIN_SERVICE" \
  | npx wrangler secret put OPENAI_IMAGE_API_KEY

echo "Cloudflare AI secrets synchronized. Secret values were not printed."
