import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import * as authModule from '../auth'
import { GET as getItemsRoute } from '../../../../app/api/workspaces/[workspaceId]/vault/items/route'
import { GET as getCalendarRoute } from '../../../../app/api/workspaces/[workspaceId]/vault/calendar/route'
import { GET as getSummaryRoute } from '../../../../app/api/workspaces/[workspaceId]/vault/summary/route'

describe('Vault Query API Routes (items, calendar, summary)', () => {
  const wsId = '11111111-1111-1111-1111-111111111111'

  const mockDbData = [
    {
      id: '22222222-2222-2222-2222-222222222222',
      workspace_id: wsId,
      content_id: '33333333-3333-3333-3333-333333333333',
      version_id: '44444444-4444-4444-4444-444444444444',
      channel: 'instagram',
      release_gate: 'HELD_PROVIDER_PENDING',
      hold_reason: 'META_REVIEW_PENDING',
      held_at: '2026-10-07T00:00:00.000Z',
      held_by: null,
      target_date: '2026-10-07',
      approved_fingerprint: 'a'.repeat(64),
      fingerprint_schema_version: 1,
      policy_version: 'v1.0.0',
      spec_version: 'v1.0.0',
      approval_state: 'APPROVED',
      approved_by: null,
      bundle_id: null,
      idempotency_key: 'idemp-1',
      deleted_at: null,
      created_at: '2026-10-07T00:00:00.000Z',
      updated_at: '2026-10-07T00:00:00.000Z',
    },
  ]

  const createMockSupabase = (items = mockDbData, externalActionCount = 0) => {
    return {
      from: vi.fn((table: string) => {
        if (table === 'vault_items') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockResolvedValue({ data: items, error: null }),
          }
        }
        if (table === 'external_action_requests') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              count: externalActionCount,
              // The service matches rows to the vaulted item's own channel, so return rows for that channel.
              data: Array.from({ length: externalActionCount }, (_, n) => ({ id: `action-${n}`, content_version_id: items[0].version_id, channel: items[0].channel })),
              error: null,
            }),
          }
        }
        return {}
      }),
    }
  }

  describe('1. 인증 및 인가 실패 처리', () => {
    it('인증 실패 시 401 UNAUTHORIZED 반환', async () => {
      vi.spyOn(authModule, 'authenticateWorkspaceMember').mockResolvedValueOnce({
        success: false,
        status: 401,
        error: { code: 'UNAUTHORIZED', message: '로그인 인증 세션이 필요합니다.' },
      })

      const req = new NextRequest(`http://localhost/api/workspaces/${wsId}/vault/items`)
      const res = await getItemsRoute(req, { params: Promise.resolve({ workspaceId: wsId }) })

      expect(res.status).toBe(401)
      const json = await res.json()
      expect(json.success).toBe(false)
      expect(json.error.code).toBe('UNAUTHORIZED')
    })

    it('권한 없음 시 403 FORBIDDEN 반환', async () => {
      vi.spyOn(authModule, 'authenticateWorkspaceMember').mockResolvedValueOnce({
        success: false,
        status: 403,
        error: { code: 'FORBIDDEN', message: '워크스페이스에 접근할 권한이 없습니다.' },
      })

      const req = new NextRequest(`http://localhost/api/workspaces/${wsId}/vault/items`)
      const res = await getItemsRoute(req, { params: Promise.resolve({ workspaceId: wsId }) })

      expect(res.status).toBe(403)
      const json = await res.json()
      expect(json.success).toBe(false)
      expect(json.error.code).toBe('FORBIDDEN')
    })
  })

  describe('2. 파라미터 유효성 검사 (400 Bad Request)', () => {
    it('유효하지 않은 period 파라미터 요청 시 400 반환', async () => {
      vi.spyOn(authModule, 'authenticateWorkspaceMember').mockResolvedValueOnce({
        success: true,
        context: { supabase: createMockSupabase(), userId: 'u1', workspaceId: wsId },
      })

      const req = new NextRequest(`http://localhost/api/workspaces/${wsId}/vault/items?period=invalid_period`)
      const res = await getItemsRoute(req, { params: Promise.resolve({ workspaceId: wsId }) })

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error.code).toBe('INVALID_QUERY_PARAMS')
    })

    it('유효하지 않은 ym 파라미터 요청 시 400 반환', async () => {
      vi.spyOn(authModule, 'authenticateWorkspaceMember').mockResolvedValueOnce({
        success: true,
        context: { supabase: createMockSupabase(), userId: 'u1', workspaceId: wsId },
      })

      const req = new NextRequest(`http://localhost/api/workspaces/${wsId}/vault/calendar?ym=invalid-ym`)
      const res = await getCalendarRoute(req, { params: Promise.resolve({ workspaceId: wsId }) })

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error.code).toBe('INVALID_QUERY_PARAMS')
    })
  })

  describe('3. GET /vault/items 성공 및 DTO 보안 불변식', () => {
    it('사용자 뷰 DTO에 UUID, 지문, 영문 상태 코드가 누출되지 않고 한글 라벨이 포함된다', async () => {
      vi.spyOn(authModule, 'authenticateWorkspaceMember').mockResolvedValueOnce({
        success: true,
        context: { supabase: createMockSupabase(), userId: 'u1', workspaceId: wsId },
      })

      const req = new NextRequest(`http://localhost/api/workspaces/${wsId}/vault/items?period=all`)
      const res = await getItemsRoute(req, { params: Promise.resolve({ workspaceId: wsId }) })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.success).toBe(true)
      expect(json.data.items.length).toBe(1)

      const item = json.data.items[0]
      expect(item.status_label).toBe('발행 준비 완료 · 외부 게시 전')
      expect(item.hold_reason_label).toBe('Meta 앱 심사 대기')
      expect(item.channel_label).toBe('인스타그램')

      // 불변식 검증
      const itemStr = JSON.stringify(item)
      expect(itemStr).not.toContain('예약됨')
      expect(itemStr).not.toContain('22222222-2222-2222-2222-222222222222')
      expect(itemStr).not.toContain('APPROVED')
    })
  })

  describe('4. GET /vault/calendar 성공', () => {
    it('월별 일자/채널 분포를 올바르게 반환한다', async () => {
      vi.spyOn(authModule, 'authenticateWorkspaceMember').mockResolvedValueOnce({
        success: true,
        context: { supabase: createMockSupabase(), userId: 'u1', workspaceId: wsId },
      })

      const req = new NextRequest(`http://localhost/api/workspaces/${wsId}/vault/calendar?ym=2026-10`)
      const res = await getCalendarRoute(req, { params: Promise.resolve({ workspaceId: wsId }) })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.success).toBe(true)
      expect(json.data.ym).toBe('2026-10')
      expect(json.data.days['2026-10-07'].total).toBe(1)
      expect(json.data.days['2026-10-07'].channels.instagram).toBe(1)
    })
  })

  describe('5. GET /vault/summary 및 외부 게시 COUNT/Warning 검증', () => {
    it('외부 게시 0건이면 warning이 null이다', async () => {
      vi.spyOn(authModule, 'authenticateWorkspaceMember').mockResolvedValueOnce({
        success: true,
        context: { supabase: createMockSupabase(mockDbData, 0), userId: 'u1', workspaceId: wsId },
      })

      const req = new NextRequest(`http://localhost/api/workspaces/${wsId}/vault/summary`)
      const res = await getSummaryRoute(req, { params: Promise.resolve({ workspaceId: wsId }) })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.success).toBe(true)
      expect(json.data.stored_count).toBe(1)
      expect(json.data.external_action_count).toBe(0)
      expect(json.data.external_action_warning).toBeNull()
    })

    it('외부 게시 건수가 존재하면 실제 COUNT와 함께 external_action_warning 경고를 반환한다', async () => {
      vi.spyOn(authModule, 'authenticateWorkspaceMember').mockResolvedValueOnce({
        success: true,
        context: { supabase: createMockSupabase(mockDbData, 2), userId: 'u1', workspaceId: wsId },
      })

      const req = new NextRequest(`http://localhost/api/workspaces/${wsId}/vault/summary`)
      const res = await getSummaryRoute(req, { params: Promise.resolve({ workspaceId: wsId }) })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.success).toBe(true)
      expect(json.data.external_action_count).toBe(2)
      expect(json.data.external_action_warning).toContain('2건')
    })
  })
  describe('B-3. view=admin 파라미터 무시 (일반 멤버 내부 필드 비노출)', () => {
    it('view=admin을 보내도 사용자 DTO만 반환하며 UUID·SHA·원시 enum이 없다', async () => {
      vi.spyOn(authModule, 'authenticateWorkspaceMember').mockResolvedValueOnce({
        success: true,
        context: { supabase: createMockSupabase(), userId: 'u1', workspaceId: wsId },
      })
      const req = new NextRequest(`http://localhost/api/workspaces/${wsId}/vault/items?view=admin`)
      const res = await getItemsRoute(req, { params: Promise.resolve({ workspaceId: wsId }) })
      expect(res.status).toBe(200)
      const json = await res.json()
      const text = JSON.stringify(json)
      expect(json.data.items).toHaveLength(1)
      expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      expect(text).not.toMatch(/[0-9a-f]{64}/i)
      for (const key of ['approvedFingerprint', 'idempotencyKey', 'contentId', 'versionId', 'heldBy', 'approvedBy', 'releaseGate', 'approvalState', 'holdReason']) {
        expect(json.data.items[0]).not.toHaveProperty(key)
      }
    })
  })
})
