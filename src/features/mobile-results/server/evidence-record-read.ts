import type { SupabaseClient } from '@supabase/supabase-js'
import type { EvidenceRecordMetric, EvidenceRecordSourceRow } from './evidence-record-dto'
import { parseConfirmedPublishAttempt } from '@/features/publishing/publication-proof'

/**
 * M20 근거 기록 원장 읽기(ANI-1783 2단계).
 *
 * 이 모듈은 **주간 리포트가 이미 고른 기록 id 만** 읽는다. 어떤 기록이 근거인지 다시 판정하지 않는다
 * — 판정이 두 곳에 생기면 드릴다운의 "연결된 기록 N건"과 목록의 건수가 갈라진다.
 * 그래서 kind 는 id 집합이 아니라 **읽어 온 줄의 현재 상태**에서 다시 도출한다(그 사이 바뀌었을 수 있다).
 *
 * fail-closed:
 * - 원천이 연결되지 않은 지표(고객 문의·예금)는 `rows: null` 이다. 빈 배열(0건)과 구분한다.
 * - 한 청크라도 읽지 못하면 전체를 `rows: null` 로 닫는다(부분 성공을 전부처럼 그리지 않는다).
 * - 원장에 없는 id 는 줄 수가 모자라게 되어 DTO 단계에서 ERROR 가 된다(수가 어긋난 목록).
 *
 * 읽기 전용이다. provider·외부 API 를 호출하지 않고 쓰기 경로도 없다.
 */

export interface EvidenceRecordReadResult {
  /** null = 원장을 읽지 못했거나 이 지표에 연결된 원천이 없다. 빈 배열(실제 0건)과 다르다. */
  rows: EvidenceRecordSourceRow[] | null
  /** 요청한 id 를 모두 읽었는지. true 일 때만 "줄 수 = 근거 건수" 검사가 성립한다. */
  complete: boolean
}

type Row = Record<string, unknown>

/** 한 번에 조회할 id 수. 주소·쿼리 길이를 넘기지 않게 나눈다. */
const READ_CHUNK_SIZE = 100

/**
 * 채널 표시명. 내부 키(`instagram`)를 그대로 내보내지 않는다.
 * 모르는 키는 null 이고, 그러면 요약은 종류별 기본 문구로 닫힌다.
 */
const CHANNEL_DISPLAY_NAME: Record<string, string> = {
  instagram: '인스타그램',
  threads: '스레드',
  naver_blog: '네이버 블로그',
  daangn_business: '당근 비즈프로필',
  facebook: '페이스북',
  kakao: '카카오',
}

const SOURCE: Partial<Record<EvidenceRecordMetric, { table: string; columns: string }>> = {
  published: { table: 'external_action_receipts', columns: 'id, receipt_kind, provider_reference, recorded_at, observed_payload' },
  bookings: { table: 'reservations', columns: 'id, status, created_at' },
}

