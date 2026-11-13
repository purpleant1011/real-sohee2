export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { extendFirstPostDraft, readDraftExtensionEvidence } from '@/features/missions/first-post-draft-extension'
import { resolveFirstPostUserMedia } from '@/features/missions/first-post-user-media'
import { firstValueSourceCookieName, FirstValueSourceError } from '@/features/media/first-value-source'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { loadReadiness } from '@/features/readiness/load'
import { evaluateGate } from '@/features/readiness'
import {
  proposeFirstPostMission,
  composeFirstPostWithGemini,
  type ConnectedChannelInfo,
} from '@/features/missions/conversational-first-post'
import { attachFirstPostCtas } from '@/features/missions/first-post-cta'
import { loadApprovedFactSnapshot, type ApprovedFactSnapshot } from '@/features/knowledge/approved-fact-resolver'

export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: '인증 세션이 필요합니다.' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const utterance = typeof body.utterance === 'string' ? body.utterance : ''
    const requestedWorkspaceId = req.headers.get('x-workspace-id') || body?.workspaceId

    const { resolveDeterministicWorkspace } = await import('@/features/auth/workspace-context')
    const resolved = await resolveDeterministicWorkspace({
      supabase,
      userId: user.id,
      userEmail: user.email,
      requestedWorkspaceId,
    })

    if (!resolved.success) {
      return NextResponse.json(
        { error: resolved.statusCode === 404 ? '소속된 매장(Workspace)이 없습니다.' : resolved.message },
        { status: resolved.statusCode }
      )
    }

    const workspaceId = resolved.workspaceId

    // Draft creation is PREPARE_ONLY. Actual publication keeps its separate VERIFIED gate.
    const readiness = await loadReadiness(workspaceId, { supabaseClient: supabase })
    const createVerdict = evaluateGate(readiness, 'CREATE')
    if (!createVerdict.allowed) {
      return NextResponse.json({ error: createVerdict.message ?? '준비를 완료해 주세요.' }, { status: 403 })
    }

    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    const adminClient = createAdminSupabaseClient()
    const client = adminClient as any

    // 2. Fetch confirmed snapshots for workspace (Fail-closed on error or missing data)
    const [
      workspaceRes,
      knowledgeRes,
      textHarnessRes,
      imageHarnessRes,
      policyRes,
      channelsRes,
    ] = await Promise.all([
      client.from('workspaces').select('name').eq('id', workspaceId).maybeSingle(),
      client
        .from('workspace_knowledge_harnesses')
        .select('harness_version_id, version_no, is_active, offerings, policies')
        .eq('workspace_id', workspaceId)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle(),
      client
        .from('harness_rules')
        .select('id, version, structured_rule, status')
        .eq('workspace_id', workspaceId)
        .eq('rule_type', 'text_generation')
        .eq('status', 'active')
        .limit(1)
        .maybeSingle(),
      client
        .from('harness_rules')
        .select('id, version, structured_rule, status')
        .eq('workspace_id', workspaceId)
        .eq('rule_type', 'image_generation')
        .eq('status', 'active')
        .limit(1)
        .maybeSingle(),
      client
        .from('harness_rules')
        .select('id, version, structured_rule, status')
        .eq('workspace_id', workspaceId)
        .eq('rule_type', 'approval_policy')
        .eq('status', 'active')
        .limit(1)
        .maybeSingle(),
      client
        .from('channel_connections')
        .select('channel, status, account_label, external_account_id')
        .eq('workspace_id', workspaceId)
        .in('channel', ['instagram', 'threads']),
    ])

    // R2-B1 Validation: Workspace name
    const bizName = workspaceRes?.data?.name
    if (!bizName) {
      return NextResponse.json(
        { error: '매장 기본 정보가 존재하지 않습니다.', code: 'WORKSPACE_NOT_FOUND' },
        { status: 422 }
      )
    }

    // R2-B1 Validation: Channels (Must be verified in DB, never synthesize fake handles)
    // A null payload is an unobservable read, not an empty channel list. It takes the same
    // explicitly-warned degraded path as a query error so the draft is never silently
    // presented as "this store has no connected channels".
    const channelRows: any[] = Array.isArray(channelsRes?.data) ? channelsRes.data : []
    if (channelsRes?.error || !Array.isArray(channelsRes?.data)) {
      console.warn('[missions/first-post/propose] channel read unavailable, creating channel-free draft')
    }

    const connectedChannels: ConnectedChannelInfo[] = channelRows
      .filter((ch: any) => ['instagram', 'threads'].includes(ch.channel))
      .map((ch: any) => {
        const handle = ch.account_label || ''
        const cleanHandle = handle.replace(/^@/, '')
        const profileUrl = ch.channel === 'instagram'
          ? (cleanHandle ? `https://www.instagram.com/${cleanHandle}` : undefined)
          : (cleanHandle ? `https://www.threads.com/@${cleanHandle}` : undefined)
        return {
          provider: ch.channel as 'instagram' | 'threads',
          handle,
          profileUrl,
        }
      })
      .filter((ch: ConnectedChannelInfo) => ch.handle.length > 0)

    // No linked channel is normal in PREPARE_ONLY; the draft remains unpublishable.

    // R2-B1 Validation: Business Knowledge (No default version 1)
    if (
      knowledgeRes?.error ||
      !knowledgeRes?.data ||
      !knowledgeRes.data.harness_version_id ||
      typeof knowledgeRes.data.version_no !== 'number'
    ) {
      return NextResponse.json(
        {
          error: '확정된 비즈니스 지식베이스 불변 버전이 존재하지 않습니다.',
          code: 'KNOWLEDGE_HARNESS_MISSING',
        },
        { status: 422 }
      )
    }

    // R2-B1 Validation: Text Harness (No fallback defaults)
    if (
      textHarnessRes?.error ||
      !textHarnessRes?.data ||
      typeof textHarnessRes.data.version !== 'number'
    ) {
      return NextResponse.json(
        {
          error: '확정된 문체 스타일 기준이 존재하지 않습니다.',
          code: 'HARNESS_RULE_MISSING',
        },
        { status: 422 }
      )
    }

    const textStructured = (textHarnessRes.data.structured_rule as Record<string, any>) || {}
    const brandVoice = textStructured.brandVoice || textStructured.rules?.brandVoice || textStructured.toneAndManner
    const textRules = textStructured.rules || textStructured.customRules || textStructured
    if (!brandVoice || !textRules) {
      return NextResponse.json(
        {
          error: '문체 스타일 세부 규칙이 유효하지 않습니다.',
          code: 'HARNESS_RULE_MISSING',
        },
        { status: 422 }
      )
    }

    // R2-B1: 확정된 이미지 기준 버전 바인딩은 유지한다.
    if (
      imageHarnessRes?.error ||
      !imageHarnessRes?.data ||
      typeof imageHarnessRes.data.version !== 'number'
    ) {
      return NextResponse.json(
        {
          error: '확정된 이미지 스타일 기준이 존재하지 않습니다.',
          code: 'HARNESS_RULE_MISSING',
        },
        { status: 422 }
      )
    }

    // 이 경로는 검증된 사용자 업로드만 사용한다. 생성용 스타일 참고 사진의
    // 개수·권리는 게시 자산의 근거가 아니며, 아래 resolver가 실제 자산을 검증한다.

    // R2-B1 Validation: Operating Policy (No default fallbacks)
    if (
      policyRes?.error ||
      !policyRes?.data ||
      typeof policyRes.data.version !== 'number'
    ) {
      return NextResponse.json(
        {
          error: '확정된 운영 정책 불변 버전이 존재하지 않습니다.',
          code: 'HARNESS_RULE_MISSING',
        },
        { status: 422 }
      )
    }

    const policyStructured = (policyRes.data.structured_rule as Record<string, any>) || {}
    // 이전 확정 정책의 boolean true만 '항상 명시 승인'으로 해석한다.
    // 누락·false·문자열은 자동 승인 수준으로 추정하지 않는다.
    const publishApprovalLevel = policyStructured.publishApprovalLevel || policyStructured.rules?.publishApprovalLevel
      || (policyStructured.requireExplicitApproval === true ? 'ALWAYS_REQUIRE' : undefined)
    if (!publishApprovalLevel) {
      return NextResponse.json(
        {
          error: '운영 정책 승인 수준이 지정되지 않았습니다.',
          code: 'HARNESS_RULE_MISSING',
        },
        { status: 422 }
      )
    }

    // 승인·발행 게이트가 재검증할 서버 사실 스냅샷을 생성 시점에 보존한다.
    let factSnapshot: ApprovedFactSnapshot
    try {
      factSnapshot = await loadApprovedFactSnapshot(client, workspaceId)
    } catch {
      return NextResponse.json(
        { error: '가게 정보를 불러오지 못했어요.', code: 'FACT_READ_FAILED' },
        { status: 503 },
      )
    }

    let learningDependencies: Array<{ workspaceId: string; sourceId: string; revision: number }> | undefined
    let learningEpoch: number | undefined

    if (process.env.SOHEE_CHANNEL_LEARNING_ENABLED === '1' && typeof client?.rpc === 'function') {
      try {
        const { data: rpcData, error: rpcError } = await client.rpc('get_approved_learning_context', {
          p_workspace_id: workspaceId,
          p_purpose: 'content',
          p_max_facts: 50,
          p_query: '',
        })
        if (!rpcError && rpcData) {
          const items = Array.isArray(rpcData.items) ? rpcData.items : Array.isArray(rpcData) ? rpcData : []
          learningEpoch = Number(rpcData.epoch ?? items[0]?.epoch ?? 1)
          const seenDeps = new Set<string>()
          learningDependencies = []

          for (const item of items) {
            if (Array.isArray(item?.dependencies)) {
              for (const dep of item.dependencies) {
                const sId = dep.sourceId || dep.source_id || dep.id
                if (sId) {
                  const depWs = dep.workspaceId || dep.workspace_id || workspaceId
                  const depRev = Number(dep.revision || dep.source_revision || 1)
                  const key = `${depWs}:${sId}:${depRev}`
                  if (!seenDeps.has(key)) {
                    seenDeps.add(key)
                    learningDependencies.push({ workspaceId: depWs, sourceId: String(sId), revision: depRev })
                  }
                }
              }
            }
          }
        }
      } catch {
        // safe fallback
      }
    }

    // 3. Formulate first post mission draft with exact snapshot bindings
    // ANI-1458: Purge fabricated defaults ('대표 메뉴 및 서비스', '10:00 - 20:00').
    // Only pass values when confirmed/canonical business knowledge contains them, otherwise undefined.
    const rawOfferings = Array.isArray(knowledgeRes.data.offerings)
      ? knowledgeRes.data.offerings.map((o: any) => o.value || o.key).filter(Boolean)
      : []
    const signatureServices = rawOfferings.length > 0 ? rawOfferings : undefined

    const rawHoursPolicy = Array.isArray(knowledgeRes.data.policies)
      ? knowledgeRes.data.policies.find((p: any) => p.key?.includes('시간') || p.key === 'HOURS')?.value
      : undefined
    const operatingHours = rawHoursPolicy || undefined

    const composedCopies = await composeFirstPostWithGemini({
      bizName,
      primaryService: signatureServices?.[0],
      brandVoice,
      topic: utterance || '매장 소개 및 첫 인사',
    })

    // ANI-1775: 채널 연결 + 확정 지식 근거가 있는 채널에만 CTA 를 붙인다.
    // 근거가 없으면 필드 자체가 없다(M07 은 NO_CTA 로 승인을 막는다).
    // 초안 채널 목록은 PREPARE_ONLY 라 미연결 행도 담을 수 있으므로,
    // CTA 근거는 status 가 connected 로 확인된 채널로만 좁힌다.
    const connectedStatusChannels = new Set(
      channelRows.filter((ch: any) => ch.status === 'connected').map((ch: any) => ch.channel),
    )
    const copies = attachFirstPostCtas(composedCopies, {
      businessName: bizName,
      signatureServices,
      operatingHours,
      connectedChannels: connectedChannels.filter((ch) => connectedStatusChannels.has(ch.provider)),
    })

    // ANI-1764: 실사진 resolver 연계. explicit 선택 우선, 쿠키 선택, 둘 다 없으면 유일 업로드.
    // 'none' 선택 시 빈 배열 반환하며 임의의 예시/골든 사진으로 대체하지 않는다.
    const url = new URL(req.url, 'http://localhost')
    const explicitAssetId =
      body?.explicitAssetId ??
      body?.sourceAssetId ??
      url.searchParams.get('explicitAssetId') ??
      url.searchParams.get('sourceAssetId') ??
      undefined

    const cookieHeader = req.headers.get('cookie') || ''
    const cookieName = firstValueSourceCookieName(workspaceId)
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]*)`))
    let cookieAssetId: string | undefined
    if (match) {
      try {
        const decoded = decodeURIComponent(match[1])
        if (decoded.trim().length > 0) {
          cookieAssetId = decoded.trim()
        }
      } catch {}
    }
    const selectedAssetId = body?.selectedAssetId ?? cookieAssetId ?? undefined

    const userMedia = await resolveFirstPostUserMedia({
      admin: client,
      workspaceId,
      explicitAssetId,
      selectedAssetId,
    })

    // ANI-1764: none 또는 빈 선택은 가짜 골든으로 승격하지 않고 409 MEDIA_SELECTION_REQUIRED (삽입 0)
    if (userMedia.selectedImageIds.length === 0) {
      return NextResponse.json(
        {
          error: '첫 글에 사용할 사진을 선택해 주세요 (사진 선택 필요 / 원본 없는 생성 미연결).',
          code: 'MEDIA_SELECTION_REQUIRED',
        },
        { status: 409 }
      )
    }

    if (!userMedia.rights) {
      return NextResponse.json(
        {
          error: '선택한 사진의 공개 사용 권리가 확인되지 않았습니다.',
          code: 'MEDIA_SELECTION_INVALID',
        },
        { status: 409 }
      )
    }

    const draft = proposeFirstPostMission({
      workspaceId,
      // The proposal builder checks PREPARE_ONLY quick facts, not channel verification.
      readiness: { workspaceId, ready: readiness.prepared, facts: readiness.facts, blockers: readiness.blockers, evaluatedAt: new Date().toISOString() },
      admission: 'DRAFT',
      utterance,
      copies,
      userMedia: {
        selectedImageIds: userMedia.selectedImageIds,
        rights: userMedia.rights,
        mediaPreviews: userMedia.mediaPreviews,
      },
      knowledgeSnapshot: {
        businessName: bizName,
        signatureServices,
        operatingHours,
        versionNumber: knowledgeRes.data.version_no,
      },
      textHarnessSnapshot: {
        brandVoice,
        rules: Array.isArray(textRules) ? textRules : ['과장 없는 정직한 소통'],
        versionNumber: textHarnessRes.data.version,
      },
      imageHarnessSnapshot: {
        goldenImageIds: [],
        versionNumber: imageHarnessRes.data.version,
      },
      operatingPolicySnapshot: {
        publishApprovalLevel,
        dailySpendLimitKrw: policyStructured.dailySpendLimitKrw ?? 0,
        maxDailyPublishCount: policyStructured.maxDailyPublishCount ?? 1,
        versionNumber: policyRes.data.version,
      },
      connectedChannels,
    })

    // R2-B2: Server-authored Mission Draft Persistence (DRAFT / AWAITING_APPROVAL in marketing_missions)
    const { error: insertErr } = await client
      .from('marketing_missions')
      .insert({
        id: draft.missionId,
        workspace_id: workspaceId,
        trace_id: `trace_${Date.now()}`,
        status: 'AWAITING_APPROVAL',
        goal: '첫 게시물 발행 미션 (First Post Guided Mission)',
        metadata: {
          factSnapshot,
          learningDependencies,
          learningEpoch,
          draftFingerprint: draft.approvalFingerprint,
          draft,
          payload: {
            missionId: draft.missionId,
            workspaceId,
            channels: draft.channels,
            copies: draft.copies,
            imageIds: draft.selectedImageIds,
            boundVersions: draft.boundVersions,
            rights: draft.rights,
          },
          boundVersions: draft.boundVersions,
          rights: draft.rights,
          channels: draft.channels,
          copies: draft.copies,
          selectedImageIds: draft.selectedImageIds,
          createdAt: new Date().toISOString(),
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })

    if (insertErr) {
      console.error('[missions/first-post/propose] DB draft insert error:', insertErr)
      return NextResponse.json(
        {
          error: `미션 초안(marketing_missions) 영속화에 실패했습니다: ${insertErr.message}`,
          code: 'PERSISTENCE_ERROR',
        },
        { status: 500 }
      )
    }

    // ANI-1768: 화면용 가산 필드. 근거를 못 읽으면 확장 없이(UNKNOWN) 기존 응답 그대로 준다.
    const extensionEvidence = await readDraftExtensionEvidence(client, workspaceId).catch(() => null)
    return NextResponse.json({
      success: true,
      draft: extensionEvidence
        ? extendFirstPostDraft(draft, extensionEvidence)
        : { ...draft, datasetMode: 'UNKNOWN' as const },
    })
  } catch (err: any) {
    if (err instanceof FirstValueSourceError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      )
    }
    console.error('[missions/first-post/propose error]:', err)
    const statusCode =
      err.code === 'SOHEE_NOT_READY'
        ? 403
        : err.name === 'FirstPostComposerProviderError'
        ? 502
        : err.statusCode || 500
    return NextResponse.json(
      {
        error: err.message || '첫 게시물 초안 생성 중 오류가 발생했습니다.',
        code: err.code || 'INTERNAL_ERROR',
      },
      { status: statusCode }
    )
  }
}
