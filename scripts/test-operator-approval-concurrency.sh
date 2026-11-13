#!/usr/bin/env bash

set -euo pipefail

fail() {
  printf 'operator approval concurrency test failed: %s\n' "$1" >&2
  exit 1
}

TASK3_TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sohee-task3-concurrency.XXXXXX")"
TASK3_DB_URL=''
TASK3_PSQL=''
TASK3_SESSION_A_PID=''
TASK3_SESSION_B_PID=''
TASK3_SESSION_A_FIFO_FD=''
TASK3_TEST_FAIL_AFTER_SESSION_A_READY="${TASK3_TEST_FAIL_AFTER_SESSION_A_READY:-0}"

reap_background_session() {
  local process_id="$1"
  local _

  [[ -n "$process_id" ]] || return 0
  for _ in {1..50}; do
    kill -0 "$process_id" >/dev/null 2>&1 || break
    sleep 0.05
  done
  if kill -0 "$process_id" >/dev/null 2>&1; then
    kill -KILL "$process_id" >/dev/null 2>&1 || true
  fi
  wait "$process_id" >/dev/null 2>&1 || true
}

stop_background_sessions() {
  local process_id

  if [[ -n "$TASK3_SESSION_A_FIFO_FD" ]]; then
    exec 3>&- || true
    TASK3_SESSION_A_FIFO_FD=''
  fi

  for process_id in "$TASK3_SESSION_A_PID" "$TASK3_SESSION_B_PID"; do
    if [[ -n "$process_id" ]] && kill -0 "$process_id" >/dev/null 2>&1; then
      kill -TERM "$process_id" >/dev/null 2>&1 || true
    fi
  done
  reap_background_session "$TASK3_SESSION_A_PID"
  reap_background_session "$TASK3_SESSION_B_PID"
  TASK3_SESSION_A_PID=''
  TASK3_SESSION_B_PID=''
}

cleanup() {
  local exit_status=$?

  trap - EXIT INT TERM
  stop_background_sessions
  if [[ -n "$TASK3_DB_URL" && -n "$TASK3_PSQL" ]]; then
    "$TASK3_PSQL" "$TASK3_DB_URL" -X -q -v ON_ERROR_STOP=0 >/dev/null 2>&1 <<'SQL' || true
begin;
alter table public.platform_audit_events disable trigger platform_audit_events_immutable;
alter table public.credit_ledger_entries disable trigger credit_ledger_entries_append_only;
delete from public.platform_audit_events
where actor_user_id in (
  'a3100000-0000-4000-8000-000000000001',
  'a3200000-0000-4000-8000-000000000001'
);
delete from public.admin_approval_requests
where requested_by in (
  'a3100000-0000-4000-8000-000000000001',
  'a3200000-0000-4000-8000-000000000001'
);
delete from public.platform_admin_role_assignments
where user_id in (
  'a3100000-0000-4000-8000-000000000001',
  'a3100000-0000-4000-8000-000000000002',
  'a3200000-0000-4000-8000-000000000001',
  'a3200000-0000-4000-8000-000000000002'
);
delete from public.platform_admin_members
where user_id in (
  'a3100000-0000-4000-8000-000000000001',
  'a3100000-0000-4000-8000-000000000002',
  'a3200000-0000-4000-8000-000000000001',
  'a3200000-0000-4000-8000-000000000002'
);
delete from public.credit_ledger_entries
where workspace_id in (
  'a3100000-0000-4000-8000-000000000101',
  'a3200000-0000-4000-8000-000000000101'
);
delete from public.credit_reservations
where workspace_id in (
  'a3100000-0000-4000-8000-000000000101',
  'a3200000-0000-4000-8000-000000000101'
);
delete from public.credit_accounts
where workspace_id in (
  'a3100000-0000-4000-8000-000000000101',
  'a3200000-0000-4000-8000-000000000101'
);
delete from public.workspace_members
where workspace_id in (
  'a3100000-0000-4000-8000-000000000101',
  'a3200000-0000-4000-8000-000000000101'
);
delete from public.workspaces
where id in (
  'a3100000-0000-4000-8000-000000000101',
  'a3200000-0000-4000-8000-000000000101'
);
delete from auth.users
where id in (
  'a3100000-0000-4000-8000-000000000001',
  'a3100000-0000-4000-8000-000000000002',
  'a3200000-0000-4000-8000-000000000001',
  'a3200000-0000-4000-8000-000000000002'
);
alter table public.credit_ledger_entries enable trigger credit_ledger_entries_append_only;
alter table public.platform_audit_events enable trigger platform_audit_events_immutable;
commit;
SQL
  fi
  rm -rf -- "$TASK3_TEMP_DIR"
  return "$exit_status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if command -v psql >/dev/null 2>&1; then
  TASK3_PSQL="$(command -v psql)"
elif [[ -x /opt/homebrew/opt/postgresql@16/bin/psql ]]; then
  TASK3_PSQL='/opt/homebrew/opt/postgresql@16/bin/psql'
elif [[ -x /opt/homebrew/opt/libpq/bin/psql ]]; then
  TASK3_PSQL='/opt/homebrew/opt/libpq/bin/psql'
else
  fail 'psql was not found on PATH or an approved Homebrew path'
fi

TASK3_STATUS_ENV="$(npx supabase status -o env 2>"$TASK3_TEMP_DIR/supabase-status.err")" \
  || fail 'local Supabase status is unavailable'
TASK3_DB_URL="$(
  printf '%s\n' "$TASK3_STATUS_ENV" \
    | sed -n 's/^DB_URL="\([^"]*\)"$/\1/p' \
    | head -n 1
)"
unset TASK3_STATUS_ENV
[[ -n "$TASK3_DB_URL" ]] || fail 'local DB_URL was not present in Supabase status'

