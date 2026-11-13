import type { SupabaseClient } from '@supabase/supabase-js'
import { parseConfirmedPublishAttempt } from '@/features/publishing/publication-proof'

export interface VerifiedPublicationReceipt {
  receiptId: string
  providerReference: string
  observedAt: string
  channel: string
  source: 'external_action_receipts.recorded_at/independent_publish_readback' | 'publish_attempts.permalink_readback'
  permalink?: string | null
}

type Row = Record<string, unknown>

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function object(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {}
}

function date(value: unknown): string | null {
  const valueText = text(value)
  return valueText && Number.isFinite(Date.parse(valueText)) ? valueText : null
}

const scopedRow = (value: unknown, workspaceId: string): value is Row =>
  !!value && typeof value === 'object' && !Array.isArray(value) && (value as Row).workspace_id === workspaceId

function rowArray(result: { data: unknown; error: unknown }, workspaceId: string): Row[] | null {
  const output: unknown = result.data
  if (result.error || !Array.isArray(output) || output.some(row => !scopedRow(row, workspaceId))) return null
  return output as Row[]
}

export interface CandidateContentItem {
  id: string
  channel?: string | null
  status?: string | null
  currentVersionId?: string | null
}

/**
 * 모바일 홈과 작업 목록(mobile-list)이 공유하는 게시 확인(provider readback) 정본 검증 헬퍼.
 * - content_items.status 가 'published'/'completed'라도 외부 영수증 검증 없이는 확인으로 인정하지 않는다.
 * - 채널 불일치, 버전 불일치(과거 버전 영수증), 타 매장 영수증, provider_reference 불일치, read_after_write 미검증은 거부한다.
 * - 영수증 조회 실패 시 빈 Map(미확인)을 반환하여 전체 콘텐츠 조회가 0건이나 500으로 무너지지 않게 한다.
 */
