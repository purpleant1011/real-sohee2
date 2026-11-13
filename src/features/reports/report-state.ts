import type { ReportSampleState } from './types'

type ReportState = Readonly<{
  kind: ReportSampleState
  message: string
}>

const messages: Record<ReportSampleState, string> = {
  sufficient: '관측된 게시물 기준으로 성과를 확인할 수 있어요.',
  limited: '확인된 표본이 적어 성과 원인을 단정하지 않아요.',
  collecting: '자료를 모으고 있어요. 아직 실제 0건으로 계산하지 않아요.',
  unavailable: '리포트 데이터 연결 상태를 확인해 주세요.',
}

function makeReportState(kind: ReportSampleState): ReportState {
  return Object.freeze({ kind, message: messages[kind] })
}

function snapshotDateEpoch(value: unknown): number | undefined {
  if (value === null || typeof value !== 'object') {
    return undefined
  }

  try {
    const epoch = Date.prototype.getTime.call(value)
    return Number.isFinite(epoch) ? epoch : undefined
  } catch {
    return undefined
  }
}

export function deriveReportState(input: unknown): ReportState {
  let observedPosts: unknown
  let checkedAtIsNull = false
  let checkedAtEpoch: number | undefined
  let sourceReady: unknown

  try {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      return makeReportState('unavailable')
    }

    const record = input as Record<string, unknown>
    observedPosts = record.observedPosts
    const checkedAt = record.checkedAt
    checkedAtIsNull = checkedAt === null
    checkedAtEpoch = checkedAtIsNull ? undefined : snapshotDateEpoch(checkedAt)
    sourceReady = record.sourceReady
  } catch {
    return makeReportState('unavailable')
  }

  if (sourceReady !== true) {
    return makeReportState('unavailable')
  }

  if (
    observedPosts !== null &&
    (typeof observedPosts !== 'number' ||
      !Number.isSafeInteger(observedPosts) ||
      observedPosts < 0)
  ) {
    return makeReportState('unavailable')
  }

  if (!checkedAtIsNull && checkedAtEpoch === undefined) {
    return makeReportState('unavailable')
  }

  if (observedPosts === null || checkedAtIsNull) {
    return makeReportState('collecting')
  }

  return makeReportState(observedPosts === 0 ? 'limited' : 'sufficient')
}
