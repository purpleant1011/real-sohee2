/**
 * M12 전체화면 편집 (ANI-1679).
 *
 * 정본: `docs/mobile-r2/05-390px-wireframes-and-ui-state-matrix.md` §3
 *
 * 이 파일이 지키는 경계:
 * - 저장은 **기준 revision** 과 함께 나간다. 구버전 기준으로 최신 원고를 덮어쓰지 않는다.
 * - 서버가 409(다른 기기 수정)를 주면 시트에 필드별 '내 수정 / 다른 기기 수정'을 보여주고,
 *   모든 필드에 선택이 끝나기 전에는 저장하지 않는다(일부 필드 무증거 병합 금지).
 * - `SAVED` 는 서버가 저장 revision 을 확인해 준 경우에만 된다. 저장 중에 더 고친 경우
 *   그 저장은 현재 원고에 대한 확인이 아니므로 다시 `DIRTY` 로 내린다.
 * - 저장 실패(500 PERSISTENCE_ERROR 등)를 충돌이나 성공으로 바꾸지 않는다.
 *
 * 네트워크를 모른다. 호출·응답 해석은 화면/호출 측 책임이며, 이 파일은 요청·응답 계약만 다룬다.
 */
import { diffCopies, type Copies, type FieldDiff } from './revision-conflict'

export type EditSaveState = 'SAVED' | 'DIRTY' | 'SAVING' | 'FAILED'

/** 사용자 화면 필드 이름. 영문 필드 경로는 화면에 내보내지 않는다. */
export const EDIT_FIELD_LABEL: Record<FieldDiff['field'], string> = {
  'instagram.caption': '인스타그램 문구',
  'instagram.hashtags': '인스타그램 해시태그',
  'threads.content': '스레드 문구',
}

export interface EditConflict {
  serverRevision: number
  server: Copies
  diff: readonly FieldDiff[]
}

export interface InFlightSave {
  /** 이 저장 요청이 어느 시점 원고에 대한 것인지 가리는 값. */
  localRevision: number
  copies: Copies
}

export interface EditSessionState {
  /** 지금 화면의 원문. 사용자가 입력한 그대로 보존한다. */
  copies: Copies
  /** 마지막으로 서버가 확인해 준 원문. */
  serverCopies: Copies
  /** 저장 요청에 실어 보낼 기준 revision. 저장 성공 응답에서만 올라간다. */
  baseRevision: number
  /** 이 기기의 원고 변경 횟수. 저장 응답이 현재 원고에 대한 것인지 가리는 데만 쓴다. */
  revision: number
  save: EditSaveState
  conflict: EditConflict | null
  inflight: InFlightSave | null
}

function cloneCopies(c: Copies): Copies {
  return {
    instagram: {
      caption: c.instagram.caption,
      ...(c.instagram.hashtags ? { hashtags: [...c.instagram.hashtags] } : {}),
    },
    threads: { content: c.threads.content },
  }
}

function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/** 서버가 확인해 준 원고와 revision 으로 시작한다. `SAVED` 는 이 확인에서만 출발한다. */
export function createEditSession(input: { copies: Copies; revision: number }): EditSessionState {
  if (!isRevision(input.revision)) throw new RangeError('revision must be a non-negative integer')
  const server = cloneCopies(input.copies)
  return {
    copies: cloneCopies(input.copies),
    serverCopies: server,
    baseRevision: input.revision,
    revision: 0,
    save: 'SAVED',
    conflict: null,
    inflight: null,
  }
}

export type EditRejectReason =
  | 'CONFLICT_PENDING'
  | 'EMPTY_COPY'
  | 'EMPTY_CTA'
  | 'NO_CHANGE'
  | 'SAVING'
  | 'NOTHING_TO_SAVE'
  | 'NO_CONFLICT'
  | 'UNRESOLVED_FIELDS'
  | 'NO_INFLIGHT'

export type EditMutation =
  | { ok: true; state: EditSessionState; changed: boolean }
  | { ok: false; reason: EditRejectReason; fields?: readonly FieldDiff['field'][] }

/**
 * 편집 중에는 채널을 오가도 원고가 남는다. 충돌 시트가 떠 있는 동안에는
 * 시트가 보여준 '내 수정'과 비교 대상이 흔들리지 않도록 편집을 받지 않는다.
 */
function canEdit(state: EditSessionState): EditRejectReason | null {
  if (state.conflict) return 'CONFLICT_PENDING'
  return null
}

function withCopies(state: EditSessionState, copies: Copies): EditSessionState {
  return {
    ...state,
    copies,
    save: 'DIRTY',
    revision: state.revision + 1,
  }
}

