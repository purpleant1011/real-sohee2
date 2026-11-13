#!/usr/bin/env bash
# 솔라피 웹훅 시크릿을 새로 만들어 Cloudflare 에 등록하고, 같은 값을 클립보드에 복사한다(사람이 직접 실행).
# 값은 화면에 출력하지 않는다. 이어서 솔라피 웹훅 폼의 "Secret HTTP Header" 칸에 붙여 넣으면 된다.
set -euo pipefail
cd "$(dirname "$0")/.."
val="$(openssl rand -hex 32)"
printf '%s' "${val}" | npx wrangler secret put SOLAPI_WEBHOOK_SECRET >/dev/null
printf '%s' "${val}" | pbcopy
echo "✔ SOLAPI_WEBHOOK_SECRET 등록 완료. 값이 클립보드에 복사되었습니다(화면에는 표시하지 않음)."
echo "  솔라피 웹훅 폼의 'Secret HTTP Header' 칸에 붙여 넣고(⌘V) 웹훅 등록을 누르세요. 끝나면 클립보드를 비우세요: pbcopy < /dev/null"