function isObject(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 게시 확인 판정. `weekly-ceo-report-service` 의 verified 조건과 같은 규칙이어야 한다
 * (그 서비스가 이 id 를 `verifiedPublishedPosts` 의 근거로 골랐기 때문).
 */
function isVerifiedPublish(row: Row, payload: Row | null): boolean {
  return row.receipt_kind === 'observed_result'
    && payload?.verified === true
    && payload.read_after_write === true
    && typeof row.provider_reference === 'string'
    && row.provider_reference !== ''
    && payload.published_post_id === row.provider_reference
    && typeof payload.channel === 'string'
    && payload.channel !== ''
}

/** 예약 줄의 표시명. 시각은 UTC 기준이며 개인정보를 넣지 않는다. */
function bookingSubject(occurredAt: unknown): string | undefined {
  if (typeof occurredAt !== 'string') return undefined
  const ms = Date.parse(occurredAt)
  if (Number.isNaN(ms)) return undefined
  const at = new Date(ms)
  return `${at.getUTCMonth() + 1}월 ${at.getUTCDate()}일 예약`
}

function toSourceRow(metric: EvidenceRecordMetric, row: Row): EvidenceRecordSourceRow {
  if (metric === 'published') {
    const payload = isObject(row.observed_payload) ? row.observed_payload : null
    const channel = typeof payload?.channel === 'string' ? payload.channel.toLowerCase() : ''
    const channelName = CHANNEL_DISPLAY_NAME[channel]
    return {
      kind: isVerifiedPublish(row, payload) ? 'PUBLISH_VERIFIED' : 'PUBLISH_PENDING',
      occurredAt: row.recorded_at,
      subject: channelName ? `${channelName} 게시물` : undefined,
    }
  }

  // 여기부터 bookings. 현재 상태에서 종류를 다시 도출한다 — 리포트 집계 뒤에 바뀌었을 수 있다.
  const status = typeof row.status === 'string' ? row.status.toUpperCase() : ''
  return {
    kind: status === 'CONFIRMED'
      ? 'BOOKING_CONFIRMED'
      : status === 'CANCELLED'
        ? 'BOOKING_CANCELED'
        : 'UNRECOGNIZED_STATUS',
    occurredAt: row.created_at,
    subject: bookingSubject(row.created_at),
  }
}

/**
 * 지표의 근거 기록 id 를 원장에서 읽는다.
 *
 * @param ids 주간 리포트가 그 지표의 근거로 고른 기록 id. 이 밖의 줄은 읽지 않는다.
 */
export async function readEvidenceRecords(
  client: SupabaseClient | null | undefined,
  workspaceId: string,
  metric: EvidenceRecordMetric,
  ids: readonly string[],
): Promise<EvidenceRecordReadResult> {
  const source = SOURCE[metric]
  // 원천 미연결 지표는 "0건"이 아니라 "읽을 곳이 없음"이다.
  if (!source) return { rows: null, complete: false }
  if (!client || typeof workspaceId !== 'string' || workspaceId.trim() === '') return { rows: null, complete: false }

  const uniqueIds = [...new Set(ids.filter(id => typeof id === 'string' && id !== ''))]
  if (uniqueIds.length === 0) return { rows: [], complete: true }

  const rows: EvidenceRecordSourceRow[] = []
  try {
    for (let offset = 0; offset < uniqueIds.length; offset += READ_CHUNK_SIZE) {
      const chunk = uniqueIds.slice(offset, offset + READ_CHUNK_SIZE)
      const { data, error } = await client
        .from(source.table)
        .select(source.columns)
        .eq('workspace_id', workspaceId)
        .in('id', chunk)
      // 일부만 읽은 목록을 전부처럼 그리지 않는다.
      if (error || !Array.isArray(data)) return { rows: null, complete: false }
      const foundIds = new Set<string>()
      for (const row of data as unknown as Row[]) {
        if (!isObject(row)) {
          rows.push({ kind: 'UNRECOGNIZED_ROW', occurredAt: null })
          continue
        }
        if (typeof row.id === 'string') foundIds.add(row.id)
        rows.push(toSourceRow(metric, row))
      }

      if (metric === 'published') {
        const missingIds = chunk.filter(id => !foundIds.has(id))
        if (missingIds.length > 0) {
          const attemptsRes = await client
            .from('publish_attempts')
            .select('id, workspace_id, schedule_id, status, error_code, provider_request_id, provider_reference, finished_at')
            .eq('workspace_id', workspaceId)
            .in('id', missingIds)
          if (attemptsRes.error || !Array.isArray(attemptsRes.data) || attemptsRes.data.some(a => !a || typeof a !== 'object' || (a as Row).workspace_id !== workspaceId)) {
            return { rows: null, complete: false }
          }

          const succeededAttempts = (attemptsRes.data as Row[]).filter(a => a.status === 'succeeded' && typeof a.schedule_id === 'string' && typeof a.id === 'string')
          const scheduleIds = [...new Set(succeededAttempts.map(a => a.schedule_id as string))]
          const attemptIds = succeededAttempts.map(a => a.id as string)

          if (scheduleIds.length > 0 && attemptIds.length > 0) {
            const [schedRes, trackRes] = await Promise.all([
              client.from('schedules').select('id, workspace_id, channel_connection_id').eq('workspace_id', workspaceId).in('id', scheduleIds),
              client.from('social_post_tracking').select('id, workspace_id, publish_attempt_id, destination_url').eq('workspace_id', workspaceId).in('publish_attempt_id', attemptIds),
            ])
            if (schedRes.error || !Array.isArray(schedRes.data) || trackRes.error || !Array.isArray(trackRes.data) ||
                schedRes.data.some(s => !s || typeof s !== 'object' || (s as Row).workspace_id !== workspaceId) ||
                trackRes.data.some(t => !t || typeof t !== 'object' || (t as Row).workspace_id !== workspaceId)) {
              return { rows: null, complete: false }
            }

            const schedMap = new Map((schedRes.data as Row[]).map(s => [s.id as string, s]))
            const trackMap = new Map((trackRes.data as Row[]).map(t => [t.publish_attempt_id as string, t]))
            const connectionIds = [...new Set((schedRes.data as Row[]).map(s => s.channel_connection_id as string).filter(id => typeof id === 'string' && id !== ''))]

            let connMap = new Map<string, string>()
            if (connectionIds.length > 0) {
              const connRes = await client
                .from('channel_connections')
                .select('id, workspace_id, channel')
                .eq('workspace_id', workspaceId)
                .in('id', connectionIds)
              if (connRes.error || !Array.isArray(connRes.data) || connRes.data.some(c => !c || typeof c !== 'object' || (c as Row).workspace_id !== workspaceId)) {
                return { rows: null, complete: false }
              }
              connMap = new Map((connRes.data as Row[]).map(c => [c.id as string, c.channel as string]))
            }

            for (const attempt of succeededAttempts) {
              const schedule = schedMap.get(attempt.schedule_id as string)
              if (!schedule) continue
              const channel = connMap.get(schedule.channel_connection_id as string) || ''
              if (!channel) continue
              const tracking = trackMap.get(attempt.id as string)
              const proof = parseConfirmedPublishAttempt({
                attempt,
                tracking,
                workspaceId,
                scheduleId: schedule.id as string,
                channel,
              })
              if (proof) {
                const channelName = CHANNEL_DISPLAY_NAME[proof.channel]
                rows.push({
                  kind: 'PUBLISH_VERIFIED',
                  occurredAt: proof.observedAt,
                  subject: channelName ? `${channelName} 게시물` : undefined,
                })
              } else {
                rows.push({ kind: 'UNRECOGNIZED_ROW', occurredAt: null })
              }
            }
          }
        }
      }
    }
  } catch {
    return { rows: null, complete: false }
  }
  return { rows, complete: true }
}