"$TASK3_PSQL" "$TASK3_DB_URL" -X -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
begin;
alter table public.platform_audit_events disable trigger platform_audit_events_immutable;
alter table public.credit_ledger_entries disable trigger credit_ledger_entries_append_only;
delete from public.platform_audit_events
where actor_user_id in (
  'a3100000-0000-4000-8000-000000000001',
  'a3200000-0000-4000-8000-000000000001'
);
delete from public.admin_approval_requests
where requested_by in (
  'a3100000-0000-4000-8000-000000000001',
  'a3200000-0000-4000-8000-000000000001'
);
delete from public.platform_admin_role_assignments
where user_id in (
  'a3100000-0000-4000-8000-000000000001',
  'a3100000-0000-4000-8000-000000000002',
  'a3200000-0000-4000-8000-000000000001',
  'a3200000-0000-4000-8000-000000000002'
);
delete from public.platform_admin_members
where user_id in (
  'a3100000-0000-4000-8000-000000000001',
  'a3100000-0000-4000-8000-000000000002',
  'a3200000-0000-4000-8000-000000000001',
  'a3200000-0000-4000-8000-000000000002'
);
delete from public.credit_ledger_entries
where workspace_id in (
  'a3100000-0000-4000-8000-000000000101',
  'a3200000-0000-4000-8000-000000000101'
);
delete from public.credit_reservations
where workspace_id in (
  'a3100000-0000-4000-8000-000000000101',
  'a3200000-0000-4000-8000-000000000101'
);
delete from public.credit_accounts
where workspace_id in (
  'a3100000-0000-4000-8000-000000000101',
  'a3200000-0000-4000-8000-000000000101'
);
delete from public.workspace_members
where workspace_id in (
  'a3100000-0000-4000-8000-000000000101',
  'a3200000-0000-4000-8000-000000000101'
);
delete from public.workspaces
where id in (
  'a3100000-0000-4000-8000-000000000101',
  'a3200000-0000-4000-8000-000000000101'
);
delete from auth.users
where id in (
  'a3100000-0000-4000-8000-000000000001',
  'a3100000-0000-4000-8000-000000000002',
  'a3200000-0000-4000-8000-000000000001',
  'a3200000-0000-4000-8000-000000000002'
);
alter table public.credit_ledger_entries enable trigger credit_ledger_entries_append_only;
alter table public.platform_audit_events enable trigger platform_audit_events_immutable;
commit;