export async function resolvePublicationEvidence(
  db: SupabaseClient,
  workspaceId: string,
  items: readonly CandidateContentItem[],
  options: { failClosed?: boolean } = {},
): Promise<Map<string, VerifiedPublicationReceipt>> {
  const verifiedMap = new Map<string, VerifiedPublicationReceipt>()

  const candidates = items.filter(item =>
    item.id && ['published', 'completed'].includes(text(item.status) ?? ''),
  )

  if (candidates.length === 0 || !workspaceId) return verifiedMap

  const candidateIds = candidates.map(c => c.id)
  const candidateIdSet = new Set(candidateIds)
  const channelByContentId = new Map<string, string | null>()
  const versionByContentId = new Map<string, string | null>()
  for (const c of candidates) {
    channelByContentId.set(c.id, text(c.channel)?.toLowerCase() ?? null)
    versionByContentId.set(c.id, text(c.currentVersionId))
  }

  try {
    const scheduleResult = await db
      .from('schedules')
      .select('id,workspace_id,content_id,version_id')
      .eq('workspace_id', workspaceId)
      .in('content_id', candidateIds)

    const scheduleRows = rowArray(scheduleResult, workspaceId)
    if (!scheduleRows) {
      if (options.failClosed) throw new Error('SCHEDULES_QUERY_FAILED')
      return verifiedMap
    }

    const scheduleToContent = new Map<string, { contentId: string; expectedChannel: string | null; expectedVersionId: string | null }>()
    for (const row of scheduleRows) {
      const scheduleId = text(row.id)
      const contentId = text(row.content_id)
      const scheduleVersionId = text(row.version_id)
      const expectedVersionId = contentId ? versionByContentId.get(contentId) ?? null : null

      // candidate scope 밖의 schedule.content_id는 불허한다.
      // 원고의 currentVersionId가 없거나 스케줄의 version_id와 불일치하면 과거 버전 영수증이므로 불허한다.
      if (
        scheduleId &&
        contentId &&
        candidateIdSet.has(contentId) &&
        expectedVersionId !== null &&
        scheduleVersionId !== null &&
        scheduleVersionId === expectedVersionId
      ) {
        scheduleToContent.set(scheduleId, {
          contentId,
          expectedChannel: channelByContentId.get(contentId) ?? null,
          expectedVersionId,
        })
      }
    }

    const scheduleIds = [...scheduleToContent.keys()]
    if (scheduleIds.length === 0) return verifiedMap

    const receiptResult = await db
      .from('external_action_receipts')
      .select('id,workspace_id,schedule_id,receipt_kind,provider_reference,observed_payload,recorded_at')
      .eq('workspace_id', workspaceId)
      .in('schedule_id', scheduleIds)
      .eq('receipt_kind', 'observed_result')

    const rawReceiptRows = rowArray(receiptResult, workspaceId)
    if (!rawReceiptRows && options.failClosed) {
      throw new Error('RECEIPTS_QUERY_FAILED')
    }
    const receiptRows = rawReceiptRows ?? []

    for (const receipt of receiptRows) {
      const scheduleId = text(receipt.schedule_id)
      const target = scheduleId ? scheduleToContent.get(scheduleId) : null
      if (!target) continue

      const payload = object(receipt.observed_payload)
      const providerRef = text(receipt.provider_reference)
      const recordedAt = date(receipt.recorded_at)
      const payloadChannel = text(payload.channel)?.toLowerCase() ?? null

      // 채널 검증: 영수증 채널과 콘텐츠 채널이 모두 존재하고 정확히 일치해야 한다 (missing/unknown 채널은 deny)
      const channelMatches = target.expectedChannel !== null && payloadChannel !== null && payloadChannel === target.expectedChannel

      const isVerified =
        receipt.receipt_kind === 'observed_result' &&
        payload.verified === true &&
        payload.read_after_write === true &&
        !!providerRef &&
        payload.published_post_id === providerRef &&
        payloadChannel !== null &&
        channelMatches

      if (isVerified && providerRef && recordedAt) {
        const previous = verifiedMap.get(target.contentId)
        if (!previous || Date.parse(recordedAt) > Date.parse(previous.observedAt)) {
          verifiedMap.set(target.contentId, {
            receiptId: text(receipt.id) ?? '',
            providerReference: providerRef,
            observedAt: recordedAt,
            channel: payloadChannel,
            source: 'external_action_receipts.recorded_at/independent_publish_readback',
            permalink: text(payload.permalink) ?? null,
          })
        }
      }
    }

    // Modern receipt(external_action_receipts)가 없는 경우,
    // 실제 실게시 성공 후 RPC가 기록한 publish_attempts + social_post_tracking 정본 영수증을 확인한다.
    const remainingScheduleEntries = [...scheduleToContent.entries()].filter(
      ([, target]) => !verifiedMap.has(target.contentId),
    )

    if (remainingScheduleEntries.length > 0) {
      const remainingScheduleIds = remainingScheduleEntries.map(([sId]) => sId)
      const attemptResult = await db
        .from('publish_attempts')
        .select('id,workspace_id,schedule_id,status,error_code,provider_request_id,provider_reference,finished_at')
        .eq('workspace_id', workspaceId)
        .in('schedule_id', remainingScheduleIds)
        .eq('status', 'succeeded')

      const attemptRows = rowArray(attemptResult, workspaceId) ?? []
      const attemptIds = attemptRows.map(a => text(a.id)).filter((id): id is string => id !== null)

      const trackingByAttemptId = new Map<string, Row>()
      if (attemptIds.length > 0) {
        const trackingResult = await db
          .from('social_post_tracking')
          .select('id,workspace_id,publish_attempt_id,destination_url')
          .eq('workspace_id', workspaceId)
          .in('publish_attempt_id', attemptIds)

        const trackingRows = rowArray(trackingResult, workspaceId) ?? []
        for (const t of trackingRows) {
          const aId = text(t.publish_attempt_id)
          if (aId) trackingByAttemptId.set(aId, t)
        }
      }

      for (const attempt of attemptRows) {
        const sId = text(attempt.schedule_id)
        const target = sId ? scheduleToContent.get(sId) : null
        if (!sId || !target || !target.expectedChannel) continue

        const aId = text(attempt.id)
        const tracking = aId ? trackingByAttemptId.get(aId) : null

        const proof = parseConfirmedPublishAttempt({
          attempt,
          tracking,
          workspaceId,
          scheduleId: sId,
          channel: target.expectedChannel,
        })

        if (proof) {
          const previous = verifiedMap.get(target.contentId)
          if (!previous || Date.parse(proof.observedAt) > Date.parse(previous.observedAt)) {
            verifiedMap.set(target.contentId, {
              receiptId: proof.evidenceId,
              providerReference: proof.providerReference,
              observedAt: proof.observedAt,
              channel: proof.channel,
              source: proof.source,
              permalink: proof.permalink,
            })
          }
        }
      }
    }
  } catch (err) {
    if (options.failClosed) throw err
    return verifiedMap
  }

  return verifiedMap
}
