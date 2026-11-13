/**
 * 두 기기 동시 편집 충돌 판정 (ANI-1679, M12).
 * 구버전 기준 저장은 무증거로 덮어쓰지 않고 필드별 비교를 돌려준다.
 */
export interface Copies {
  instagram: { caption: string; hashtags?: string[] }
  threads: { content: string }
}
export interface FieldDiff { field: 'instagram.caption' | 'instagram.hashtags' | 'threads.content'; local: string; server: string }

const join = (h?: string[]) => (h ?? []).join(' ')

export function diffCopies(local: Copies, server: Copies): FieldDiff[] {
  const out: FieldDiff[] = []
  if (local.instagram.caption !== server.instagram.caption) out.push({ field: 'instagram.caption', local: local.instagram.caption, server: server.instagram.caption })
  if (join(local.instagram.hashtags) !== join(server.instagram.hashtags)) out.push({ field: 'instagram.hashtags', local: join(local.instagram.hashtags), server: join(server.instagram.hashtags) })
  if (local.threads.content !== server.threads.content) out.push({ field: 'threads.content', local: local.threads.content, server: server.threads.content })
  return out
}

export type SaveDecision =
  | { kind: 'SAVE' }
  | { kind: 'ALREADY_CURRENT'; revision: number }
  | { kind: 'CONFLICT'; diff: FieldDiff[]; serverRevision: number }
  | { kind: 'UNKNOWN' }

export function resolveSave(p: { baseRevision: number; serverRevision: number; local: Copies; server: Copies }): SaveDecision {
  if (p.serverRevision < p.baseRevision) return { kind: 'UNKNOWN' }
  if (p.serverRevision === p.baseRevision) return { kind: 'SAVE' }
  const diff = diffCopies(p.local, p.server)
  if (diff.length === 0) return { kind: 'ALREADY_CURRENT', revision: p.serverRevision }
  return { kind: 'CONFLICT', diff, serverRevision: p.serverRevision }
}