insert into auth.users (id, email)
values
  ('a3100000-0000-4000-8000-000000000001', 'task3-concurrency-identical-requester@sohee.test.invalid'),
  ('a3100000-0000-4000-8000-000000000002', 'task3-concurrency-identical-owner@sohee.test.invalid'),
  ('a3200000-0000-4000-8000-000000000001', 'task3-concurrency-conflict-requester@sohee.test.invalid'),
  ('a3200000-0000-4000-8000-000000000002', 'task3-concurrency-conflict-owner@sohee.test.invalid');

insert into public.workspaces (id, name, created_by)
values
  ('a3100000-0000-4000-8000-000000000101', 'Task 3 concurrency identical', 'a3100000-0000-4000-8000-000000000001'),
  ('a3200000-0000-4000-8000-000000000101', 'Task 3 concurrency conflict', 'a3200000-0000-4000-8000-000000000001');

insert into public.platform_admin_members (user_id, status, mfa_required)
values
  ('a3100000-0000-4000-8000-000000000001', 'active', true),
  ('a3100000-0000-4000-8000-000000000002', 'active', true),
  ('a3200000-0000-4000-8000-000000000001', 'active', true),
  ('a3200000-0000-4000-8000-000000000002', 'active', true);

insert into public.platform_admin_role_assignments (user_id, role_key, workspace_id)
values
  ('a3100000-0000-4000-8000-000000000001', 'platform_owner', null),
  ('a3100000-0000-4000-8000-000000000002', 'platform_owner', null),
  ('a3200000-0000-4000-8000-000000000001', 'platform_owner', null),
  ('a3200000-0000-4000-8000-000000000002', 'platform_owner', null);
SQL

wait_for_file() {
  local path="$1"
  local process_id="$2"
  local _
  for _ in {1..100}; do
    [[ -e "$path" ]] && return 0
    kill -0 "$process_id" >/dev/null 2>&1 || return 1
    sleep 0.05
  done
  return 1
}

wait_for_advisory_lock() {
  local application_name="$1"
  local process_id="$2"
  local _
  local waiting
  for _ in {1..100}; do
    kill -0 "$process_id" >/dev/null 2>&1 || return 1
    waiting="$(
      "$TASK3_PSQL" "$TASK3_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
        -c "select coalesce(bool_or(wait_event_type = 'Lock' and wait_event = 'advisory'), false) from pg_stat_activity where application_name = '$application_name';" \
        2>"$TASK3_TEMP_DIR/lock-check.err"
    )" || return 1
    [[ "$waiting" == 't' ]] && return 0
    sleep 0.05
  done
  return 1
}

assert_case_counts() {
  local actor_id="$1"
  local counts
  counts="$(
    "$TASK3_PSQL" "$TASK3_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
      -c "select (select count(*) from public.admin_approval_requests where requested_by = '$actor_id')::text || ':' || (select count(*) from public.platform_audit_events where actor_user_id = '$actor_id')::text;" \
      2>"$TASK3_TEMP_DIR/count-check.err"
  )" || fail 'fixture count query failed'
  [[ "$counts" == '1:1' ]] || fail 'concurrent case did not leave exactly one request and one audit'
}

