import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('Subscription Orders & Consents Migration Contract (20261109040000)', () => {
  const migrationPath = path.join(
    process.cwd(),
    'supabase/migrations/20261109040000_subscription_orders_consents.sql'
  )

  it('마이그레이션 파일이 존재해야 한다', () => {
    expect(fs.existsSync(migrationPath)).toBe(true)
  })

  const loadSql = () => {
    if (!fs.existsSync(migrationPath)) return ''
    return fs.readFileSync(migrationPath, 'utf8')
  }

  describe('테이블 및 제약조건 규격', () => {
    it('subscription_orders 테이블과 제약조건(check, unique, FK)이 정의되어야 한다', () => {
      const sql = loadSql()
      expect(sql).toMatch(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.subscription_orders\b/i)
      expect(sql).toMatch(/workspace_id\s+uuid\s+not\s+null\s+references\s+public\.workspaces\s*\(\s*id\s*\)/i)
      expect(sql).toMatch(/offer_code\s+text\s+not\s+null/i)
      expect(sql).toMatch(/check\s*\(\s*offer_code\s+in\s*\(\s*'STARTER_150K'\s*,\s*'GROWTH_300K'\s*,\s*'SCALE_500K'\s*\)\s*\)/i)
      expect(sql).toMatch(/amount_krw\s+integer\s+not\s+null/i)
      expect(sql).toMatch(/check\s*\(\s*amount_krw\s+in\s*\(\s*150000\s*,\s*300000\s*,\s*500000\s*\)\s*\)/i)
      expect(sql).toMatch(/currency\s+text\s+not\s+null/i)
      expect(sql).toMatch(/check\s*\(\s*currency\s*=\s*'KRW'\s*\)/i)
      expect(sql).toMatch(/status\s+text\s+not\s+null/i)
      expect(sql).toMatch(/check\s*\(\s*status\s+in\s*\(\s*'created'\s*,\s*'payment_pending'\s*,\s*'paid'\s*,\s*'cancelled'\s*,\s*'failed'\s*\)\s*\)/i)
      expect(sql).toMatch(/idempotency_key\s+text\s+not\s+null/i)
      expect(sql).toMatch(/created_by\s+uuid/i)
      expect(sql).toMatch(/created_at\s+timestamptz/i)
      expect(sql).toMatch(/unique\s*\(\s*workspace_id\s*,\s*idempotency_key\s*\)/i)
    })

    it('subscription_consents 테이블과 외래키 및 필수 컬럼이 정의되어야 한다', () => {
      const sql = loadSql()
      expect(sql).toMatch(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.subscription_consents\b/i)
      expect(sql).toMatch(/order_id\s+uuid\s+not\s+null\s+references\s+public\.subscription_orders\s*\(\s*id\s*\)/i)
      expect(sql).toMatch(/kind\s+text\s+not\s+null/i)
      expect(sql).toMatch(/check\s*\(\s*kind\s+in\s*\(\s*'terms'\s*,\s*'privacy'\s*,\s*'refund_auto_renewal'\s*,\s*'marketing'\s*\)\s*\)/i)
      expect(sql).toMatch(/policy_version\s+text\s+not\s+null/i)
      expect(sql).toMatch(/accepted_at\s+timestamptz\s+not\s+null/i)
    })

    it('subscription_webhook_events 테이블과 unique 제약 및 nullable order_id가 정의되어야 한다', () => {
      const sql = loadSql()
      expect(sql).toMatch(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.subscription_webhook_events\b/i)
      expect(sql).toMatch(/provider_event_id\s+text\s+not\s+null\s+unique/i)
      expect(sql).toMatch(/order_id\s+uuid(?:\s+null)?\s+references\s+public\.subscription_orders\s*\(\s*id\s*\)/i)
      expect(sql).toMatch(/received_at\s+timestamptz/i)
    })
  })

  describe('보안 및 RLS 계약', () => {
    it('3개 테이블 모두 enable row level security 가 선언되어야 한다 (정확히 3회)', () => {
      const sql = loadSql()
      const rlsMatches = sql.match(/alter\s+table\s+public\.(?:subscription_orders|subscription_consents|subscription_webhook_events)\s+enable\s+row\s+level\s+security/gi)
      expect(rlsMatches).not.toBeNull()
      expect(rlsMatches?.length).toBe(3)
    })

    it('anon 및 authenticated 에 대한 쓰기(INSERT, UPDATE, DELETE, ALL) grant 가 없어야 한다', () => {
      const sql = loadSql()
      // anon 쓰기 권한 일체 없음
      expect(sql).not.toMatch(/grant\s+[^;]*?(insert|update|delete|all)\s+[^;]*?to\s+[^;]*?\banon\b/i)
      // authenticated 쓰기 권한 일체 없음
      expect(sql).not.toMatch(/grant\s+[^;]*?(insert|update|delete|all)\s+[^;]*?to\s+[^;]*?\bauthenticated\b/i)

      // revoke all 존재 확인
      expect(sql).toMatch(/revoke\s+all\s+on\s+table\s+public\.subscription_orders\s+from\s+public,\s*anon,\s*authenticated/i)
      expect(sql).toMatch(/revoke\s+all\s+on\s+table\s+public\.subscription_consents\s+from\s+public,\s*anon,\s*authenticated/i)
      expect(sql).toMatch(/revoke\s+all\s+on\s+table\s+public\.subscription_webhook_events\s+from\s+public,\s*anon,\s*authenticated/i)

      // authenticated 에 오직 select 만 부여
      expect(sql).toMatch(/grant\s+select\s+on\s+table\s+public\.subscription_orders\s+to\s+authenticated/i)
      expect(sql).toMatch(/grant\s+select\s+on\s+table\s+public\.subscription_consents\s+to\s+authenticated/i)
      expect(sql).toMatch(/grant\s+select\s+on\s+table\s+public\.subscription_webhook_events\s+to\s+authenticated/i)
    })

    it('기존 workspace 멤버 판별 패턴(private.is_workspace_member)을 사용하는 select 정책이 존재해야 한다', () => {
      const sql = loadSql()
      expect(sql).toMatch(/create\s+policy\s+["']?[a-zA-Z0-9_]+["']?\s+on\s+public\.subscription_orders\s+for\s+select\s+to\s+authenticated\s+using\s*\(\s*\(?\s*select\s+private\.is_workspace_member\s*\(\s*workspace_id\s*\)\s*\)?\s*\)/i)
      expect(sql).toMatch(/private\.is_workspace_member/i)
    })

    it('금지 컬럼(card, cvc, billing_key, secret)이 전혀 포함되지 않아야 한다', () => {
      const sql = loadSql()
      expect(sql).not.toMatch(/\bcard\b/i)
      expect(sql).not.toMatch(/\bcvc\b/i)
      expect(sql).not.toMatch(/\bbilling_key\b/i)
      expect(sql).not.toMatch(/\bsecret\b/i)
    })

    it('기존 테이블이나 함수를 변경하지 않아야 한다', () => {
      const sql = loadSql()
      // alter table 기존테이블 금지
      expect(sql).not.toMatch(/alter\s+table\s+(?!public\.subscription_orders\b|public\.subscription_consents\b|public\.subscription_webhook_events\b)/i)
      // drop table/column 금지
      expect(sql).not.toMatch(/drop\s+(table|column)/i)
      // create or replace function 금지
      expect(sql).not.toMatch(/create\s+(or\s+replace\s+)?function/i)
    })
  })
})
