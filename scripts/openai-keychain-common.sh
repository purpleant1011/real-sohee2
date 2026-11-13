#!/usr/bin/env bash

set -euo pipefail

SOHEE_KEYCHAIN_ACCOUNT="${USER:?USER is required}"
SOHEE_GEMINI_KEYCHAIN_SERVICE="example.com/GEMINI_API_KEY"
SOHEE_IMAGE_KEYCHAIN_SERVICE="example.com/OPENAI_IMAGE_API_KEY"

read_sohee_keychain_secret() {
  local service="$1"
  /usr/bin/security find-generic-password \
    -a "$SOHEE_KEYCHAIN_ACCOUNT" \
    -s "$service" \
    -w
}

check_sohee_keychain_secret() {
  local service="$1"
  /usr/bin/security find-generic-password \
    -a "$SOHEE_KEYCHAIN_ACCOUNT" \
    -s "$service" \
    >/dev/null 2>&1
}
