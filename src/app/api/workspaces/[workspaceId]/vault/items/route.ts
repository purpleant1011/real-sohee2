export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { authenticateWorkspaceMember } from '@/features/vault/query/auth'
import type {
  VaultListQueryParams,
  VaultPeriod,
  VaultSortField,
  VaultSortOrder,
  VaultStatusFilter,
} from '@/features/vault/query/types'
import {
  SupabaseVaultQueryRepository,
  VaultQueryService,
} from '@/features/vault/query/vault-query-service'
import type { VaultChannel } from '@/features/vault/types'

const VALID_PERIODS = new Set<VaultPeriod>([
  'this_week',
  'next_week',
  'month',
  'unscheduled',
  'all',
])

const VALID_CHANNELS = new Set<VaultChannel>([
  'instagram',
  'threads',
  'naver_blog',
  'daangn_business',
])

const VALID_STATUSES = new Set<string>([
  'held',
  'needs_reapproval',
  'invalidated',
  'on_hold',
  '보관',
  '재확인 필요',
  '무효',
  '보류',
])

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params

  const auth = await authenticateWorkspaceMember(workspaceId)
  if (!auth.success) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const searchParams = request.nextUrl.searchParams
  const periodParam = searchParams.get('period')
  const ymParam = searchParams.get('ym')
  const channelParam = searchParams.get('channel')
  const statusParam = searchParams.get('status')
  const sortParam = searchParams.get('sort')
  const orderParam = searchParams.get('order')
  const cursorParam = searchParams.get('cursor')
  const limitParam = searchParams.get('limit')

  if (periodParam && !VALID_PERIODS.has(periodParam as VaultPeriod)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INVALID_QUERY_PARAMS',
          message: `유효하지 않은 period 값입니다: ${periodParam}`,
        },
      },
      { status: 400 },
    )
  }

  if (channelParam && !VALID_CHANNELS.has(channelParam as VaultChannel)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INVALID_QUERY_PARAMS',
          message: `유효하지 않은 channel 값입니다: ${channelParam}`,
        },
      },
      { status: 400 },
    )
  }

  if (statusParam && !VALID_STATUSES.has(statusParam)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INVALID_QUERY_PARAMS',
          message: `유효하지 않은 status 값입니다: ${statusParam}`,
        },
      },
      { status: 400 },
    )
  }

  if (ymParam && !/^\d{4}-\d{2}$/.test(ymParam)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INVALID_QUERY_PARAMS',
          message: `ym 파라미터는 YYYY-MM 형식이어야 합니다: ${ymParam}`,
        },
      },
      { status: 400 },
    )
  }

  const queryParams: VaultListQueryParams = {
    period: (periodParam as VaultPeriod) || 'all',
    ym: ymParam || undefined,
    channel: (channelParam as VaultChannel) || undefined,
    status: (statusParam as VaultStatusFilter) || undefined,
    sort: (sortParam as VaultSortField) || 'target_date',
    order: (orderParam as VaultSortOrder) || 'asc',
    cursor: cursorParam || undefined,
    limit: limitParam ? Number(limitParam) : 20,
    view: 'user', // 사용자 라우트는 항상 사용자 DTO. 관리자 뷰는 서버 내부 호출(admin/vault-monitor)만 사용한다.
  }

  try {
    const repository = new SupabaseVaultQueryRepository(auth.context.supabase)
    const service = new VaultQueryService(repository)
    const result = await service.listItems(workspaceId, queryParams)

    return NextResponse.json(
      { success: true, data: result },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
      },
    )
  } catch (err: any) {
    console.error('[Vault Items API] GET failed:', err)
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'FETCH_VAULT_ITEMS_FAILED',
          message: '보관함을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
        },
      },
      { status: 500 },
    )
  }
}
