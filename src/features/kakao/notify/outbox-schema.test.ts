import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * [주의 및 계약 명시]
 * 본 테스트는 실제 PostgreSQL 인스턴스에 마이그레이션을 실행하는 통합 검증이 아닙니다.
 * Supabase 마이그레이션 SQL 초안 텍스트를 대상으로 테이블 구조, RLS 보안 정책,
 * 트리거 계약, PII(개인정보) 배제, 고유 제약조건이 아키텍처 스펙과 일치하는지 정적으로 검증하는
 * SQL 텍스트 계약 검사(SQL Text Contract Test)입니다.
 */

const MIGRATION_DIR = resolve(process.cwd(), 'supabase/migrations')
const TARGET_MIGRATION_FILENAME = '20261106040000_kakao_notification_outbox.sql'
const TARGET_MIGRATION_PATH = resolve(MIGRATION_DIR, TARGET_MIGRATION_FILENAME)
const RPC_MIGRATION_FILENAME = '20261106050000_kakao_notification_outbox_rpc.sql'
const RPC_MIGRATION_PATH = resolve(MIGRATION_DIR, RPC_MIGRATION_FILENAME)

describe('kakao_notification_outbox SQL schema contract', () => {
  it('migration file exists and timestamp is greater than existing max (20261106030000)', () => {
    const files = readdirSync(MIGRATION_DIR)
      .filter((file) => file.endsWith('.sql'))
      .sort()

    // 20261106030000_kakao_alimtalk_ledger.sql 직후 timestamp여야 함
    const previousMax = '20261106030000_kakao_alimtalk_ledger.sql'
    expect(files).toContain(previousMax)

    expect(existsSync(TARGET_MIGRATION_PATH)).toBe(true)
    expect(TARGET_MIGRATION_FILENAME > previousMax).toBe(true)
  })

  it('declares draft status and approval requirement without auto-starting live workers', () => {
    const sql = readFileSync(TARGET_MIGRATION_PATH, 'utf8')

    // 초안 및 운영 승인 필요 명시
    expect(sql).toMatch(/초안|Draft/i)
    expect(sql).toMatch(/적용\s*승인\s*필요|운영\s*승인/i)
    expect(sql).toMatch(/live\s*자동\s*시작\s*아님|자동\s*시작\s*금지/i)

    // claim/dispatch RPC는 이번 마이그레이션에 포함하지 않음 (후속 단계)
    expect(sql).not.toMatch(/create\s+(or\s+replace\s+)?function\s+[^;]*claim/i)
    expect(sql).not.toMatch(/create\s+(or\s+replace\s+)?function\s+[^;]*dispatch/i)
  })

  it('defines public.kakao_notification_outbox with all required columns and constraints', () => {
    const sql = readFileSync(TARGET_MIGRATION_PATH, 'utf8')

    // 테이블 생성
    expect(sql).toMatch(/create\s+table(\s+if\s+not\s+exists)?\s+public\.kakao_notification_outbox/i)

    // 필수 컬럼
    expect(sql).toMatch(/id\s+uuid(\s+default\s+gen_random_uuid\(\))?\s+primary\s+key/i)
    expect(sql).toMatch(/workspace_id\s+uuid\s+not\s+null\s+references\s+public\.workspaces/i)
    expect(sql).toMatch(/reservation_id\s+text\s+not\s+null\s+references\s+public\.reservations/i)
    expect(sql).toMatch(/reservation_updated_at\s+timestamptz\s+not\s+null/i)

    // 이벤트 열거형 체크 제약조건
    expect(sql).toMatch(/event\s+text\s+not\s+null/i)
    expect(sql).toContain("'BOOKING_CONFIRMED'")
    expect(sql).toContain("'BOOKING_CHANGED'")
    expect(sql).toContain("'BOOKING_CANCELLED'")

    // due_at 및 상태 열거형
    expect(sql).toMatch(/due_at\s+timestamptz\s+not\s+null/i)
    expect(sql).toMatch(/status\s+text\s+not\s+null/i)
    for (const status of ['READY', 'CLAIMED', 'SENDING', 'SENT', 'UNKNOWN', 'BLOCKED', 'SUPERSEDED', 'FAILED']) {
      expect(sql).toContain(`'${status}'`)
    }

    // 분산 락 및 리스 필드
    expect(sql).toMatch(/lease_token\s+uuid/i)
    expect(sql).toMatch(/lease_until\s+timestamptz/i)
    expect(sql).toMatch(/reason_code\s+text/i)
    expect(sql).toMatch(/created_at\s+timestamptz\s+not\s+null/i)
    expect(sql).toMatch(/updated_at\s+timestamptz\s+not\s+null/i)

    // 멱등성 보장 복합 유니크 제약
    expect(sql).toMatch(/unique\s*\(\s*workspace_id\s*,\s*reservation_id\s*,\s*reservation_updated_at\s*,\s*event\s*\)/i)
  })

  it('strictly excludes PII columns (privacy by design)', () => {
    const sql = readFileSync(TARGET_MIGRATION_PATH, 'utf8')

    // Outbox 테이블 컬럼 정의 블록 추출
    const tableMatch = sql.match(/create\s+table[^(]+\(([\s\S]+?)\);/i)
    expect(tableMatch).not.toBeNull()
    const tableBody = tableMatch![1]

    // 이름, 전화번호, 메시지 본문 등의 PII 컬럼이 없어야 함
    expect(tableBody).not.toMatch(/\bcustomer_name\b/i)
    expect(tableBody).not.toMatch(/\bcustomer_phone\b/i)
    expect(tableBody).not.toMatch(/\buser_phone\b/i)
    expect(tableBody).not.toMatch(/\brecipient_phone\b/i)
    expect(tableBody).not.toMatch(/\bphone_number\b/i)
    expect(tableBody).not.toMatch(/\bphone\b/i)
    expect(tableBody).not.toMatch(/\bmessage_body\b/i)
    expect(tableBody).not.toMatch(/\bbody\b/i)
    expect(tableBody).not.toMatch(/\btemplate_payload\b/i)
    expect(tableBody).not.toMatch(/\bpayload\b/i)
  })

  it('enforces strict RLS and service_role isolation', () => {
    const sql = readFileSync(TARGET_MIGRATION_PATH, 'utf8')

    expect(sql).toMatch(/alter\s+table\s+public\.kakao_notification_outbox\s+enable\s+row\s+level\s+security/i)
    expect(sql).toMatch(/revoke\s+all\s+on\s+(table\s+)?public\.kakao_notification_outbox\s+from\s+public,\s*anon,\s*authenticated/i)
    expect(sql).toMatch(/grant\s+all\s+on\s+(table\s+)?public\.kakao_notification_outbox\s+to\s+service_role/i)
    expect(sql).toMatch(/create\s+policy\s+["']service\s+role\s+full\s+access\s+on\s+kakao_notification_outbox["']/i)
  })

  it('triggers on reservation lifecycle events and handles outbox transitions correctly', () => {
    const sql = readFileSync(TARGET_MIGRATION_PATH, 'utf8')

    // 트리거 함수 및 트리거 정의 확인
    expect(sql).toMatch(/create\s+(or\s+replace\s+)?function\s+public\.kakao_/i)
    expect(sql).toMatch(/trigger\s+.*on\s+public\.reservations/i)

    // 이벤트 조건 확인: INSERT CONFIRMED, 상태 변경 CONFIRMED, CANCELLED
    expect(sql).toMatch(/BOOKING_CONFIRMED/i)
    expect(sql).toMatch(/BOOKING_CANCELLED/i)
    expect(sql).toMatch(/BOOKING_CHANGED/i)

    // slot_id 또는 metadata bookingStartsAt/startsAt 변경 감지
    expect(sql).toContain('slot_id')
    expect(sql).toMatch(/bookingStartsAt/i)
    expect(sql).toMatch(/startsAt/i)

    // 이전 READY, CLAIMED 건은 SUPERSEDED 처리하되, SENDING은 건드리지 않음
    expect(sql).toMatch(/status\s*=\s*'SUPERSEDED'/i)
    expect(sql).toMatch(/status\s+in\s*\(\s*'READY'\s*,\s*'CLAIMED'\s*\)/i)
    expect(sql).not.toMatch(/status\s*in\s*\([^)]*'SENDING'[^)]*\)\s*.*SUPERSEDED/i)

    // version 충돌 방지: updated_at가 증가하지 않는 관련 변경 시 자동 증가 선택 근거 주석 명시
    expect(sql).toMatch(/updated_at/i)
    expect(sql).toMatch(/선택\s*근거|version\s*충돌/i)
  })

  it('hardens trigger functions with fixed search_path and revokes execute from public', () => {
    const sql = readFileSync(TARGET_MIGRATION_PATH, 'utf8')

    // security definer 함수의 search_path 고정 (pg_catalog, public, pg_temp)
    expect(sql).toMatch(/create\s+(or\s+replace\s+)?function\s+public\.kakao_enqueue_reservation_outbox\(\)[\s\S]*?security\s+definer[\s\S]*?set\s+search_path\s*=\s*pg_catalog,\s*public,\s*pg_temp/i)
    expect(sql).toMatch(/create\s+(or\s+replace\s+)?function\s+public\.kakao_reservation_ensure_monotonic_updated_at\(\)[\s\S]*?set\s+search_path\s*=\s*pg_catalog,\s*public,\s*pg_temp/i)

    // public 실행 권한 회수 및 service_role 격리
    expect(sql).toMatch(/revoke\s+execute\s+on\s+function\s+public\.kakao_enqueue_reservation_outbox\(\)\s+from\s+public/i)
    expect(sql).toMatch(/revoke\s+execute\s+on\s+function\s+public\.kakao_reservation_ensure_monotonic_updated_at\(\)\s+from\s+public/i)
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.kakao_enqueue_reservation_outbox\(\)\s+to\s+service_role/i)
  })
})

