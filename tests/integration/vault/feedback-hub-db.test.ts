import { spawnSync } from 'node:child_process'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  countOpenComplaintsByWorkspace, listFeedbackForAdmin, listFeedbackForWorkspace,
  purgeDeletedFeedback, requestFeedbackDeletion, submitFeedback, type FeedbackClient,
} from '../../../src/features/feedback/repository'
import { pgClient, query } from './pg-client'

// ANI-1561: unique UUID prefix "f1561..." for this suite.
const userA = 'f1561001-0000-4000-8000-000000000001'
const userB = 'f1561002-0000-4000-8000-000000000002'
const wsA = 'f1561011-0000-4000-8000-000000000011'
const wsB = 'f1561012-0000-4000-8000-000000000012'

const psql = (input: string) => spawnSync('/opt/homebrew/opt/postgresql@16/bin/psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', process.env.PGDATABASE!], { input, encoding: 'utf8' })
/** authenticated 역할로 실행한다(RLS 적용). */
const asUser = (user: string, statement: string) => psql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${user}',true); ${statement}; commit;`)

const admin: FeedbackClient = {
  ...(pgClient() as unknown as FeedbackClient),
  rpc: (name: string, args?: Record<string, unknown>) => {
    try {
      const n = query<{ n: number }>(`select public.${name}(${Object.values(args ?? {}).join(',')}) as n`)[0].n
      return Promise.resolve({ data: n, error: null })
    } catch (error) {
      return Promise.resolve({ data: null, error })
    }
  },
}

beforeAll(() => {
  query(`with users as (insert into auth.users (id) values ('${userA}'), ('${userB}') on conflict do nothing returning id) select id from users`)
  query(`with w as (insert into public.workspaces (id,name,created_by) values ('${wsA}','의견 가게 A','${userA}'), ('${wsB}','의견 가게 B','${userB}') on conflict do nothing returning id) select id from w`)
})

