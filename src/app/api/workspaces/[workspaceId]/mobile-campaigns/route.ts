export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { readMobileCampaigns } from '@/features/mobile-campaigns/server/read-campaigns'
import {
  readCampaignProposals,
  type CampaignSourceClient,
} from '@/features/mobile-campaigns/server/proposal-source'
import { readWorkspaceDataset } from '@/features/reporting/dataset'
import type { DatasetMode } from '@/features/mobile-decision/contracts'

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * 캠페인 제안 목록(읽기 전용, ANI-1697). 원본은 빈 슬롯·수신 동의 고객·기존 승인 상태다.
 * 발송·외부 provider 호출은 없다. 조회 실패는 빈 목록 200 이 아니라 503 + unknown 으로 닫는다.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
  if (isResponse(auth)) return auth

  // ANI-1744: workspace_registry 의 dataset_mode 를 먼저 확인 (하드코딩 제거, fail-closed)
  const dataset = await readWorkspaceDataset(auth.admin ?? auth.supabase, auth.workspaceId)
  if (dataset.state === 'ERROR' || dataset.mode !== 'ACTUAL') {
    return NextResponse.json(
      {
        workspaceId: auth.workspaceId,
        loadState: 'unknown',
        sourceConnected: false,
        candidates: [],
        customers: [],
        now: new Date().toISOString(),
        checkedAt: null,
      },
      { status: 503, headers: NO_STORE },
    )
  }

  const now = () => new Date().toISOString()
  const result = await readMobileCampaigns(
    { workspaceId: auth.workspaceId, userId: auth.userId },
    {
      now,
      readSource: ctx => readCampaignProposals(
        auth.supabase as unknown as CampaignSourceClient,
        ctx.workspaceId,
        { now, datasetMode: dataset.mode as DatasetMode },
      ),
    },
  )
  return NextResponse.json(result.payload, { status: result.ok ? 200 : 503, headers: NO_STORE })
}