describe('kakao_notification_outbox RPC schema contract', () => {
  it('rpc migration file exists and timestamp is greater than outbox table migration (20261106040000)', () => {
    const files = readdirSync(MIGRATION_DIR)
      .filter((file) => file.endsWith('.sql'))
      .sort()

    expect(files).toContain(TARGET_MIGRATION_FILENAME)
    expect(existsSync(RPC_MIGRATION_PATH)).toBe(true)
    expect(RPC_MIGRATION_FILENAME > TARGET_MIGRATION_FILENAME).toBe(true)
  })

  it('declares draft status and approval requirement in RPC migration', () => {
    const sql = readFileSync(RPC_MIGRATION_PATH, 'utf8')

    expect(sql).toMatch(/초안|Draft/i)
    expect(sql).toMatch(/적용\s*승인\s*필요|운영\s*승인/i)
    expect(sql).toMatch(/live\s*자동\s*시작\s*아님|자동\s*시작\s*금지/i)
  })

  it('defines all required RPC functions with exact names and parameters', () => {
    const sql = readFileSync(RPC_MIGRATION_PATH, 'utf8')

    // 1. claim_kakao_notification_job(p_job_id uuid, p_lease_token uuid) returns boolean
    expect(sql).toMatch(/create\s+(or\s+replace\s+)?function\s+public\.claim_kakao_notification_job\s*\(\s*p_job_id\s+uuid\s*,\s*p_lease_token\s+uuid\s*\)\s*returns\s+boolean/i)

    // 2. mark_kakao_notification_sending(p_job_id uuid, p_lease_token uuid) returns boolean
    expect(sql).toMatch(/create\s+(or\s+replace\s+)?function\s+public\.mark_kakao_notification_sending\s*\(\s*p_job_id\s+uuid\s*,\s*p_lease_token\s+uuid\s*\)\s*returns\s+boolean/i)

    // 3. finish_kakao_notification_job(p_job_id uuid, p_lease_token uuid, p_status text, p_reason_code text) returns boolean
    expect(sql).toMatch(/create\s+(or\s+replace\s+)?function\s+public\.finish_kakao_notification_job\s*\(\s*p_job_id\s+uuid\s*,\s*p_lease_token\s+uuid\s*,\s*p_status\s+text\s*,\s*p_reason_code\s+text\s*\)\s*returns\s+boolean/i)

    // 4. expire_kakao_notification_jobs() returns integer
    expect(sql).toMatch(/create\s+(or\s+replace\s+)?function\s+public\.expire_kakao_notification_jobs\s*\(\s*\)\s*returns\s+integer/i)
  })

  it('enforces security definer, fixed search_path, and service_role execute isolation on all RPCs', () => {
    const sql = readFileSync(RPC_MIGRATION_PATH, 'utf8')

    const rpcNames = [
      'claim_kakao_notification_job',
      'mark_kakao_notification_sending',
      'finish_kakao_notification_job',
      'expire_kakao_notification_jobs',
    ]

    for (const rpc of rpcNames) {
      // security definer 및 set search_path = pg_catalog, public, pg_temp
      const funcDefRegex = new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+public\\.${rpc}[\\s\\S]*?security\\s+definer[\\s\\S]*?set\\s+search_path\\s*=\\s*pg_catalog,\\s*public,\\s*pg_temp`, 'i')
      expect(sql).toMatch(funcDefRegex)

      // revoke from public, anon, authenticated
      const revokeRegex = new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${rpc}[^;]*from\\s+public,\\s*anon,\\s*authenticated`, 'i')
      expect(sql).toMatch(revokeRegex)

      // grant to service_role
      const grantRegex = new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${rpc}[^;]*to\\s+service_role`, 'i')
      expect(sql).toMatch(grantRegex)
    }
  })

  it('enforces reason_code regex and max 64 characters limit in finish RPC', () => {
    const sql = readFileSync(RPC_MIGRATION_PATH, 'utf8')

    // ^[A-Z0-9_]{1,64}$ 검증
    expect(sql).toContain('^[A-Z0-9_]{1,64}$')
  })

  it('enforces strict state transition rules in RPC logic', () => {
    const sql = readFileSync(RPC_MIGRATION_PATH, 'utf8')

    // claim: READY due<=now 또는 expired CLAIMED만 claim 가능, SENDING/UNKNOWN/SENT/BLOCKED/SUPERSEDED/FAILED 재claim 금지
    expect(sql).toMatch(/status\s+not\s+in\s*\(\s*'SENDING'\s*,\s*'UNKNOWN'\s*,\s*'SENT'\s*,\s*'BLOCKED'\s*,\s*'SUPERSEDED'\s*,\s*'FAILED'\s*\)/i)
    expect(sql).toMatch(/lease_until\s*=\s*statement_timestamp\(\)\s*\+\s*interval\s*'60 seconds'/i)

    // mark_sending: CLAIMED, valid lease, reservations version match 및 이벤트 상태 부합 -> SENDING
    expect(sql).toMatch(/status\s*=\s*'SENDING'/i)
    expect(sql).toMatch(/r\.updated_at\s*=\s*o\.reservation_updated_at/i)
    expect(sql).toMatch(/r\.status\s*=\s*'CONFIRMED'/i)
    expect(sql).toMatch(/r\.status\s*=\s*'CANCELLED'/i)

    // finish: CLAIMED -> BLOCKED/SUPERSEDED, SENDING -> SENT/UNKNOWN, lease cleared
    expect(sql).toMatch(/status\s*=\s*'CLAIMED'\s+and\s+p_status\s+in\s*\(\s*'BLOCKED'\s*,\s*'SUPERSEDED'\s*\)/i)
    expect(sql).toMatch(/status\s*=\s*'SENDING'\s+and\s+p_status\s+in\s*\(\s*'SENT'\s*,\s*'UNKNOWN'\s*\)/i)
    expect(sql).toMatch(/lease_token\s*=\s*null/i)
    expect(sql).toMatch(/lease_until\s*=\s*null/i)

    // expire: SENDING -> UNKNOWN만, never READY (set status = 'READY' 금지)
    expect(sql).toMatch(/update\s+public\.kakao_notification_outbox\s+set\s+status\s*=\s*'UNKNOWN'/i)
    expect(sql).toMatch(/where\s+status\s*=\s*'SENDING'\s+and\s+lease_until\s*<\s*statement_timestamp\(\)/i)
    expect(sql).not.toMatch(/set\s+status\s*=\s*'READY'/i)
  })

  it('strictly excludes PII from RPC parameters and code', () => {
    const sql = readFileSync(RPC_MIGRATION_PATH, 'utf8')

    expect(sql).not.toMatch(/\bcustomer_name\b/i)
    expect(sql).not.toMatch(/\bcustomer_phone\b/i)
    expect(sql).not.toMatch(/\buser_phone\b/i)
    expect(sql).not.toMatch(/\brecipient_phone\b/i)
    expect(sql).not.toMatch(/\bphone_number\b/i)
    expect(sql).not.toMatch(/\bphone\b/i)
    expect(sql).not.toMatch(/\bmessage_body\b/i)
    expect(sql).not.toMatch(/\btemplate_payload\b/i)
  })
})