run_case() {
  local case_name="$1"
  local actor_id="$2"
  local workspace_id="$3"
  local target_id="$4"
  local idempotency_key="$5"
  local second_reason="$6"
  local expected_second_outcome="$7"
  local case_dir="$TASK3_TEMP_DIR/$case_name"
  local session_a_fifo="$case_dir/session-a.fifo"
  local session_a_ready="$case_dir/session-a.ready"
  local session_a_result="$case_dir/session-a.result"
  local session_b_result="$case_dir/session-b.result"
  local session_b_error="$case_dir/session-b.err"
  local session_a_status
  local session_b_status
  local application_b="task3_${case_name}_b"

  mkdir -p "$case_dir"
  mkfifo "$session_a_fifo"

  PGAPPNAME="task3_${case_name}_a" \
    "$TASK3_PSQL" "$TASK3_DB_URL" -X -q -v ON_ERROR_STOP=1 \
      <"$session_a_fifo" >"$case_dir/session-a.out" 2>"$case_dir/session-a.err" &
  TASK3_SESSION_A_PID=$!
  exec 3>"$session_a_fifo"
  TASK3_SESSION_A_FIFO_FD='3'
  {
    printf '%s\n' 'begin;'
    printf '%s\n' 'set local role authenticated;'
    printf "select set_config('request.jwt.claim.sub', '%s', true);\n" "$actor_id"
    printf "select set_config('request.jwt.claims', '{\"sub\":\"%s\",\"role\":\"authenticated\",\"aal\":\"aal2\"}', true);\n" "$actor_id"
    printf '\\pset tuples_only on\n\\pset format unaligned\n'
    printf "\\o '%s'\n" "$session_a_result"
    printf "select public.request_admin_approval('%s', 'agreement.verify', 'agreement', '%s', 'concurrent request', '%s', 1, '{}'::jsonb);\n" \
      "$workspace_id" "$target_id" "$idempotency_key"
    printf '%s\n' '\o'
    printf "\\! touch '%s'\n" "$session_a_ready"
  } >&3

  wait_for_file "$session_a_ready" "$TASK3_SESSION_A_PID" \
    || fail "session A did not reach the held transaction for $case_name"

  if [[ "$TASK3_TEST_FAIL_AFTER_SESSION_A_READY" == '1' ]]; then
    fail "controlled failure after session A reached the held transaction for $case_name"
  fi

  (
    PGAPPNAME="$application_b" \
      "$TASK3_PSQL" "$TASK3_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
        >"$case_dir/session-b.out" 2>"$session_b_error" <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '$actor_id', true);
select set_config('request.jwt.claims', '{"sub":"$actor_id","role":"authenticated","aal":"aal2"}', true);
\pset tuples_only on
\pset format unaligned
\o '$session_b_result'
select public.request_admin_approval(
  '$workspace_id', 'agreement.verify', 'agreement', '$target_id',
  '$second_reason', '$idempotency_key', 1, '{}'::jsonb
);
\o
commit;
SQL
  ) &
  TASK3_SESSION_B_PID=$!

  wait_for_advisory_lock "$application_b" "$TASK3_SESSION_B_PID" \
    || fail "session B did not enter an advisory lock wait for $case_name"

  printf '%s\n' 'commit;' >&3
  exec 3>&-
  TASK3_SESSION_A_FIFO_FD=''
  set +e
  wait "$TASK3_SESSION_A_PID"
  session_a_status=$?
  TASK3_SESSION_A_PID=''
  wait "$TASK3_SESSION_B_PID"
  session_b_status=$?
  TASK3_SESSION_B_PID=''
  set -e

  [[ "$session_a_status" -eq 0 ]] || fail "session A failed for $case_name"
  grep -q '"status": "pending"' "$session_a_result" \
    || fail "session A did not return the first pending JSON for $case_name"

  if [[ "$expected_second_outcome" == 'identical' ]]; then
    [[ "$session_b_status" -eq 0 ]] || fail 'identical session B failed after lock release'
    cmp -s "$session_a_result" "$session_b_result" \
      || fail 'identical sessions did not return the same id and first pending JSON'
  else
    [[ "$session_b_status" -ne 0 ]] || fail 'conflicting session B unexpectedly succeeded'
    grep -q 'IDEMPOTENCY_CONFLICT' "$session_b_error" \
      || fail 'conflicting session B did not return IDEMPOTENCY_CONFLICT'
  fi

  assert_case_counts "$actor_id"
}

run_case \
  'identical' \
  'a3100000-0000-4000-8000-000000000001' \
  'a3100000-0000-4000-8000-000000000101' \
  'a3100000-0000-4000-8000-000000000401' \
  '1111111111111111111111111111111111111111111111111111111111111111' \
  'concurrent request' \
  'identical'

run_case \
  'conflict' \
  'a3200000-0000-4000-8000-000000000001' \
  'a3200000-0000-4000-8000-000000000101' \
  'a3200000-0000-4000-8000-000000000401' \
  '2222222222222222222222222222222222222222222222222222222222222222' \
  'different concurrent meaning' \
  'conflict'

printf '%s\n' 'operator approval concurrency: PASS'