describe('ANI-1561 의견 허브 (실제 PostgreSQL 16)', () => {
  it('사용자가 보낸 의견이 관리자 허브에 사업장·화면 정보와 함께 나타난다', async () => {
    const sent = await submitFeedback(admin, { workspaceId: wsA, userId: userA }, { screen: '/app/vault', kind: 'PREVIEW_MISMATCH', rating: 2, message: '미리보기가 실제와 달라요' })
    expect(sent.ok).toBe(true)
    const listed = await listFeedbackForAdmin(admin)
    expect(listed.status).toBe('OK')
    if (listed.status !== 'OK') return
    const row = listed.items.find((i) => i.workspace_id === wsA && i.message === '미리보기가 실제와 달라요')
    expect(row).toMatchObject({ screen: '/app/vault', kind: 'PREVIEW_MISMATCH', rating: 2, status: 'NEW', created_by: userA })
  })

  it('조회 실패는 빈 목록이 아니라 ERROR로 구분된다', async () => {
    const broken: FeedbackClient = { from: () => { throw new Error('db down') } }
    expect(await listFeedbackForAdmin(broken)).toEqual({ status: 'ERROR' })
    const errored: FeedbackClient = { from: () => ({ select: () => ({ is: () => ({ order: () => ({ limit: async () => ({ data: null, error: { code: 'X' } }) }) }) }) }) }
    expect(await listFeedbackForAdmin(errored)).toEqual({ status: 'ERROR' })
    expect(await countOpenComplaintsByWorkspace(broken, [wsA])).toBeUndefined()
  })

  it('RLS: 구성원은 자기 사업장 의견만 보고 쓴다 (교차 접근 불가)', () => {
    query(`with w as (insert into public.user_feedback (workspace_id, screen, kind, message, created_by) values ('${wsB}','/app','GENERAL','B 사업장 의견','${userB}') returning id) select id from w`)
    const mine = asUser(userA, 'select count(*) from public.user_feedback')
    expect(mine.stdout).toContain(String(query<{ n: number }>(`select count(*)::int as n from public.user_feedback where workspace_id='${wsA}' and deleted_at is null`)[0].n))
    const cross = asUser(userA, `select count(*) from public.user_feedback where workspace_id='${wsB}'`)
    expect(cross.stdout.trim().split('\n').find((l) => /^\d+$/.test(l))).toBe('0')
    const writeOther = asUser(userA, `insert into public.user_feedback (workspace_id, screen, message, created_by) values ('${wsB}','/app','침입','${userA}')`)
    expect(writeOther.status).not.toBe(0)
    const spoof = asUser(userA, `insert into public.user_feedback (workspace_id, screen, message, created_by) values ('${wsA}','/app','남의 이름','${userB}')`)
    expect(spoof.status).not.toBe(0)
    const own = asUser(userA, `insert into public.user_feedback (workspace_id, screen, message, created_by) values ('${wsA}','/app','내 의견','${userA}')`)
    expect(own.status).toBe(0)
  })

  it('RLS: 구성원은 상태·태그를 바꾸거나 운영 메모를 읽을 수 없다', () => {
    const setStatus = asUser(userA, `insert into public.user_feedback (workspace_id, screen, message, created_by, status) values ('${wsA}','/app','상태 조작','${userA}','APPLIED')`)
    expect(setStatus.status).not.toBe(0)
    const update = asUser(userA, `update public.user_feedback set status='APPLIED' where workspace_id='${wsA}'`)
    expect(update.status).not.toBe(0)
    const note = asUser(userA, 'select admin_note from public.user_feedback')
    expect(note.status).not.toBe(0)
  })

  it('삭제 요청은 즉시 목록에서 사라지고, 보관 기간이 지난 뒤에만 하드 삭제된다', async () => {
    const sent = await submitFeedback(admin, { workspaceId: wsA, userId: userA }, { screen: '/app', message: '지워 주세요' })
    expect(sent.ok).toBe(true)
    if (!sent.ok) return
    expect((await requestFeedbackDeletion(admin, { workspaceId: wsA, id: sent.id, userId: userB })).ok).toBe(false)
    expect((await requestFeedbackDeletion(admin, { workspaceId: wsA, id: sent.id, userId: userA })).ok).toBe(true)
    const own = await listFeedbackForWorkspace(admin, wsA)
    expect(own.status === 'OK' && own.items.some((i) => i.id === sent.id)).toBe(false)
    const asMember = asUser(userA, `select count(*) from public.user_feedback where id='${sent.id}'`)
    expect(asMember.stdout.trim().split('\n').find((l) => /^\d+$/.test(l))).toBe('0')
    // 소프트 삭제 직후에는 행이 남아 있다.
    const kept = () => query<{ n: number }>(`select count(*)::int as n from public.user_feedback where id='${sent.id}'`)[0].n
    expect(kept()).toBe(1)
    const early = await purgeDeletedFeedback(admin, 30)
    expect(early.ok).toBe(true)
    expect(kept()).toBe(1)
    query(`with u as (update public.user_feedback set deleted_at = now() - interval '31 days' where id='${sent.id}' returning id) select id from u`)
    const purged = await purgeDeletedFeedback(admin, 30)
    expect(purged).toMatchObject({ ok: true })
    expect(kept()).toBe(0)
    // 일반 구성원은 하드 삭제 함수를 실행할 수 없다.
    expect(asUser(userA, 'select public.purge_deleted_user_feedback(0)').status).not.toBe(0)
  })

  it('코호트 보드: 처리 전 불만 수를 사업장별로 센다', async () => {
    await submitFeedback(admin, { workspaceId: wsA, userId: userA }, { screen: '/app', kind: 'PROBLEM', message: '게시가 안 돼요' })
    const counts = await countOpenComplaintsByWorkspace(admin as never, [wsA, wsB])
    expect(counts?.get(wsA)).toBeGreaterThanOrEqual(2)
    expect(counts?.get(wsB)).toBe(0)
  })
})
