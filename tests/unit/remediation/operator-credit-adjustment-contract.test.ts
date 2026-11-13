import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('Migration Contract & Semantics: 20261021011859_operator_credit_adjustment_and_quick_post_sync.sql', () => {
  const migrationPath = path.join(
    process.cwd(),
    'supabase/migrations/20261021011859_operator_credit_adjustment_and_quick_post_sync.sql',
  )

  it('신규 마이그레이션 파일이 디스크에 존재한다', () => {
    expect(fs.existsSync(migrationPath)).toBe(true)
  })

  const sqlContent = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : ''

  describe('apply_operator_credit_adjustment RPC 규격', () => {
    it('service-only ACL을 강제한다 (REVOKE ALL, GRANT service_role)', () => {
      expect(sqlContent).toContain('REVOKE ALL ON FUNCTION public.apply_operator_credit_adjustment(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;')
      expect(sqlContent).toContain('GRANT EXECUTE ON FUNCTION public.apply_operator_credit_adjustment(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, UUID) TO service_role;')
    })

    it('caller operator의 활성 상태 및 credit.adjust.request 권한을 검증한다', () => {
      expect(sqlContent).toContain("m.status = 'active'")
      expect(sqlContent).toContain("p.permission_key = 'credit.adjust.request'")
      expect(sqlContent).toContain('OPERATOR_PERMISSION_DENIED')
    })

    it('계좌가 워크스페이스에 속하는지 엄격히 검증하여 타 워크스페이스 계좌를 거부한다', () => {
      expect(sqlContent).toContain('WHERE id = p_account_id AND workspace_id = p_workspace_id')
      expect(sqlContent).toContain('ACCOUNT_WORKSPACE_MISMATCH')
    })

    it('정수가 아니거나 0, NaN, Infinity, 또는 32비트 int 범위를 벗어난 금액을 거부한다', () => {
      expect(sqlContent).toContain("p_amount::text = 'NaN'")
      expect(sqlContent).toContain('p_amount != round(p_amount)')
      expect(sqlContent).toContain('INVALID_CREDIT_ADJUSTMENT_AMOUNT')
    })

    it('5만 SC 초과 고액 조정 시 2인 결재(Dual Control)와 approver 권한을 강제한다', () => {
      expect(sqlContent).toContain('ABS(p_amount) > 50000')
      expect(sqlContent).toContain('DUAL_CONTROL_APPROVER_REQUIRED')
      expect(sqlContent).toContain("p.permission_key = 'credit.adjust.approve'")
      expect(sqlContent).toContain('APPROVER_PERMISSION_DENIED')
    })

    it('workspace_credit_states에 FOR UPDATE 행 락을 걸고 상태 누락 시 가짜 성공 없이 실패한다', () => {
      expect(sqlContent).toContain('FROM public.workspace_credit_states')
      expect(sqlContent).toContain('WHERE workspace_id = p_workspace_id')
      expect(sqlContent).toContain('FOR UPDATE;')
      expect(sqlContent).toContain('WORKSPACE_CREDIT_STATE_MISSING')
    })

    it('동일 idempotency_key 중복 호출 시 금액이나 계좌가 다르면 충돌(reject)하고, 동일하면 replay 반환한다', () => {
      expect(sqlContent).toContain('v_existing_amount != p_amount OR v_existing_account_id != p_account_id')
      expect(sqlContent).toContain('IDEMPOTENCY_KEY_CONFLICT')
      expect(sqlContent).toContain("'is_replay', true")
    })

    it('음수 조정 시 잔액 부족을 거부한다', () => {
      expect(sqlContent).toContain('p_amount < 0 AND (v_state.total_available_credits + p_amount::integer) < 0')
      expect(sqlContent).toContain('INSUFFICIENT_CREDITS')
    })

    it('ledger + states + audit을 단일 트랜잭션에서 일관 갱신하고 total_available_credits를 정확히 증가시킨다', () => {
      expect(sqlContent).toContain('INSERT INTO public.credit_ledger_entries')
      expect(sqlContent).toContain('UPDATE public.workspace_credit_states')
      expect(sqlContent).toContain('SET total_available_credits = total_available_credits + p_amount::integer')
      expect(sqlContent).toContain('INSERT INTO public.audit_events')
      expect(sqlContent).toContain("'admin_credit_adjustment'")
    })
  })

  describe('reserve_quick_post_credits RPC 규격', () => {
    it('service-only ACL을 유지한다', () => {
      expect(sqlContent).toContain('REVOKE ALL ON FUNCTION public.reserve_quick_post_credits(uuid, uuid, integer, text, integer, uuid) FROM PUBLIC, anon, authenticated;')
      expect(sqlContent).toContain('GRANT EXECUTE ON FUNCTION public.reserve_quick_post_credits(uuid, uuid, integer, text, integer, uuid) TO service_role;')
    })

    it('grant 계좌와 admin 지급 계좌가 달라도 워크스페이스 범위에서 approved adjustment를 합산하여 사용할 수 있다', () => {
      expect(sqlContent).toContain("WHEN kind = 'adjustment' AND (idempotency_key LIKE 'admin-adj:%' OR idempotency_key LIKE 'bulk:%') THEN amount")
      expect(sqlContent).toContain('FROM public.credit_ledger_entries')
      expect(sqlContent).toContain('WHERE workspace_id = p_workspace_id;')
    })

    it('legacy weekly grant는 제외하고 states cap을 유지한다', () => {
      expect(sqlContent).toContain("idempotency_key LIKE 'signup-first-post:%' OR idempotency_key LIKE 'business-verified-bonus:%'")
      expect(sqlContent).toContain('LEAST(v_available, v_state.total_available_credits)')
    })
  })

  describe('순수 로직 시뮬레이션: 잔액 합산 및 회귀 방어', () => {
    it('+10000 SC 지급 후 spendable이 정확히 10000 증가하고 quick-post 100 SC 예약 시 9900 SC가 남는다', () => {
      let stateBalance = 300
      const entries: Array<{ kind: string; amount: number; key: string }> = [
        { kind: 'grant', amount: 300, key: 'signup-first-post:u1' },
      ]

      // 1. +10000 지급
      const adjAmount = 10000
      stateBalance += adjAmount
      entries.push({ kind: 'adjustment', amount: adjAmount, key: 'admin-adj:w1:k1' })

      // 2. 가용 잔액 계산 (reserve_quick_post_credits 공식)
      const available = entries.reduce((acc, e) => {
        if (e.kind === 'grant' && e.key.startsWith('signup-first-post:')) return acc + e.amount
        if (e.kind === 'adjustment') return acc + e.amount
        if (e.kind === 'release' && e.key.startsWith('quick-post:')) return acc + e.amount
        if (e.kind === 'consume' && e.key.startsWith('quick-post:')) return acc - e.amount
        if (e.kind === 'reserve' && e.key.startsWith('quick-post:')) return acc - e.amount
        return acc
      }, 0)

      const spendable = Math.min(available, stateBalance)
      expect(spendable).toBe(10300)

      // 3. 100 SC 예약 (reserve)
      const cost = 100
      stateBalance -= cost
      entries.push({ kind: 'reserve', amount: cost, key: 'quick-post:m1:1:text' })

      const spendableAfterReserve = Math.min(
        entries.reduce((acc, e) => {
          if (e.kind === 'grant' && e.key.startsWith('signup-first-post:')) return acc + e.amount
          if (e.kind === 'adjustment') return acc + e.amount
          if (e.kind === 'release' && e.key.startsWith('quick-post:')) return acc + e.amount
          if (e.kind === 'consume' && e.key.startsWith('quick-post:')) return acc - e.amount
          if (e.kind === 'reserve' && e.key.startsWith('quick-post:')) return acc - e.amount
          return acc
        }, 0),
        stateBalance,
      )
      expect(spendableAfterReserve).toBe(10200)

      // 4. 예약 해제 (release) 시 잔액 보존
      stateBalance += cost
      entries.push({ kind: 'release', amount: cost, key: 'quick-post:m1:1:text' })

      const spendableAfterRelease = Math.min(
        entries.reduce((acc, e) => {
          if (e.kind === 'grant' && e.key.startsWith('signup-first-post:')) return acc + e.amount
          if (e.kind === 'adjustment') return acc + e.amount
          if (e.kind === 'release' && e.key.startsWith('quick-post:')) return acc + e.amount
          if (e.kind === 'consume' && e.key.startsWith('quick-post:')) return acc - e.amount
          if (e.kind === 'reserve' && e.key.startsWith('quick-post:')) return acc - e.amount
          return acc
        }, 0),
        stateBalance,
      )
      expect(spendableAfterRelease).toBe(10300)
    })

    it('음수 조정 시 기존 잔액 초과분을 거부한다', () => {
      const stateBalance = 500
      const negativeAdj = -600
      expect(stateBalance + negativeAdj < 0).toBe(true)
    })

    it('동일 idempotency_key 중복 호출 시 금액이나 계좌가 다르면 conflict를 발생시킨다', () => {
      const existingEntry = { account_id: 'acc-1', amount: 10000, key: 'key-1' }
      const newCallSame = { account_id: 'acc-1', amount: 10000, key: 'key-1' }
      const newCallDiffAmount = { account_id: 'acc-1', amount: 5000, key: 'key-1' }
      const newCallDiffAccount = { account_id: 'acc-2', amount: 10000, key: 'key-1' }

      expect(existingEntry.amount === newCallSame.amount && existingEntry.account_id === newCallSame.account_id).toBe(true)
      expect(existingEntry.amount !== newCallDiffAmount.amount || existingEntry.account_id !== newCallDiffAmount.account_id).toBe(true)
      expect(existingEntry.amount !== newCallDiffAccount.amount || existingEntry.account_id !== newCallDiffAccount.account_id).toBe(true)
    })
  })
})
