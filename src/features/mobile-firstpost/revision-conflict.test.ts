import { describe, expect, it } from 'vitest'
import { resolveSave, diffCopies, type Copies } from './revision-conflict'

const a: Copies = { instagram: { caption: '이번 주 예약 가능' }, threads: { content: '이번 주 예약 가능' } }
const b: Copies = { instagram: { caption: '이번 주 평일 예약 가능' }, threads: { content: '이번 주 예약 가능' } }

describe('resolveSave — 두 기기 동시 편집', () => {
  it('기준 revision이 서버와 같으면 저장 허용', () => {
    expect(resolveSave({ baseRevision: 2, serverRevision: 2, local: a, server: a })).toEqual({ kind: 'SAVE' })
  })
  it('구버전 기준이면 무증거 덮어쓰기 대신 CONFLICT와 필드별 비교를 낸다', () => {
    const r = resolveSave({ baseRevision: 2, serverRevision: 3, local: a, server: b })
    expect(r.kind).toBe('CONFLICT')
    if (r.kind === 'CONFLICT') {
      expect(r.diff.map((d) => d.field)).toEqual(['instagram.caption'])
    }
  })
  it('구버전이어도 내용이 같으면 충돌이 아니라 최신 revision으로 동기화', () => {
    expect(resolveSave({ baseRevision: 2, serverRevision: 3, local: a, server: a })).toEqual({ kind: 'ALREADY_CURRENT', revision: 3 })
  })
  it('서버 revision이 기준보다 낮으면(비정상) 저장하지 않고 UNKNOWN', () => {
    expect(resolveSave({ baseRevision: 5, serverRevision: 3, local: a, server: b }).kind).toBe('UNKNOWN')
  })
})

describe('diffCopies', () => {
  it('동일하면 빈 배열', () => expect(diffCopies(a, a)).toEqual([]))
  it('해시태그 순서 차이도 변경으로 본다', () => {
    const x: Copies = { ...a, instagram: { caption: 'c', hashtags: ['a', 'b'] } }
    const y: Copies = { ...a, instagram: { caption: 'c', hashtags: ['b', 'a'] } }
    expect(diffCopies(x, y).map((d) => d.field)).toEqual(['instagram.hashtags'])
  })
})
