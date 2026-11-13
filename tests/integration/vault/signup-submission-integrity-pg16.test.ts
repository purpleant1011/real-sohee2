import { beforeAll, describe, expect, it } from 'vitest'
import { query } from './pg-client'

const testUser1 = 'a1659001-0000-4000-8000-000000000001'
const testUser2 = 'a1659001-0000-4000-8000-000000000002'
const ws1 = 'a1659002-0000-4000-8000-000000000001'
const ws2 = 'a1659002-0000-4000-8000-000000000002'

const run = (sql: string) => query(`with w as (${sql} returning 1) select count(*) from w`)

beforeAll(() => {
  run(`insert into auth.users (id, email) values ('${testUser1}', 'test1@example.com'), ('${testUser2}', 'test2@example.com') on conflict (id) do nothing`)
  run(`insert into public.workspaces (id, name, created_by, created_at) values ('${ws1}', '테스트 매장 1', '${testUser1}', now()), ('${ws2}', '테스트 매장 2', '${testUser2}', now()) on conflict (id) do nothing`)
})

describe('Signup & Submission Integrity (Real PostgreSQL 16 Cluster)', () => {
  it('verifies information_schema column contract: signup_applications and business_verifications both HAVE start_date', () => {
    // 1. signup_applications column contract
    const saCols = query<{ column_name: string }>(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'signup_applications'
      order by ordinal_position
    `).map(r => r.column_name)

    expect(saCols).toContain('user_id')
    expect(saCols).toContain('workspace_id')
    expect(saCols).toContain('company_name')
    expect(saCols).toContain('representative_name')
    expect(saCols).toContain('business_number')
    expect(saCols).toContain('agreements_completed')
    // Crucial contract: start_date IS a column in signup_applications.
    // 20261022100000_signup_applications_start_date.sql adds it on purpose: signup-state-machine.ts
    // always sends the start_date key, and PostgREST rejects the whole update when the column is
    // missing. This assertion previously expected the column to be absent, which stopped being true
    // once that migration landed.
    expect(saCols).toContain('start_date')

    // 2. business_verifications column contract
    const bvCols = query<{ column_name: string }>(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'business_verifications'
      order by ordinal_position
    `).map(r => r.column_name)

    expect(bvCols).toContain('workspace_id')
    expect(bvCols).toContain('business_number')
    expect(bvCols).toContain('company_name')
    expect(bvCols).toContain('representative_name')
    // Crucial contract: start_date IS in business_verifications
    expect(bvCols).toContain('start_date')
  })

  it('verifies user_agreements accepts MARKETING_NOTIFICATIONS and enforces unique constraint (idempotency)', () => {
    // Insert MARKETING_NOTIFICATIONS with agreed = false
    run(`
      insert into public.user_agreements (user_id, workspace_id, agreement_type, version, agreed, agreed_at)
      values ('${testUser1}', '${ws1}', 'MARKETING_NOTIFICATIONS', '2026.09-v1', false, now())
      on conflict (user_id, agreement_type, version) do update set agreed = excluded.agreed
    `)

    let rows = query<{ agreement_type: string; agreed: boolean; version: string }>(`
      select agreement_type, agreed, version from public.user_agreements
      where user_id = '${testUser1}' and agreement_type = 'MARKETING_NOTIFICATIONS'
    `)
    expect(rows.length).toBe(1)
    expect(rows[0].agreed).toBe(false)
    expect(rows[0].version).toBe('2026.09-v1')

    // Update MARKETING_NOTIFICATIONS with agreed = true (idempotent upsert)
    run(`
      insert into public.user_agreements (user_id, workspace_id, agreement_type, version, agreed, agreed_at)
      values ('${testUser1}', '${ws1}', 'MARKETING_NOTIFICATIONS', '2026.09-v1', true, now())
      on conflict (user_id, agreement_type, version) do update set agreed = excluded.agreed
    `)

    rows = query<{ agreement_type: string; agreed: boolean; version: string }>(`
      select agreement_type, agreed, version from public.user_agreements
      where user_id = '${testUser1}' and agreement_type = 'MARKETING_NOTIFICATIONS'
    `)
    expect(rows.length).toBe(1)
    expect(rows[0].agreed).toBe(true)
  })

  it('prevents cross-workspace agreement corruption for users with multiple workspaces', () => {
    // Insert an agreement for user2 under ws2
    run(`
      insert into public.user_agreements (user_id, workspace_id, agreement_type, version, agreed, agreed_at)
      values ('${testUser2}', '${ws2}', 'TERMS_OF_SERVICE', '2026.09-v1', true, now())
      on conflict (user_id, agreement_type, version) do update set workspace_id = excluded.workspace_id
    `)

    // Verify user2's agreement is bound to ws2 and not affected by ws1
    const rows = query<{ workspace_id: string }>(`
      select workspace_id from public.user_agreements
      where user_id = '${testUser2}' and agreement_type = 'TERMS_OF_SERVICE'
    `)
    expect(rows[0].workspace_id).toBe(ws2)
    expect(rows[0].workspace_id).not.toBe(ws1)
  })

  it('executes provision_education_workspace RPC atomically with signup_applications invariants', () => {
    const newUser = 'a1659001-0000-4000-8000-000000000099'
    run(`insert into auth.users (id, email) values ('${newUser}', 'newedu@example.com') on conflict (id) do nothing`)

    // 1. Calling without agreements_completed fails closed (P0001)
    run(`
      insert into public.signup_applications (user_id, state, agreements_completed)
      values ('${newUser}', 'TASTE_READY', false)
      on conflict (user_id) do update set agreements_completed = false
    `)

    expect(() => {
      query(`select public.provision_education_workspace('${newUser}', '실패매장', 'email')`)
    }).toThrow(/약관.*완료되지 않았습니다|P0001/)

    // 2. After agreements_completed is set to true, provision_education_workspace succeeds atomically
    run(`
      update public.signup_applications
      set agreements_completed = true, business_number = '1208147521', company_name = '성공교육매장', representative_name = '홍길동'
      where user_id = '${newUser}'
    `)

    const res = query<{ provision_education_workspace: { success: boolean; workspace_id: string } }>(`
      select public.provision_education_workspace('${newUser}', '성공교육매장', 'email')
    `)

    expect(res[0].provision_education_workspace.success).toBe(true)
    const provisionedWsId = res[0].provision_education_workspace.workspace_id
    expect(provisionedWsId).toBeDefined()

    // 3. Confirm signup_applications has state COMPLETED and workspace_id bound
    const appRow = query<{ state: string; workspace_id: string }>(`
      select state, workspace_id from public.signup_applications where user_id = '${newUser}'
    `)
    expect(appRow[0].state).toBe('COMPLETED')
    expect(appRow[0].workspace_id).toBe(provisionedWsId)

    // 4. Confirm business_verifications was created automatically
    const bvRow = query<{ business_number: string; company_name: string; status: string }>(`
      select business_number, company_name, status from public.business_verifications where workspace_id = '${provisionedWsId}'
    `)
    expect(bvRow[0].business_number).toBe('1208147521')
    expect(bvRow[0].company_name).toBe('성공교육매장')
    expect(bvRow[0].status).toBe('VERIFIED')

    // 5. Preserving start_date in business_verifications (simulating Step 12)
    run(`
      update public.business_verifications
      set start_date = '20240101'
      where workspace_id = '${provisionedWsId}' and start_date is null
    `)
    const updatedBv = query<{ start_date: string }>(`
      select start_date from public.business_verifications where workspace_id = '${provisionedWsId}'
    `)
    expect(updatedBv[0].start_date).toBe('20240101')

    // 6. Idempotency: re-calling provision_education_workspace returns existing workspace without re-creating
    const idempotentRes = query<{ provision_education_workspace: { success: boolean; workspace_id: string; is_new_workspace: boolean } }>(`
      select public.provision_education_workspace('${newUser}', '성공교육매장', 'email')
    `)
    expect(idempotentRes[0].provision_education_workspace.success).toBe(true)
    expect(idempotentRes[0].provision_education_workspace.workspace_id).toBe(provisionedWsId)
    expect(idempotentRes[0].provision_education_workspace.is_new_workspace).toBe(false)
  })

  it('simulates midway failure after account/agreements creation and verifies resume recovery in PostgreSQL 16', () => {
    const retryUser = 'a1659001-0000-4000-8000-000000000077'
    run(`insert into auth.users (id, email) values ('${retryUser}', 'interrupted@example.com') on conflict (id) do nothing`)

    // Initial attempt: Agreements saved with timestamp T1
    const t1 = '2026-10-21T00:00:00.000Z'
    run(`
      insert into public.user_agreements (user_id, workspace_id, agreement_type, version, agreed, agreed_at)
      values ('${retryUser}', null, 'TERMS_OF_SERVICE', '2026.09-v1', true, '${t1}')
    `)

    // Mid-step: signup_applications created with workspace_id null
    run(`
      insert into public.signup_applications (user_id, workspace_id, state, business_number, company_name, representative_name, agreements_completed)
      values ('${retryUser}', null, 'TASTE_READY', '1208147521', '복구테스트매장', '김대표', true)
    `)

    // Simulate midway failure (provisioning timed out, no workspace created yet)
    // Retry: User submits again. Check if user already exists in auth.
    // 1. Password verified -> check workspace_members:
    const mems = query<{ workspace_id: string }>(`select workspace_id from public.workspace_members where user_id = '${retryUser}' and status = 'active'`)
    expect(mems.length).toBe(0) // No active membership exists!

    // 2. Resume agreements: identical consent must preserve t1 timestamp!
    const existingAg = query<{ agreed: boolean; agreed_at: string }>(`
      select agreed, agreed_at from public.user_agreements
      where user_id = '${retryUser}' and agreement_type = 'TERMS_OF_SERVICE' and version = '2026.09-v1'
    `)
    expect(existingAg.length).toBe(1)
    const preservedAt = existingAg[0].agreed === true ? existingAg[0].agreed_at : 'new-time'
    expect(new Date(preservedAt).toISOString()).toBe(t1)

    // 3. Resume provision: now succeeds
    const res = query<{ provision_education_workspace: { success: boolean; workspace_id: string } }>(`
      select public.provision_education_workspace('${retryUser}', '복구테스트매장', 'email')
    `)
    expect(res[0].provision_education_workspace.success).toBe(true)
    const resumedWsId = res[0].provision_education_workspace.workspace_id

    // 4. Update signup_applications and check rows updated > 0
    run(`
      update public.signup_applications
      set workspace_id = '${resumedWsId}', updated_at = now()
      where user_id = '${retryUser}'
    `)
    const updatedApp = query<{ workspace_id: string }>(`select workspace_id from public.signup_applications where user_id = '${retryUser}'`)
    expect(updatedApp[0].workspace_id).toBe(resumedWsId)

    // 5. User agreements linked to resumedWsId
    run(`
      update public.user_agreements
      set workspace_id = '${resumedWsId}'
      where user_id = '${retryUser}' and agreement_type in ('TERMS_OF_SERVICE') and workspace_id is null
    `)
    const linkedAg = query<{ workspace_id: string; agreed_at: string }>(`
      select workspace_id, agreed_at from public.user_agreements where user_id = '${retryUser}'
    `)
    expect(linkedAg[0].workspace_id).toBe(resumedWsId)
    expect(new Date(linkedAg[0].agreed_at).toISOString()).toBe(t1) // Timestamp still preserved!
  })

  it('executes finalize_email_signup_atomic RPC directly and verifies zero partial state, start_date preservation and marketingConsent handling', () => {
    const atomicUser = 'a1659001-0000-4000-8000-000000000088'
    const atomicWs = 'a1659002-0000-4000-8000-000000000088'
    run(`insert into auth.users (id, email) values ('${atomicUser}', 'atomic@example.com') on conflict (id) do nothing`)
    run(`insert into public.workspaces (id, name, created_by, created_at) values ('${atomicWs}', '원자매장', '${atomicUser}', now()) on conflict (id) do nothing`)

    // Invariant: Direct call from authenticated user MUST fail closed (SERVICE_ROLE_ONLY security lockdown)
    expect(() => {
      query(`
        select public.finalize_email_signup_atomic(
          '${atomicUser}',
          '${atomicWs}',
          '1208147521',
          '원자매장',
          '원자대표',
          '20240201',
          true,
          false,
          '2026.09-v1',
          '127.0.0.1'
        )
      `, atomicUser)
    }).toThrow(/permission denied|SERVICE_ROLE_ONLY|42501/)

    // Server-side call (service_role / superuser) succeeds atomically
    const res1 = query<{ finalize_email_signup_atomic: { success: boolean; workspace_id: string; agreements_saved_count: number; start_date_saved: boolean; stored_start_date: string } }>(`
      select public.finalize_email_signup_atomic(
        '${atomicUser}',
        '${atomicWs}',
        '1208147521',
        '원자매장',
        '원자대표',
        '20240201',
        true,
        false,
        '2026.09-v1',
        '127.0.0.1'
      )
    `)

    expect(res1[0].finalize_email_signup_atomic.success).toBe(true)
    expect(res1[0].finalize_email_signup_atomic.agreements_saved_count).toBe(5) // 4 required + 1 marketing
    expect(res1[0].finalize_email_signup_atomic.start_date_saved).toBe(true)
    expect(res1[0].finalize_email_signup_atomic.stored_start_date).toBe('20240201')

    // Verify agreements saved in DB (service read)
    const agRows = query<{ agreement_type: string; agreed: boolean; workspace_id: string }>(`
      select agreement_type, agreed, workspace_id from public.user_agreements where user_id = '${atomicUser}' order by agreement_type
    `)
    expect(agRows.length).toBe(5)
    const mRow = agRows.find(r => r.agreement_type === 'MARKETING_NOTIFICATIONS')
    expect(mRow?.agreed).toBe(false)
    expect(mRow?.workspace_id).toBe(atomicWs)

    // Verify business_verifications start_date (service read)
    const bvRow = query<{ start_date: string; status: string }>(`
      select start_date, status from public.business_verifications where workspace_id = '${atomicWs}'
    `)
    expect(bvRow[0].start_date).toBe('20240201')
    expect(bvRow[0].status).toBe('VERIFIED')

    // Verify platform_audit_events has recorded audit row atomically with zero PII and consent metadata
    const auditRows = query<{ audit_action: string; target_type: string; audit_result: string; after: any }>(`
      select action as audit_action, target_type, result as audit_result, after
      from public.platform_audit_events
      where workspace_id = '${atomicWs}' and action = 'agreement.verify.requested'
    `)
    expect(auditRows.length).toBeGreaterThan(0)
    expect(auditRows[0].audit_action).toBe('agreement.verify.requested')
    expect(auditRows[0].audit_result).toBe('succeeded')
    expect(auditRows[0].after.marketing_agreed).toBe(false)
    expect(auditRows[0].after.marketing_modified).toBe(true)
    expect(auditRows[0].after.required_agreements_modified).toContain('TERMS_OF_SERVICE')

    // Second call: marketing consent toggled to true -> must update timestamp & agreed status
    const res2 = query<{ finalize_email_signup_atomic: { success: boolean } }>(`
      select public.finalize_email_signup_atomic(
        '${atomicUser}',
        '${atomicWs}',
        '1208147521',
        '원자매장',
        '원자대표',
        '20240201',
        true,
        true,
        '2026.09-v1',
        '127.0.0.1'
      )
    `)
    expect(res2[0].finalize_email_signup_atomic.success).toBe(true)
    const mRow2 = query<{ agreed: boolean }>(`
      select agreed from public.user_agreements where user_id = '${atomicUser}' and agreement_type = 'MARKETING_NOTIFICATIONS'
    `)
    expect(mRow2[0].agreed).toBe(true)

    // Calling with non-owned workspace fails closed (WORKSPACE_OWNERSHIP_REQUIRED)
    expect(() => {
      query(`
        select public.finalize_email_signup_atomic(
          '${atomicUser}',
          '${ws2}',
          '1208147521',
          '남의매장',
          '원자대표',
          null,
          false,
          null
        )
      `)
    }).toThrow(/WORKSPACE_OWNERSHIP_REQUIRED|WORKSPACE_MISMATCH_DENIED|42501/)
  })

  it('prepare_signup_application_atomic preserves existing non-null business fields when passing empty/null input', () => {
    const prepUser = 'a1659001-0000-4000-8000-000000000055'
    run(`insert into auth.users (id, email) values ('${prepUser}', 'prep@example.com') on conflict (id) do nothing`)

    // Initial preparation: with business number and company name
    query(`
      select public.prepare_signup_application_atomic(
        '${prepUser}',
        '1208147521',
        '기존원래상호',
        '기존원래대표',
        true
      )
    `)

    // Second preparation call with EMPTY / NULL business fields (simulating empty retry)
    query(`
      select public.prepare_signup_application_atomic(
        '${prepUser}',
        null,
        '',
        null,
        false
      )
    `)

    // Verify non-null business values are strictly preserved!
    const appRow = query<{ business_number: string; company_name: string; representative_name: string }>(`
      select business_number, company_name, representative_name
      from public.signup_applications
      where user_id = '${prepUser}'
    `)
    expect(appRow[0].business_number).toBe('1208147521')
    expect(appRow[0].company_name).toBe('기존원래상호')
    expect(appRow[0].representative_name).toBe('기존원래대표')
  })

  it('prepare_signup_application_atomic leaves agreements_completed=false and 0 consents, then finalize sets agreements_completed=true', () => {
    const freshUser = 'a1659001-0000-4000-8000-000000000044'
    const freshWs = 'a1659002-0000-4000-8000-000000000044'
    run(`insert into auth.users (id, email) values ('${freshUser}', 'fresh@example.com') on conflict (id) do nothing`)
    run(`insert into public.workspaces (id, name, created_by, created_at) values ('${freshWs}', '신규매장', '${freshUser}', now()) on conflict (id) do nothing`)

    // 1. Call prepare_signup_application_atomic ONLY
    const prepRes = query<{ prepare_signup_application_atomic: { success: boolean; is_new: boolean; agreements_completed: boolean } }>(`
      select public.prepare_signup_application_atomic(
        '${freshUser}',
        '1208147521',
        '신규준비매장',
        '신규대표',
        true
      )
    `)
    expect(prepRes[0].prepare_signup_application_atomic.success).toBe(true)
    expect(prepRes[0].prepare_signup_application_atomic.is_new).toBe(true)
    expect(prepRes[0].prepare_signup_application_atomic.agreements_completed).toBe(false)

    // Verify DB state: signup_applications.agreements_completed MUST be false!
    const saRow = query<{ agreements_completed: boolean; workspace_id: string }>(`
      select agreements_completed, workspace_id from public.signup_applications where user_id = '${freshUser}'
    `)
    expect(saRow[0].agreements_completed).toBe(false)
    expect(saRow[0].workspace_id).toBeNull()

    // Verify DB state: user_agreements count MUST be 0!
    const agCount = query<{ count: string }>(`
      select count(*)::text as count from public.user_agreements where user_id = '${freshUser}'
    `)
    expect(agCount[0].count).toBe('0')

    // 2. Now call finalize_email_signup_atomic
    const finRes = query<{ finalize_email_signup_atomic: { success: boolean; agreements_saved_count: number } }>(`
      select public.finalize_email_signup_atomic(
        '${freshUser}',
        '${freshWs}',
        '1208147521',
        '신규준비매장',
        '신규대표',
        '20240301',
        true,
        true,
        '2026.09-v1',
        '127.0.0.1'
      )
    `)
    expect(finRes[0].finalize_email_signup_atomic.success).toBe(true)
    expect(finRes[0].finalize_email_signup_atomic.agreements_saved_count).toBe(5)

    // Verify DB state: signup_applications.agreements_completed MUST now be true, and workspace_id bound!
    const saFinal = query<{ agreements_completed: boolean; workspace_id: string }>(`
      select agreements_completed, workspace_id from public.signup_applications where user_id = '${freshUser}'
    `)
    expect(saFinal[0].agreements_completed).toBe(true)
    expect(saFinal[0].workspace_id).toBe(freshWs)

    // Verify DB state: user_agreements count is now 5!
    const agFinal = query<{ count: string }>(`
      select count(*)::text as count from public.user_agreements where user_id = '${freshUser}'
    `)
    expect(agFinal[0].count).toBe('5')
  })
})
