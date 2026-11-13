#!/usr/bin/env bash

set -euo pipefail

if [[ "$#" -eq 0 ]]; then
  echo "Usage: $0 <command> [args...]" >&2
  exit 64
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./openai-keychain-common.sh
source "$SCRIPT_DIR/openai-keychain-common.sh"

export OPENAI_TEXT_API_KEY="$(read_sohee_keychain_secret "$SOHEE_TEXT_KEYCHAIN_SERVICE")"
export OPENAI_IMAGE_API_KEY="$(read_sohee_keychain_secret "$SOHEE_IMAGE_KEYCHAIN_SERVICE")"

exec "$@"
