import { describe, expect, it } from 'vitest'

import {
  EMPTY_RETURN_STATE,
  chatReturnKey,
  clearChatReturn,
  parseChatReturn,
  purgeOtherWorkspaces,
  readChatReturn,
  writeChatReturn,
  type ReturnStorage,
} from './return-state'

function createStorage(seed: Record<string, string> = {}): ReturnStorage & { dump: () => Record<string, string> } {
  const map = new Map<string, string>(Object.entries(seed))
  return {
    get length() {
      return map.size
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null
    },
    setItem(key: string, value: string) {
      map.set(key, value)
    },
    removeItem(key: string) {
      map.delete(key)
    },
    dump() {
      return Object.fromEntries(map)
    },
  }
}

describe('chatReturnKey', () => {
  it('워크스페이스별로 분리된 키를 쓴다', () => {
    expect(chatReturnKey('ws_a')).toBe('mobile-chat:return:ws_a')
    expect(chatReturnKey('ws_a')).not.toBe(chatReturnKey('ws_b'))
  })
})

describe('parseChatReturn', () => {
  it('저장된 값을 복원한다', () => {
    const raw = JSON.stringify({ tab: 'work', scrollY: 420.7, cardId: 'apr_1', focusId: 'bubble_9' })
    expect(parseChatReturn(raw)).toEqual({ tab: 'work', scrollY: 420, cardId: 'apr_1', focusId: 'bubble_9' })
  })

  it('깨진 JSON 은 빈 상태다', () => {
    expect(parseChatReturn('{')).toEqual(EMPTY_RETURN_STATE)
    expect(parseChatReturn('null')).toEqual(EMPTY_RETURN_STATE)
    expect(parseChatReturn('"tab"')).toEqual(EMPTY_RETURN_STATE)
    expect(parseChatReturn(null)).toEqual(EMPTY_RETURN_STATE)
  })

  it('잘못된 필드는 버리고 나머지만 쓴다', () => {
    const raw = JSON.stringify({ tab: 42, scrollY: -10, cardId: '', focusId: null })
    expect(parseChatReturn(raw)).toEqual(EMPTY_RETURN_STATE)
  })

  it('스크롤 값이 NaN/문자열이면 0 이다', () => {
    expect(parseChatReturn(JSON.stringify({ scrollY: '300' })).scrollY).toBe(0)
    expect(parseChatReturn(JSON.stringify({ scrollY: Number.POSITIVE_INFINITY })).scrollY).toBe(0)
  })
})

describe('readChatReturn / writeChatReturn / clearChatReturn', () => {
  it('쓰고 읽고 지운다', () => {
    const storage = createStorage()
    writeChatReturn(storage, 'ws_a', { tab: 'today', scrollY: 12, cardId: null, focusId: 'f1' })
    expect(readChatReturn(storage, 'ws_a')).toEqual({ tab: 'today', scrollY: 12, cardId: null, focusId: 'f1' })
    clearChatReturn(storage, 'ws_a')
    expect(readChatReturn(storage, 'ws_a')).toEqual(EMPTY_RETURN_STATE)
  })

  it('다른 워크스페이스의 상태는 읽히지 않는다', () => {
    const storage = createStorage()
    writeChatReturn(storage, 'ws_a', { tab: 'work', scrollY: 5, cardId: 'x', focusId: null })
    expect(readChatReturn(storage, 'ws_b')).toEqual(EMPTY_RETURN_STATE)
  })

  it('워크스페이스가 비면 아무것도 저장하지 않는다', () => {
    const storage = createStorage()
    writeChatReturn(storage, '', { tab: 'work', scrollY: 5, cardId: null, focusId: null })
    expect(storage.dump()).toEqual({})
    expect(readChatReturn(storage, '')).toEqual(EMPTY_RETURN_STATE)
  })
})

describe('purgeOtherWorkspaces', () => {
  it('현재 워크스페이스만 남기고 지운다', () => {
    const storage = createStorage({
      'mobile-chat:return:ws_a': '{"tab":"work"}',
      'mobile-chat:return:ws_b': '{"tab":"today"}',
      'mobile-shell:draft:ws_a': 'keep me',
    })
    purgeOtherWorkspaces(storage, 'ws_a')
    expect(storage.dump()).toEqual({
      'mobile-chat:return:ws_a': '{"tab":"work"}',
      'mobile-shell:draft:ws_a': 'keep me',
    })
  })

  it('현재 워크스페이스가 없으면 대화 복귀 정보를 모두 지운다', () => {
    const storage = createStorage({
      'mobile-chat:return:ws_a': '{}',
      'mobile-chat:return:ws_b': '{}',
    })
    purgeOtherWorkspaces(storage, '')
    expect(storage.dump()).toEqual({})
  })
})
