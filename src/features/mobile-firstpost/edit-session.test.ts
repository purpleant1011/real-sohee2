import { describe, expect, it } from 'vitest'
import { diffCopies, type Copies } from './revision-conflict'
import {
  EDIT_FIELD_LABEL,
  allChoices,
  applySaveOutcome,
  beginSave,
  conflictRows,
  createEditSession,
  editInstagram,
  editThreads,
  hasUnsavedEdits,
  pendingSaveRequest,
  resolveConflict,
  saveBlockedReason,
  type EditSessionState,
  type SaveOutcome,
} from './edit-session'

const base: Copies = {
  instagram: { caption: '이번 주 예약 가능', hashtags: ['예약', '뷰티'] },
  threads: { content: '이번 주 예약 가능합니다' },
}

function session(copies: Copies = base, revision = 2): EditSessionState {
  return createEditSession({ copies, revision })
}

/** 편집 → 저장 시작까지. */
function dirtySaving(state: EditSessionState): { state: EditSessionState; expectedRevision: number } {
  const edited = editInstagram(state, { caption: '이번 주 평일 예약 가능' })
  if (!edited.ok) throw new Error(edited.reason)
  const begun = beginSave(edited.state)
  if (!begun.ok) throw new Error(begun.reason)
  return { state: begun.state, expectedRevision: begun.request.expectedRevision }
}

describe('createEditSession — 서버가 확인해 준 원고에서 출발', () => {
  it('확인된 원고에서는 SAVED로 시작하고 저장 요청에 기준 revision을 싣는다', () => {
    const s = session(base, 4)
    expect(s.save).toBe('SAVED')
    expect(s.baseRevision).toBe(4)
    expect(s.conflict).toBeNull()
    expect(s.inflight).toBeNull()
    expect(hasUnsavedEdits(s)).toBe(false)
    expect(saveBlockedReason(s)).toBe('NOTHING_TO_SAVE')
  })

  it('revision이 정수가 아니거나 음수면 시작하지 않는다', () => {
    expect(() => createEditSession({ copies: base, revision: 1.5 })).toThrow(RangeError)
    expect(() => createEditSession({ copies: base, revision: -1 })).toThrow(RangeError)
  })

  it('입력 원고를 복사해 둔다(뒤에서 원본이 바뀌어도 세션은 흔들리지 않는다)', () => {
    const input: Copies = {
      instagram: { caption: '원고', hashtags: ['a'] },
      threads: { content: '스레드' },
    }
    const s = createEditSession({ copies: input, revision: 0 })
    input.instagram.caption = '바뀐 원고'
    input.instagram.hashtags!.push('b')
    expect(s.copies.instagram.caption).toBe('원고')
    expect(s.copies.instagram.hashtags).toEqual(['a'])
  })
})

