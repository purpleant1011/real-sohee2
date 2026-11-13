import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * [SQL 텍스트 계약 검사 (SQL Schema Contract Test)]
 * 실제 DB에 실행하지 않고, SQL 마이그레이션 파일의 테이블 구조, 무결성 제약조건,
 * PII 원천 배제, service_role 권한 격리(RLS/revoke), 필수 주석이 스펙과 일치하는지 정적으로 검증합니다.
 */

const MIGRATION_DIR = resolve(process.cwd(), 'supabase/migrations')
const TARGET_MIGRATION_FILENAME = '20261106060000_kakao_notification_policy_evidence.sql'
const TARGET_MIGRATION_PATH = resolve(MIGRATION_DIR, TARGET_MIGRATION_FILENAME)

describe('kakao_notification_policy_evidence SQL schema contract', () => {
  it('migration file exists and timestamp is 20261106060000 (after 20261106050000)', () => {
    const files = readdirSync(MIGRATION_DIR)
      .filter((file) => file.endsWith('.sql'))
      .sort()

    const previousMax = '20261106050000_kakao_notification_outbox_rpc.sql'
    expect(files).toContain(previousMax)

    expect(existsSync(TARGET_MIGRATION_PATH)).toBe(true)
    expect(TARGET_MIGRATION_FILENAME > previousMax).toBe(true)
  })

  it('declares draft status and pending approval requirement without auto-starting', () => {
    const sql = readFileSync(TARGET_MIGRATION_PATH, 'utf8')

    expect(sql).toMatch(/초안|Draft/i)
    expect(sql).toMatch(/직접\s*적용\s*금지|미적용/i)
    expect(sql).toMatch(/승인\s*필요|approval/i)
    expect(sql).toMatch(/live\s*자동\s*시작\s*아님/i)
  })

  it('defines public.kakao_notification_evidence with all required columns and constraints', () => {
    const sql = readFileSync(TARGET_MIGRATION_PATH, 'utf8')

    expect(sql).toMatch(/create\s+table\s+public\.kakao_notification_evidence/i)
    expect(sql).toMatch(/workspace_id\s+uuid\s+not\s+null\s+references\s+public\.workspaces/i)
    expect(sql).toMatch(/reservation_id\s+text\s+not\s+null\s+references\s+public\.reservations/i)
    expect(sql).toMatch(/subject_phone_sha256\s+text\s+not\s+null\s+check\s*\(\s*subject_phone_sha256\s*~\s*'\^\[0-9a-f\]\{64\}\$'\s*\)/i)
    expect(sql).toMatch(/purpose\s+text\s+not\s+null\s+default\s+'INFO'\s+check\s*\(\s*purpose\s*=\s*'INFO'\s*\)/i)
    expect(sql).toMatch(/granted_at\s+timestamptz\s+not\s+null/i)
    expect(sql).toMatch(/revoked_at\s+timestamptz/i)
    expect(sql).toMatch(/evidence_ref\s+text\s+not\s+null\s+check\s*\(\s*length\s*\(\s*trim\s*\(\s*evidence_ref\s*\)\s*\)\s*>\s*0\s*\)/i)
    expect(sql).toMatch(/unique\s*\(\s*workspace_id\s*,\s*reservation_id\s*\)/i)
  })

  it('annotates that SHA256 is not anonymization but authorization isolation auxiliary', () => {
    const sql = readFileSync(TARGET_MIGRATION_PATH, 'utf8')

    expect(sql).toMatch(/익명화(\([^)]*\))?\s*(가\s*아니고|가\s*아니며|아님)/i)
    expect(sql).toMatch(/권한\s*격리\s*보조/i)
  })

  it('strictly excludes raw phone and customer name columns from kakao_notification_evidence', () => {
    const sql = readFileSync(TARGET_MIGRATION_PATH, 'utf8')

    const tableMatch = sql.match(/create\s+table\s+public\.kakao_notification_evidence\s*\(([\s\S]+?)\);/i)
    expect(tableMatch).not.toBeNull()
    const tableBody = tableMatch![1]

    expect(tableBody).not.toMatch(/\braw_phone\b/i)
    expect(tableBody).not.toMatch(/\brawphone\b/i)
    expect(tableBody).not.toMatch(/\bcustomer_phone\b/i)
    expect(tableBody).not.toMatch(/\bphone_number\b/i)
    expect(tableBody).not.toMatch(/\bphone\s+text\b/i)
    expect(tableBody).not.toMatch(/\bcustomer_name\b/i)
    expect(tableBody).not.toMatch(/\bname\b/i)
  })

  it('defines public.kakao_template_approvals with all required columns and constraints', () => {
    const sql = readFileSync(TARGET_MIGRATION_PATH, 'utf8')

    expect(sql).toMatch(/create\s+table\s+public\.kakao_template_approvals/i)
    expect(sql).toMatch(/template_code\s+text\s+primary\s+key/i)
    expect(sql).toMatch(/template_id\s+text\s+not\s+null/i)
    expect(sql).toMatch(/channel_id\s+text\s+not\s+null/i)
    expect(sql).toMatch(/body_sha256\s+text\s+not\s+null\s+check\s*\(\s*body_sha256\s*~\s*'\^\[0-9a-f\]\{64\}\$'\s*\)/i)
    expect(sql).toMatch(/state\s+text\s+not\s+null\s+check\s*\(\s*state\s+in\s*\(\s*'APPROVED'\s*,\s*'REJECTED'\s*,\s*'PENDING'\s*\)\s*\)/i)
    expect(sql).toMatch(/verified_at\s+timestamptz\s+not\s+null/i)
    expect(sql).toMatch(/evidence_ref\s+text\s+not\s+null\s+check\s*\(\s*length\s*\(\s*trim\s*\(\s*evidence_ref\s*\)\s*\)\s*>\s*0\s*\)/i)
  })

  it('annotates template approval rule: table existence is not approval; console/API proof must be verified and saved', () => {
    const sql = readFileSync(TARGET_MIGRATION_PATH, 'utf8')

    expect(sql).toMatch(/테이블\s*존재\s*=\s*승인\s*아님|테이블에\s*행이\s*존재한다는\s*사실\s*자체만으로/i)
    expect(sql).toMatch(/콘솔(\/API)?\s*증거/i)
  })

  it('enforces service_role only RLS and revokes all permissions from public, anon, authenticated', () => {
    const sql = readFileSync(TARGET_MIGRATION_PATH, 'utf8')

    // evidence 테이블 RLS 및 revoke
    expect(sql).toMatch(/alter\s+table\s+public\.kakao_notification_evidence\s+enable\s+row\s+level\s+security/i)
    expect(sql).toMatch(/revoke\s+all\s+on\s+public\.kakao_notification_evidence\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i)
    expect(sql).toMatch(/grant\s+all\s+on\s+public\.kakao_notification_evidence\s+to\s+service_role/i)

    // template approvals 테이블 RLS 및 revoke
    expect(sql).toMatch(/alter\s+table\s+public\.kakao_template_approvals\s+enable\s+row\s+level\s+security/i)
    expect(sql).toMatch(/revoke\s+all\s+on\s+public\.kakao_template_approvals\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i)
    expect(sql).toMatch(/grant\s+all\s+on\s+public\.kakao_template_approvals\s+to\s+service_role/i)
  })
})
