#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
# Always creates a new, disposable local cluster. Never reads DATABASE_URL.
root="$(git rev-parse --show-toplevel)"
pgbin="${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
tmp="$(mktemp -d /tmp/sohee-naver-revision.XXXXXX)"
cleanup() {
  "$pgbin/pg_ctl" -D "$tmp/db" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT
"$pgbin/initdb" -D "$tmp/db" -A trust -U postgres --no-locale >/dev/null
if ! "$pgbin/pg_ctl" -D "$tmp/db" -l "$tmp/server.log" -o "-k $tmp -c listen_addresses=''" -w start >/dev/null; then
  python3 -I -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).read_text())' "$tmp/server.log"
  exit 1
fi
"$pgbin/psql" -X -h "$tmp" -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f "$root/tests/integration/naver-block-revision/fixture.sql" \
  -f "$root/supabase/migrations/20261029130000_naver_revision_readiness.sql" \
  -f "$root/tests/integration/naver-block-revision/readiness-missing.sql" \
  -f "$root/supabase/migrations/20261028160000_naver_block_revision.sql" \
  -f "$root/supabase/migrations/20261028170000_naver_version_restore.sql" \
  -f "$root/supabase/migrations/20261028180000_naver_title_tags_revision.sql" \
  -f "$root/tests/integration/naver-block-revision/readiness.sql" \
  -f "$root/tests/integration/naver-block-revision/assertions.sql"
node "$root/tests/integration/naver-block-revision/race.mjs" "$pgbin/psql" "$tmp"
"$pgbin/psql" -X -h "$tmp" -U postgres -d postgres -v ON_ERROR_STOP=1 -f "$root/tests/integration/naver-block-revision/restore.sql"
"$pgbin/psql" -X -h "$tmp" -U postgres -d postgres -v ON_ERROR_STOP=1 -f "$root/tests/integration/naver-block-revision/meta.sql"