/** 인스타그램 문구·해시태그 수정. 빈 문구는 저장하지 않는다(입력 그대로 보존). */
export function editInstagram(
  state: EditSessionState,
  patch: Partial<{ caption: string; hashtags: string[] }>,
): EditMutation {
  const rejected = canEdit(state)
  if (rejected) return { ok: false, reason: rejected }

  const caption = patch.caption ?? state.copies.instagram.caption
  if (!caption.trim()) return { ok: false, reason: 'EMPTY_COPY' }

  const hashtags = patch.hashtags ?? state.copies.instagram.hashtags
  const next: Copies = {
    instagram: { caption, ...(hashtags ? { hashtags: [...hashtags] } : {}) },
    threads: { content: state.copies.threads.content },
  }
  if (diffCopies(next, state.copies).length === 0) return { ok: true, state, changed: false }
  return { ok: true, state: withCopies(state, next), changed: true }
}

/** 스레드 문구 수정. 한 문단 길이를 제한하지 않는다(확인되지 않은 규격으로 막지 않음). */
export function editThreads(state: EditSessionState, patch: Partial<{ content: string }>): EditMutation {
  const rejected = canEdit(state)
  if (rejected) return { ok: false, reason: rejected }

  const content = patch.content ?? state.copies.threads.content
  if (!content.trim()) return { ok: false, reason: 'EMPTY_COPY' }

  const next: Copies = {
    instagram: cloneCopies(state.copies).instagram,
    threads: { content },
  }
  if (diffCopies(next, state.copies).length === 0) return { ok: true, state, changed: false }
  return { ok: true, state: withCopies(state, next), changed: true }
}

/* ------------------------------------------------------------------ */
/* 저장 — 기준 revision 을 실어 보낸다                                */
/* ------------------------------------------------------------------ */

export interface SaveRequest {
  expectedRevision: number
  copies: Copies
}

export type BeginSaveResult =
  | { ok: true; state: EditSessionState; request: SaveRequest }
  | { ok: false; reason: EditRejectReason }

/**
 * 저장 시작. 기준 revision 은 마지막으로 서버가 확인한 값이다.
 * 저장 중 재호출(버튼 연타)은 새 요청을 만들지 않는다.
 */
export function beginSave(state: EditSessionState): BeginSaveResult {
  if (state.inflight || state.save === 'SAVING') return { ok: false, reason: 'SAVING' }
  if (state.conflict) return { ok: false, reason: 'CONFLICT_PENDING' }
  if (state.save === 'SAVED') return { ok: false, reason: 'NOTHING_TO_SAVE' }

  const request: SaveRequest = {
    expectedRevision: state.baseRevision,
    copies: cloneCopies(state.copies),
  }
  return {
    ok: true,
    request,
    state: {
      ...state,
      save: 'SAVING',
      inflight: { localRevision: state.revision, copies: cloneCopies(state.copies) },
    },
  }
}

/** 화면이 보관 중인 요청을 재시도할 때. 없으면 null. */
export function pendingSaveRequest(state: EditSessionState): SaveRequest | null {
  if (!state.inflight) return null
  return { expectedRevision: state.baseRevision, copies: cloneCopies(state.inflight.copies) }
}

/**
 * 저장 응답. 서버 응답 모양은 다음 세 가지로만 해석한다.
 * - SAVED: 저장된 revision 과 정본 원고
 * - CONFLICT: 다른 기기가 먼저 저장함(409 REVISION_CONFLICT)
 * - REJECTED: 저장되지 않음(500 PERSISTENCE_ERROR, 네트워크, 알 수 없음)
 */
export type SaveOutcome =
  | { kind: 'SAVED'; revision: number; copies: Copies }
  | { kind: 'CONFLICT'; serverRevision: number; server: Copies }
  | { kind: 'REJECTED'; reason: 'PERSISTENCE_ERROR' | 'NETWORK' | 'UNKNOWN' }

function failed(state: EditSessionState): EditMutation {
  return { ok: true, changed: false, state: { ...state, save: 'FAILED', inflight: null } }
}

export function applySaveOutcome(state: EditSessionState, outcome: SaveOutcome): EditMutation {
  if (!state.inflight) return { ok: false, reason: 'NO_INFLIGHT' }

  if (outcome.kind === 'REJECTED') return failed(state)

  if (outcome.kind === 'SAVED') {
    // 확인해 준 revision 이 기준보다 뒤로 가면 정상 저장으로 보지 않는다.
    if (!isRevision(outcome.revision) || outcome.revision < state.baseRevision) return failed(state)
    const savedEverything = state.revision === state.inflight.localRevision
    return {
      ok: true,
      changed: false,
      state: {
        ...state,
        serverCopies: cloneCopies(outcome.copies),
        baseRevision: outcome.revision,
        save: savedEverything ? 'SAVED' : 'DIRTY',
        inflight: null,
      },
    }
  }

  // CONFLICT — 서버 revision 이 기준보다 낮으면(비정상) 병합하지 않고 실패로 둔다.
  if (!isRevision(outcome.serverRevision) || outcome.serverRevision < state.baseRevision) return failed(state)

  const diff = diffCopies(state.copies, outcome.server)
  if (diff.length === 0) {
    // 다른 기기가 저장했지만 내용은 같다. 서버 revision 으로 동기화만 한다.
    const savedEverything = state.revision === state.inflight.localRevision
    return {
      ok: true,
      changed: false,
      state: {
        ...state,
        serverCopies: cloneCopies(outcome.server),
        baseRevision: outcome.serverRevision,
        save: savedEverything ? 'SAVED' : 'DIRTY',
        inflight: null,
      },
    }
  }

  return {
    ok: true,
    changed: false,
    state: {
      ...state,
      save: 'DIRTY',
      inflight: null,
      conflict: { serverRevision: outcome.serverRevision, server: cloneCopies(outcome.server), diff },
    },
  }
}

