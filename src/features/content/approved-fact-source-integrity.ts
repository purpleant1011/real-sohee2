import { createHash } from 'node:crypto'
import type { FactProvenanceItem } from './approved-fact-basis'

/** 서버 전용: node:crypto 의존이라 클라이언트 번들에서 가져오지 않는다. */
function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** sourceSpan 원문의 SHA-256이 sourceHash와 다른 항목의 factId 목록. */
export function findProvenanceSourceMismatches(items: readonly FactProvenanceItem[]): string[] {
  return items.filter(item => sha256Hex(item.sourceSpan) !== item.sourceHash).map(item => item.factId)
}

/** 원문과 결속되지 않은 인용이 사실 근거로 저장·사용되지 않게 막는다. */
export function assertProvenanceSourceIntegrity(items: readonly FactProvenanceItem[]): void {
  if (findProvenanceSourceMismatches(items).length) throw new Error('PROVENANCE_SOURCE_HASH_MISMATCH')
}
