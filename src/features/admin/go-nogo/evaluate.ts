import { CHECKLIST, type ChecklistItem } from './checklist'

/** PASS 는 "실행했고 종료코드 0이며 증거(시각·버전·로그)가 있음" 일 때만 나온다. */
export type GoStatus = 'PASS' | 'FAIL' | 'NOT_RUN' | 'BLOCKED' | 'NOT_VERIFIED' | 'UNKNOWN'

export type EvidenceRecord = {
  itemId: string
  command: string
  exitCode: number | null
  blocked: string | null
  summary: string
  startedAt: string
  finishedAt: string
  gitSha: string
  logPath: string | null
}

/** 저장소 읽기 결과. 파일이 없음(MISSING)과 읽지 못함(ERROR)은 다르다. */
export type RecordRead =
  | { kind: 'RECORD'; record: unknown; logExists: boolean }
  | { kind: 'MISSING' }
  | { kind: 'ERROR' }

export type ItemResult = {
  item: ChecklistItem
  status: GoStatus
  reason: string
  record: EvidenceRecord | null
}

const isIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v))

function parseRecord(raw: unknown, itemId: string): EvidenceRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.itemId !== itemId) return null
  if (typeof r.command !== 'string' || typeof r.summary !== 'string') return null
  if (!isIso(r.startedAt) || !isIso(r.finishedAt)) return null
  if (r.exitCode !== null && !Number.isInteger(r.exitCode)) return null
  return {
    itemId,
    command: r.command,
    exitCode: (r.exitCode as number | null) ?? null,
    blocked: typeof r.blocked === 'string' && r.blocked ? r.blocked : null,
    summary: r.summary,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    gitSha: typeof r.gitSha === 'string' ? r.gitSha : '',
    logPath: typeof r.logPath === 'string' ? r.logPath : null,
  }
}

export function evaluateItem(item: ChecklistItem, read: RecordRead): ItemResult {
  if (read.kind === 'MISSING') return { item, status: 'NOT_RUN', reason: '아직 실행한 기록이 없어요.', record: null }
  if (read.kind === 'ERROR') return { item, status: 'UNKNOWN', reason: '결과 저장소를 읽지 못해 확인할 수 없어요.', record: null }
  const record = parseRecord(read.record, item.id)
  if (!record) return { item, status: 'UNKNOWN', reason: '기록 형식이 올바르지 않아 확인할 수 없어요.', record: null }
  if (record.blocked) return { item, status: 'BLOCKED', reason: `막힘: ${record.blocked}`, record }
  if (record.exitCode === null) return { item, status: 'UNKNOWN', reason: '종료 결과가 없어 확인할 수 없어요.', record }
  if (record.exitCode !== 0) return { item, status: 'FAIL', reason: `실패했어요(종료 코드 ${record.exitCode}).`, record }
  // 종료코드 0이어도 증거(버전·로그)가 없으면 초록으로 올리지 않는다.
  if (!record.gitSha) return { item, status: 'NOT_VERIFIED', reason: '실행 버전 기록이 없어 검증되지 않았어요.', record }
  if (!record.logPath || !read.logExists) return { item, status: 'NOT_VERIFIED', reason: '실행 로그가 없어 검증되지 않았어요.', record }
  return { item, status: 'PASS', reason: '실행했고 통과했어요.', record }
}

export function evaluateAll(reads: Record<string, RecordRead>, items: readonly ChecklistItem[] = CHECKLIST): ItemResult[] {
  return items.map((item) => evaluateItem(item, reads[item.id] ?? { kind: 'ERROR' }))
}

export type Verdict = 'GO' | 'NO_GO' | 'UNDECIDED'

/** 전부 PASS 일 때만 GO. 하나라도 FAIL/BLOCKED 면 NO_GO. 그 외는 판단 보류. */
export function verdict(results: readonly ItemResult[]): Verdict {
  if (results.length > 0 && results.every((r) => r.status === 'PASS')) return 'GO'
  if (results.some((r) => r.status === 'FAIL' || r.status === 'BLOCKED')) return 'NO_GO'
  return 'UNDECIDED'
}

export const STATUS_LABEL: Record<GoStatus, string> = {
  PASS: '통과',
  FAIL: '실패',
  NOT_RUN: '미실행',
  BLOCKED: '막힘',
  NOT_VERIFIED: '검증 안 됨',
  UNKNOWN: '확인 불가',
}
