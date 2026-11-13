#!/usr/bin/env bash
# 솔라피 알림톡용 Cloudflare 시크릿 등록 도우미 (사람이 직접 실행).
# - 값은 화면·저장소·대화·로그 어디에도 남기지 않는다. 복사 후 Enter 를 누르면 클립보드(pbpaste)에서 읽어 wrangler 로 전달한다.
# - SOLAPI_WEBHOOK_SECRET 은 무작위로 생성해 곧바로 등록한다.
# - SOLAPI_ENABLED 는 건드리지 않는다(킬스위치 기본 꺼짐). 실발송 켜기는 별도 승인 후.
# 사용법: bash scripts/solapi-set-secrets.sh
set -euo pipefail
cd "$(dirname "$0")/.."

put_from_clipboard() {
  local name="$1" where="$2" ans val
  echo; echo "▶ ${name}"
  echo "  ${where} 에서 값을 복사한 뒤 Enter (건너뛰기: s + Enter)"
  read -r ans
  [[ "${ans}" == "s" ]] && { echo "  건너뜀: ${name}"; return 0; }
  val="$(pbpaste | tr -d '[:space:]')"
  [[ -z "${val}" ]] && { echo "  클립보드가 비어 있습니다: ${name}" >&2; return 1; }
  printf '%s' "${val}" | npx wrangler secret put "${name}" >/dev/null
  echo "  ✔ 등록 완료: ${name} (${#val}자, 값 비표시)"
  pbcopy < /dev/null
}

put_from_clipboard SOLAPI_API_KEY    "솔라피 콘솔 > 개발 > API Key 관리 (API Key)"
put_from_clipboard SOLAPI_API_SECRET "솔라피 콘솔 > 개발 > API Key 관리 (API Secret, 발급 직후에만 보임)"
put_from_clipboard SOLAPI_PF_ID      "솔라피 콘솔 > 카카오 채널 > 채널 상세 (pfId / 채널 ID)"

echo; echo "▶ SOLAPI_WEBHOOK_SECRET (자동 생성)"
openssl rand -hex 32 | npx wrangler secret put SOLAPI_WEBHOOK_SECRET >/dev/null
echo "  ✔ 등록 완료 (무작위 64자, 비표시)"

echo; echo "등록된 시크릿 이름(값 아님):"
npx wrangler secret list 2>/dev/null | grep -o '"name": *"[^"]*"' | grep SOLAPI || true
echo; echo "끝났습니다. Claude 에게 '솔라피 시크릿 등록 끝'이라고 알려 주세요."
