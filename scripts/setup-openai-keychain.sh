#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./openai-keychain-common.sh
source "$SCRIPT_DIR/openai-keychain-common.sh"

printf '\n소희 OpenAI 운영 키를 macOS 키체인에 암호화 저장합니다.\n'
printf '입력 내용은 화면이나 Git 기록에 표시되지 않습니다.\n\n'

printf '[1/2] 앞서 전달한 텍스트용 키를 붙여넣고 Enter를 누르세요.\n'
/usr/bin/security add-generic-password \
  -U \
  -a "$SOHEE_KEYCHAIN_ACCOUNT" \
  -s "$SOHEE_TEXT_KEYCHAIN_SERVICE" \
  -l "Sohee OpenAI text production key" \
  -j "Server-side secret for example.com; never commit" \
  -w

printf '\n[2/2] 앞서 전달한 이미지용 키를 붙여넣고 Enter를 누르세요.\n'
/usr/bin/security add-generic-password \
  -U \
  -a "$SOHEE_KEYCHAIN_ACCOUNT" \
  -s "$SOHEE_IMAGE_KEYCHAIN_SERVICE" \
  -l "Sohee OpenAI image production key" \
  -j "Server-side secret for example.com; never commit" \
  -w

printf '\n저장 완료: 두 키가 macOS 키체인에 보관되었습니다.\n'
printf '이 터미널 창은 닫아도 됩니다.\n'
