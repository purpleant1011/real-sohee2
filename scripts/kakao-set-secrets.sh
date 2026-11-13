#!/usr/bin/env bash
# 카카오 로그인용 Cloudflare 시크릿 등록 도우미 (사람이 직접 실행).
# - 값은 화면에 출력되지 않고, 이 저장소·대화·로그 어디에도 기록되지 않는다.
# - 카카오 콘솔에서 값을 "복사"한 뒤 Enter 를 누르면 클립보드(pbpaste)에서 읽어 wrangler 로 전달한다.
# - KAKAO_STATE_SECRET 은 이 스크립트가 무작위로 생성해 곧바로 등록한다(아무도 볼 수 없음).
# 사용법: bash scripts/kakao-set-secrets.sh
set -euo pipefail

cd "$(dirname "$0")/.."

put_from_clipboard() {
  local name="$1" where="$2"
  echo
  echo "▶ ${name}"
  echo "  ${where} 에서 값을 복사한 뒤 Enter 를 누르세요. (건너뛰려면 s 입력 후 Enter)"
  local ans
  read -r ans
  if [[ "${ans}" == "s" ]]; then
    echo "  건너뜀: ${name}"
    return 0
  fi
  local val
  val="$(pbpaste | tr -d '[:space:]')"
  if [[ -z "${val}" ]]; then
    echo "  클립보드가 비어 있어 건너뜁니다: ${name}" >&2
    return 1
  fi
  printf '%s' "${val}" | npx wrangler secret put "${name}" >/dev/null
  echo "  ✔ 등록 완료: ${name} (값은 표시하지 않음, ${#val}자)"
  pbcopy < /dev/null   # 클립보드 비우기
}

echo "카카오 앱 '소희' (ID 1638688) 시크릿을 Cloudflare 에 등록합니다."

put_from_clipboard KAKAO_JS_KEY        "카카오 콘솔 > 앱 > 플랫폼 키 > JavaScript 키 (복사 아이콘)"
put_from_clipboard KAKAO_REST_API_KEY  "카카오 콘솔 > 앱 > 플랫폼 키 > REST API 키 (복사 아이콘)"
put_from_clipboard KAKAO_CLIENT_SECRET "카카오 콘솔 > 앱 > 플랫폼 키 > REST API 키 > 클라이언트 시크릿 (발급 후 복사)"
put_from_clipboard KAKAO_WEBHOOK_SECRET "카카오 콘솔 > 앱 > 플랫폼 키 > 어드민 키 (또는 '앱 > 어드민 키' 메뉴, 복사)"

echo
echo "▶ KAKAO_STATE_SECRET (자동 생성)"
openssl rand -hex 32 | npx wrangler secret put KAKAO_STATE_SECRET >/dev/null
echo "  ✔ 등록 완료: KAKAO_STATE_SECRET (무작위 64자, 표시하지 않음)"

echo
echo "등록된 시크릿 이름 목록(값 아님):"
npx wrangler secret list 2>/dev/null | grep -o '"name": *"[^"]*"' || npx wrangler secret list
echo
echo "끝났습니다. Claude 에게 '시크릿 등록 끝'이라고 알려 주세요."
