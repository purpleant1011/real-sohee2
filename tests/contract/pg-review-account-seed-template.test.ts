import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('PG Review Account Seed Template Contract', () => {
  const templatePath = path.join(
    process.cwd(),
    'scripts/sql/pg-review-account-seed.sql.template'
  )

  it('1. 템플릿 파일이 scripts/sql/pg-review-account-seed.sql.template 경로에 존재해야 한다', () => {
    expect(fs.existsSync(templatePath)).toBe(true)
  })

  const loadSql = (): string => {
    if (!fs.existsSync(templatePath)) return ''
    return fs.readFileSync(templatePath, 'utf8')
  }

  describe('트랜잭션 및 필수 안내 주석 계약', () => {
    it('상단 주석에 "실행 전 사용자 확인 필요, 운영 DB" 문구가 정확히 명시되어야 한다', () => {
      const sql = loadSql()
      expect(sql).toContain('실행 전 사용자 확인 필요, 운영 DB')
    })

    it('상단 주석에 :user_id 치환 방법(따옴표 안의 :user_id 텍스트만 auth 사용자 uuid 로 바꾸고 따옴표·::uuid 는 유지)이 명시되어야 한다', () => {
      const sql = loadSql()
      expect(sql).toContain('따옴표')
      expect(sql).toContain('::uuid')
    })

    it('BEGIN 과 COMMIT 트랜잭션으로 안전하게 감싸져 있어야 한다', () => {
      const sql = loadSql()
      expect(sql).toMatch(/^\s*BEGIN\s*;/im)
      expect(sql).toMatch(/^\s*COMMIT\s*;/im)
    })
  })

  describe('자리표시자 및 비밀값 부재(비밀번호·토큰·실제 UUID·이메일 금지) 계약', () => {
    it(':user_id 자리표시자가 존재해야 한다', () => {
      const sql = loadSql()
      expect(sql).toMatch(/:user_id\b/)
    })

    it('password, secret, token 문자열이 파일 전체에 부재해야 한다', () => {
      const sql = loadSql()
      expect(sql).not.toMatch(/password/i)
      expect(sql).not.toMatch(/secret/i)
      expect(sql).not.toMatch(/token/i)
    })

    it('실제 하드코딩된 UUID(36자리 hex)가 파일에 부재해야 한다', () => {
      const sql = loadSql()
      // e.g. 12345678-1234-1234-1234-123456789abc 형태의 실제 uuid 부재 검증
      const uuidRegex = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i
      expect(sql).not.toMatch(uuidRegex)
    })

    it('실제 이메일 주소(@포함 형태)가 파일에 부재해야 한다', () => {
      const sql = loadSql()
      const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/
      expect(sql).not.toMatch(emailRegex)
    })
  })

  describe('DML 제한: 오직 INSERT ... ON CONFLICT DO NOTHING 만 허용', () => {
    it('UPDATE 문이 부재해야 한다', () => {
      const sql = loadSql()
      expect(sql).not.toMatch(/\bUPDATE\b/i)
    })

    it('DELETE 문이 부재해야 한다', () => {
      const sql = loadSql()
      expect(sql).not.toMatch(/\bDELETE\b/i)
    })

    it('DROP 문이 부재해야 한다', () => {
      const sql = loadSql()
      expect(sql).not.toMatch(/\bDROP\b/i)
    })

    it('GRANT 및 REVOKE 문이 부재해야 한다', () => {
      const sql = loadSql()
      expect(sql).not.toMatch(/\bGRANT\b/i)
      expect(sql).not.toMatch(/\bREVOKE\b/i)
    })

    it('ALTER 문이 부재해야 한다', () => {
      const sql = loadSql()
      expect(sql).not.toMatch(/\bALTER\b/i)
    })

    it('모든 INSERT 절은 ON CONFLICT ... DO NOTHING 을 수반해야 한다', () => {
      const sql = loadSql()
      const insertMatches = sql.match(/INSERT\s+INTO/gi) ?? []
      expect(insertMatches.length).toBeGreaterThan(0)

      const doNothingMatches = sql.match(/ON\s+CONFLICT(?:\s*\([^)]+\))?\s+DO\s+NOTHING/gi) ?? []
      expect(doNothingMatches.length).toBe(insertMatches.length)
    })
  })

  describe('역할(Role) 및 관리자 권한 격리 계약 (정정사항 반영)', () => {
    it('플랫폼 관리자 테이블(operators, admin_users 등) 삽입이 부재해야 한다', () => {
      const sql = loadSql()
      expect(sql).not.toMatch(/INSERT\s+INTO\s+(?:public\.)?operators\b/i)
      expect(sql).not.toMatch(/INSERT\s+INTO\s+(?:public\.)?admin_users\b/i)
      expect(sql).not.toMatch(/INSERT\s+INTO\s+(?:public\.)?operator_memberships\b/i)
      expect(sql).not.toMatch(/INSERT\s+INTO\s+(?:public\.)?operator_invitations\b/i)
    })

    it("workspace role 에 'owner' 또는 'admin'이 부재해야 한다", () => {
      const sql = loadSql()
      expect(sql).not.toMatch(/'owner'/i)
      expect(sql).not.toMatch(/'admin'/i)
    })

    it("workspace_members 의 role 은 오직 'manager' 만 지정되어야 한다", () => {
      const sql = loadSql()
      expect(sql).toMatch(/workspace_members/i)
      expect(sql).toMatch(/'manager'/)
      const roleMatches = Array.from(sql.matchAll(/'(owner|admin|editor|reviewer|viewer|manager)'/gi)).map(m => m[1].toLowerCase())
      expect(roleMatches.length).toBeGreaterThan(0)
      for (const role of roleMatches) {
        expect(role).toBe('manager')
      }
    })

    it("workspace_members 의 status 는 'active' 로 지정되어야 한다", () => {
      const sql = loadSql()
      expect(sql).toMatch(/'active'/)
    })
  })

  describe('크레딧 지급·구독·결제 행 생성 금지 계약', () => {
    it('credit, subscription, payment 관련 테이블에 INSERT 가 부재해야 한다', () => {
      const sql = loadSql()
      expect(sql).not.toMatch(/INSERT\s+INTO\s+.*credit_accounts\b/i)
      expect(sql).not.toMatch(/INSERT\s+INTO\s+.*credit_ledger_entries\b/i)
      expect(sql).not.toMatch(/INSERT\s+INTO\s+.*workspace_credit_states\b/i)
      expect(sql).not.toMatch(/INSERT\s+INTO\s+.*trial_entitlements\b/i)
      expect(sql).not.toMatch(/INSERT\s+INTO\s+.*agent_energy_ledgers\b/i)
      expect(sql).not.toMatch(/INSERT\s+INTO\s+.*subscriptions\b/i)
      expect(sql).not.toMatch(/INSERT\s+INTO\s+.*subscription_orders\b/i)
      expect(sql).not.toMatch(/INSERT\s+INTO\s+.*payments\b/i)
      expect(sql).not.toMatch(/INSERT\s+INTO\s+.*payment_methods\b/i)
    })
  })

  describe('인증/하네스 위장 행 배제 계약 (추가 정정 반영)', () => {
    it('business_verifications, harnesses, gates 등 위장용 테이블 삽입이 부재해야 한다', () => {
      const sql = loadSql()
      expect(sql).not.toMatch(/INSERT\s+INTO\s+.*business_verifications\b/i)
      expect(sql).not.toMatch(/INSERT\s+INTO\s+.*workspace_knowledge_harnesses\b/i)
      expect(sql).not.toMatch(/INSERT\s+INTO\s+.*harness_rules\b/i)
      expect(sql).not.toMatch(/INSERT\s+INTO\s+.*workspace_onboarding_gates\b/i)
    })
  })

  describe('시드 대상 3대 정본 테이블 계약 (workspaces, workspace_members, business_profiles)', () => {
    it("workspaces 테이블에 '소희 심사용 체험 매장' 이름으로 격리 워크스페이스가 삽입되어야 한다", () => {
      const sql = loadSql()
      expect(sql).toMatch(/INSERT\s+INTO\s+public\.workspaces\b/i)
      expect(sql).toContain('소희 심사용 체험 매장')
    })

    it("workspaces 테이블에 workspace_kind 가 'demo' 로 명시되어야 하고 'production' 은 부재해야 한다", () => {
      const sql = loadSql()
      expect(sql).toMatch(/workspace_kind/i)
      expect(sql).toMatch(/'demo'/)
      expect(sql).not.toMatch(/'production'/i)
    })

    it('workspace_members 테이블에 :user_id 가 manager 및 active 로 삽입되어야 한다', () => {
      const sql = loadSql()
      expect(sql).toMatch(/INSERT\s+INTO\s+public\.workspace_members\b/i)
      expect(sql).toMatch(/:user_id/i)
      expect(sql).toMatch(/'manager'/)
      expect(sql).toMatch(/'active'/)
    })

    it("business_profiles 에 business_name 으로 '소희 심사용 체험 매장'이 삽입되어야 한다 (신규 매장 아님)", () => {
      const sql = loadSql()
      expect(sql).toMatch(/INSERT\s+INTO\s+public\.business_profiles\b/i)
      expect(sql).not.toContain('신규 매장')
      expect(sql).toContain('소희 심사용 체험 매장')
    })
  })
})
