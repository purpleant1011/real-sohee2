#!/usr/bin/env bash
# 솔라피 웹훅 시크릿 교체: Cloudflare 와 클립보드에만 값을 넣고 화면에는 출력하지 않는다.
# 1) 새 시크릿 생성 -> Cloudflare SOLAPI_WEBHOOK_SECRET 등록
# 2) 같은 값을 클립보드에 복사 -> 솔라피 콘솔 웹훅의 'Secret HTTP Header' 칸에 붙여넣고 저장
set -euo pipefail
cd "$(dirname "$0")/.."
SECRET="$(openssl rand -hex 24)"
printf '%s' "$SECRET" | npx wrangler secret put SOLAPI_WEBHOOK_SECRET
printf '%s' "$SECRET" | pbcopy
unset SECRET
echo "완료: Cloudflare 등록 + 클립보드 복사(값은 화면에 출력하지 않음)."
echo "이제 https://console.solapi.com/webhooks 에서 sohee-prod-dlr 선택 -> 'Secret HTTP Header' 칸에 붙여넣기(Cmd+V) -> 웹훅 수정 저장."