describe('편집 — 빈 원고는 저장하지 않고 입력 그대로 보존', () => {
  it('인스타그램 문구를 바꾸면 DIRTY가 되고 변경 횟수가 오른다', () => {
    const r = editInstagram(session(), { caption: '새 문구' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.changed).toBe(true)
    expect(r.state.save).toBe('DIRTY')
    expect(r.state.revision).toBe(1)
    expect(r.state.baseRevision).toBe(2)
  })

  it('같은 내용으로 다시 쓰면 변경으로 세지 않는다', () => {
    const s = session()
    const r = editInstagram(s, { caption: base.instagram.caption })
    expect(r).toEqual({ ok: true, state: s, changed: false })
  })

  it('공백만 남은 문구는 받지 않는다', () => {
    expect(editInstagram(session(), { caption: '   ' })).toEqual({ ok: false, reason: 'EMPTY_COPY' })
    expect(editThreads(session(), { content: '' })).toEqual({ ok: false, reason: 'EMPTY_COPY' })
  })

  it('채널을 오가도 원고가 남는다', () => {
    const a = editInstagram(session(), { caption: '인스타 문구' })
    if (!a.ok) throw new Error(a.reason)
    const b = editThreads(a.state, { content: '스레드 문구' })
    if (!b.ok) throw new Error(b.reason)
    expect(b.state.copies.instagram.caption).toBe('인스타 문구')
    expect(b.state.copies.threads.content).toBe('스레드 문구')
  })

  it('충돌 시트가 떠 있는 동안에는 편집을 받지 않는다', () => {
    const { state } = dirtySaving(session())
    const conflicted = applySaveOutcome(state, {
      kind: 'CONFLICT',
      serverRevision: 3,
      server: { ...base, instagram: { ...base.instagram, caption: '다른 기기 문구' } },
    })
    if (!conflicted.ok) throw new Error(conflicted.reason)
    expect(editInstagram(conflicted.state, { caption: '또 수정' })).toEqual({ ok: false, reason: 'CONFLICT_PENDING' })
    expect(editThreads(conflicted.state, { content: '또 수정' })).toEqual({ ok: false, reason: 'CONFLICT_PENDING' })
  })
})

describe('저장 요청 — 기준 revision', () => {
  it('편집 없이 저장 버튼을 누르면 요청을 만들지 않는다', () => {
    expect(beginSave(session())).toEqual({ ok: false, reason: 'NOTHING_TO_SAVE' })
  })

  it('저장 요청은 마지막으로 서버가 확인한 revision과 현재 원고를 싣는다', () => {
    const { expectedRevision } = dirtySaving(session(base, 7))
    expect(expectedRevision).toBe(7)
  })

  it('저장 중 연타는 새 요청을 만들지 않는다', () => {
    const { state } = dirtySaving(session())
    expect(state.save).toBe('SAVING')
    expect(beginSave(state)).toEqual({ ok: false, reason: 'SAVING' })
    expect(saveBlockedReason(state)).toBe('SAVING')
  })

  it('저장 중 재시도용 요청은 보낸 시점의 원고를 그대로 돌려준다', () => {
    const { state } = dirtySaving(session(base, 5))
    const pending = pendingSaveRequest(state)
    expect(pending).not.toBeNull()
    expect(pending!.expectedRevision).toBe(5)
    expect(pending!.copies.instagram.caption).toBe('이번 주 평일 예약 가능')
  })

  it('진행 중인 저장이 없으면 재시도 요청도 없다', () => {
    expect(pendingSaveRequest(session())).toBeNull()
  })

  it('저장 실패 뒤에는 다시 저장을 시작할 수 있다', () => {
    const { state } = dirtySaving(session())
    const failed = applySaveOutcome(state, { kind: 'REJECTED', reason: 'PERSISTENCE_ERROR' })
    if (!failed.ok) throw new Error(failed.reason)
    expect(failed.state.save).toBe('FAILED')
    expect(saveBlockedReason(failed.state)).toBeNull()
    expect(beginSave(failed.state).ok).toBe(true)
  })
})

describe('저장 응답 — 성공은 서버 확인 뒤에만', () => {
  it('서버가 저장 revision을 확인해 주면 SAVED', () => {
    const { state } = dirtySaving(session())
    const r = applySaveOutcome(state, {
      kind: 'SAVED',
      revision: 3,
      copies: state.copies,
    })
    if (!r.ok) throw new Error(r.reason)
    expect(r.state.save).toBe('SAVED')
    expect(r.state.baseRevision).toBe(3)
    expect(r.state.inflight).toBeNull()
    expect(hasUnsavedEdits(r.state)).toBe(false)
  })

  it('저장 중에 더 고쳤으면 그 응답은 현재 원고의 확인이 아니므로 DIRTY로 내린다', () => {
    const { state } = dirtySaving(session(base, 1))
    const more = editThreads(state, { content: '저장 중에 고친 스레드' })
    if (!more.ok) throw new Error(more.reason)

    const r = applySaveOutcome(more.state, {
      kind: 'SAVED',
      revision: 2,
      copies: state.inflight!.copies,
    })
    if (!r.ok) throw new Error(r.reason)
    expect(r.state.save).toBe('DIRTY')
    expect(r.state.baseRevision).toBe(2)
    expect(r.state.copies.threads.content).toBe('저장 중에 고친 스레드')
    expect(r.state.serverCopies.threads.content).toBe('이번 주 예약 가능합니다')
  })

  it('500·네트워크·알 수 없음은 성공으로 바꾸지 않고 FAILED로 둔다', () => {
    const reasons: SaveOutcome[] = [
      { kind: 'REJECTED', reason: 'PERSISTENCE_ERROR' },
      { kind: 'REJECTED', reason: 'NETWORK' },
      { kind: 'REJECTED', reason: 'UNKNOWN' },
    ]
    for (const outcome of reasons) {
      const { state } = dirtySaving(session())
      const r = applySaveOutcome(state, outcome)
      if (!r.ok) throw new Error(r.reason)
      expect(r.state.save).toBe('FAILED')
      expect(r.state.conflict).toBeNull()
      expect(r.state.baseRevision).toBe(state.baseRevision)
      expect(r.state.inflight).toBeNull()
      expect(hasUnsavedEdits(r.state)).toBe(true)
    }
  })

  it('서버가 준 revision이 기준보다 뒤로 가면 정상 저장으로 보지 않는다', () => {
    const { state } = dirtySaving(session(base, 4))
    const r = applySaveOutcome(state, { kind: 'SAVED', revision: 3, copies: state.copies })
    if (!r.ok) throw new Error(r.reason)
    expect(r.state.save).toBe('FAILED')
    expect(r.state.baseRevision).toBe(4)
  })

  it('revision이 정수가 아니면 정상 저장으로 보지 않는다', () => {
    const { state } = dirtySaving(session(base, 1))
    const r = applySaveOutcome(state, { kind: 'SAVED', revision: Number.NaN, copies: state.copies })
    if (!r.ok) throw new Error(r.reason)
    expect(r.state.save).toBe('FAILED')
  })

  it('진행 중인 저장이 없는 응답은 반영하지 않는다(중복 응답)', () => {
    expect(applySaveOutcome(session(), { kind: 'REJECTED', reason: 'UNKNOWN' })).toEqual({
      ok: false,
      reason: 'NO_INFLIGHT',
    })
  })
})

describe('409 충돌 — 필드별 선택 전에는 병합·저장 금지', () => {
  const server: Copies = {
    instagram: { caption: '다른 기기 문구', hashtags: ['다른', '기기'] },
    threads: { content: '다른 기기 스레드' },
  }

  function conflicted(): EditSessionState {
    const s = editInstagram(session(), { caption: '내 문구', hashtags: ['내', '해시태그'] })
    if (!s.ok) throw new Error(s.reason)
    const t = editThreads(s.state, { content: '내 스레드' })
    if (!t.ok) throw new Error(t.reason)
    const begun = beginSave(t.state)
    if (!begun.ok) throw new Error(begun.reason)
    const r = applySaveOutcome(begun.state, { kind: 'CONFLICT', serverRevision: 3, server })
    if (!r.ok) throw new Error(r.reason)
    return r.state
  }

  it('충돌을 받으면 저장 대기 상태로 두고 세 필드의 차이를 시트 행으로 보여준다', () => {
    const s = conflicted()
    expect(s.save).toBe('DIRTY')
    expect(s.inflight).toBeNull()
    expect(s.conflict?.serverRevision).toBe(3)
    expect(s.conflict?.diff.map((d) => d.field)).toEqual([
      'instagram.caption',
      'instagram.hashtags',
      'threads.content',
    ])

    const rows = conflictRows(s.conflict!)
    expect(rows.every((r) => r.local.length > 0 && r.server.length > 0)).toBe(true)
    expect(rows.map((r) => r.label)).toEqual([
      '인스타그램 문구',
      '인스타그램 해시태그',
      '스레드 문구',
    ])
    expect(rows.some((r) => r.label.includes('.'))).toBe(false)
    expect(saveBlockedReason(s)).toBe('CONFLICT_PENDING')
    expect(beginSave(s)).toEqual({ ok: false, reason: 'CONFLICT_PENDING' })
  })

  it('아무 필드도 고르지 않으면 병합하지 않는다', () => {
    const s = conflicted()
    expect(resolveConflict(s, {})).toEqual({
      ok: false,
      reason: 'UNRESOLVED_FIELDS',
      fields: ['instagram.caption', 'instagram.hashtags', 'threads.content'],
    })
  })

  it('일부 필드만 골라도 나머지가 비어 있으면 병합하지 않는다', () => {
    const s = conflicted()
    const r = resolveConflict(s, { 'instagram.caption': 'LOCAL' })
    expect(r).toEqual({
      ok: false,
      reason: 'UNRESOLVED_FIELDS',
      fields: ['instagram.hashtags', 'threads.content'],
    })
  })

  it('모든 필드를 내 수정으로 고르면 병합본은 DIRTY(아직 저장 전)', () => {
    const s = conflicted()
    const r = resolveConflict(s, allChoices(s.conflict!, 'LOCAL'))
    if (!r.ok) throw new Error(r.reason)
    expect(r.state.save).toBe('DIRTY')
    expect(r.state.copies.instagram.caption).toBe('내 문구')
    expect(r.state.copies.instagram.hashtags).toEqual(['내', '해시태그'])
    expect(r.state.copies.threads.content).toBe('내 스레드')
    expect(r.state.baseRevision).toBe(3)
    expect(r.state.conflict).toBeNull()
  })

  it('모든 필드를 다른 기기 수정으로 고르면 서버 정본과 같아져 SAVED', () => {
    const s = conflicted()
    const r = resolveConflict(s, allChoices(s.conflict!, 'SERVER'))
    if (!r.ok) throw new Error(r.reason)
    expect(r.state.save).toBe('SAVED')
    expect(diffCopies(r.state.copies, server)).toEqual([])
    expect(r.state.baseRevision).toBe(3)
    expect(hasUnsavedEdits(r.state)).toBe(false)
  })

  it('필드별로 섞어 고를 수 있다', () => {
    const s = conflicted()
    const r = resolveConflict(s, {
      'instagram.caption': 'SERVER',
      'instagram.hashtags': 'LOCAL',
      'threads.content': 'SERVER',
    })
    if (!r.ok) throw new Error(r.reason)
    expect(r.state.copies.instagram.caption).toBe('다른 기기 문구')
    expect(r.state.copies.instagram.hashtags).toEqual(['내', '해시태그'])
    expect(r.state.copies.threads.content).toBe('다른 기기 스레드')
    expect(r.state.save).toBe('DIRTY')
  })

  it('충돌이 없는 상태에서는 병합을 시작하지 않는다', () => {
    expect(resolveConflict(session(), {})).toEqual({ ok: false, reason: 'NO_CONFLICT' })
  })

  it('다른 기기가 먼저 저장했지만 내용이 같으면 충돌 없이 서버 revision으로 맞춘다', () => {
    const { state } = dirtySaving(session(base, 2))
    const r = applySaveOutcome(state, {
      kind: 'CONFLICT',
      serverRevision: 3,
      server: state.copies,
    })
    if (!r.ok) throw new Error(r.reason)
    expect(r.state.conflict).toBeNull()
    expect(r.state.save).toBe('SAVED')
    expect(r.state.baseRevision).toBe(3)
    expect(diffCopies(r.state.copies, r.state.serverCopies)).toEqual([])
  })

  it('충돌 응답의 서버 revision이 기준보다 낮으면 병합하지 않고 FAILED', () => {
    const { state } = dirtySaving(session(base, 5))
    const r = applySaveOutcome(state, { kind: 'CONFLICT', serverRevision: 4, server })
    if (!r.ok) throw new Error(r.reason)
    expect(r.state.conflict).toBeNull()
    expect(r.state.save).toBe('FAILED')
    expect(r.state.baseRevision).toBe(5)
  })

  it('필드 라벨은 전부 한글 표시명이다', () => {
    for (const label of Object.values(EDIT_FIELD_LABEL)) {
      expect(label).toMatch(/^[가-힣\s]+$/)
    }
  })
})

describe('저장 버튼 상태', () => {
  it('DIRTY면 저장 가능하고 미저장 편집이 있다', () => {
    const r = editInstagram(session(), { caption: '새 문구' })
    if (!r.ok) throw new Error(r.reason)
    expect(saveBlockedReason(r.state)).toBeNull()
    expect(hasUnsavedEdits(r.state)).toBe(true)
  })

  it('SAVED면 저장할 것이 없다', () => {
    expect(saveBlockedReason(session())).toBe('NOTHING_TO_SAVE')
    expect(hasUnsavedEdits(session())).toBe(false)
  })
})