/* ------------------------------------------------------------------ */
/* 충돌 시트 — 필드별 선택 후에만 병합                                */
/* ------------------------------------------------------------------ */

export type ConflictChoice = 'LOCAL' | 'SERVER'

export interface ConflictRow {
  field: FieldDiff['field']
  label: string
  /** 이 기기에서 고친 원문. 화면에 그대로 보여준다. */
  local: string
  /** 다른 기기에서 저장한 원문. 화면에 그대로 보여준다. */
  server: string
}

export function conflictRows(conflict: EditConflict): readonly ConflictRow[] {
  return conflict.diff.map((d) => ({
    field: d.field,
    label: EDIT_FIELD_LABEL[d.field],
    local: d.local,
    server: d.server,
  }))
}

/** 모든 필드에 같은 선택을 한 번에 적용할 때 쓰는 선택지. 기본값으로 쓰지 않는다. */
export function allChoices(conflict: EditConflict, choice: ConflictChoice): Record<FieldDiff['field'], ConflictChoice> {
  const choices = {} as Record<FieldDiff['field'], ConflictChoice>
  for (const d of conflict.diff) choices[d.field] = choice
  return choices
}

function mergeField(server: Copies, local: Copies, field: FieldDiff['field'], choice: ConflictChoice): string | string[] | undefined {
  const source = choice === 'SERVER' ? server : local
  if (field === 'instagram.caption') return source.instagram.caption
  if (field === 'threads.content') return source.threads.content
  return source.instagram.hashtags
}

/**
 * 시트에서 고른 결과로 병합한다. 선택이 하나라도 비어 있으면 저장하지 않는다.
 * 병합본이 서버 정본과 같으면 `SAVED`(서버가 이미 이 내용을 갖고 있음), 아니면 `DIRTY`.
 */
export function resolveConflict(
  state: EditSessionState,
  choices: Partial<Record<FieldDiff['field'], ConflictChoice>>,
): EditMutation {
  const conflict = state.conflict
  if (!conflict) return { ok: false, reason: 'NO_CONFLICT' }

  const unresolved = conflict.diff.map((d) => d.field).filter((field) => !choices[field])
  if (unresolved.length > 0) return { ok: false, reason: 'UNRESOLVED_FIELDS', fields: unresolved }

  const merged: Copies = {
    instagram: { caption: conflict.server.instagram.caption },
    threads: { content: conflict.server.threads.content },
  }
  const caption = mergeField(conflict.server, state.copies, 'instagram.caption', choices['instagram.caption']!)
  const hashtags = mergeField(conflict.server, state.copies, 'instagram.hashtags', choices['instagram.hashtags']!) as
    | string[]
    | undefined
  const content = mergeField(conflict.server, state.copies, 'threads.content', choices['threads.content']!) as string

  merged.instagram.caption = caption as string
  if (hashtags) merged.instagram.hashtags = [...hashtags]
  merged.threads.content = content

  const changed = diffCopies(merged, state.copies).length > 0
  const sameAsServer = diffCopies(merged, conflict.server).length === 0
  return {
    ok: true,
    changed,
    state: {
      ...state,
      copies: merged,
      serverCopies: cloneCopies(conflict.server),
      baseRevision: conflict.serverRevision,
      revision: changed ? state.revision + 1 : state.revision,
      save: sameAsServer ? 'SAVED' : 'DIRTY',
      conflict: null,
      inflight: null,
    },
  }
}

/** 저장 버튼이 눌리지 않아야 하는 이유. 없으면 null. */
export function saveBlockedReason(state: EditSessionState): EditRejectReason | null {
  if (state.inflight || state.save === 'SAVING') return 'SAVING'
  if (state.conflict) return 'CONFLICT_PENDING'
  if (state.save === 'SAVED') return 'NOTHING_TO_SAVE'
  return null
}

export function hasUnsavedEdits(state: EditSessionState): boolean {
  return state.save === 'DIRTY' || state.save === 'FAILED'
}
