/**
 * 대화 화면을 떠날 때 복원할 상태(탭·스크롤·카드·초점).
 *
 * 워크스페이스별로 분리 저장하고, 워크스페이스가 바뀌면 이전 캐시를 지운다.
 * 저장 키는 대화 복귀 정보만 다루며 다른 로컬 키는 건드리지 않는다.
 */

export type ChatReturnTab = 'today' | 'work' | 'chat'

export interface ChatReturnState {
  tab: ChatReturnTab | null
  scrollY: number
  cardId: string | null
  focusId: string | null
}

export const EMPTY_RETURN_STATE: ChatReturnState = Object.freeze({
  tab: null,
  scrollY: 0,
  cardId: null,
  focusId: null,
})

const KEY_PREFIX = 'mobile-chat:return:'

/** localStorage 와 호환되는 최소 인터페이스(테스트에서 대체 가능). */
export interface ReturnStorage {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function chatReturnKey(workspaceId: string): string {
  return `${KEY_PREFIX}${workspaceId}`
}

function readTab(value: unknown): ChatReturnTab | null {
  return value === 'today' || value === 'work' || value === 'chat' ? value : null
}

/** 스크롤 값은 0 이상의 정수로 내린다. 숫자가 아니면 0. */
function readScroll(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0
  }
  return Math.floor(value)
}

function readId(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** 저장된 문자열을 복원한다. 깨진 값이나 잘못된 필드는 빈 값으로 떨어뜨린다. */
export function parseChatReturn(raw: string | null | undefined): ChatReturnState {
  if (typeof raw !== 'string' || raw === '') return EMPTY_RETURN_STATE

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return EMPTY_RETURN_STATE
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return EMPTY_RETURN_STATE
  }

  const record = parsed as Record<string, unknown>
  return {
    tab: readTab(record.tab),
    scrollY: readScroll(record.scrollY),
    cardId: readId(record.cardId),
    focusId: readId(record.focusId),
  }
}

export function readChatReturn(
  storage: ReturnStorage,
  workspaceId: string,
): ChatReturnState {
  if (workspaceId === '') return EMPTY_RETURN_STATE

  return parseChatReturn(storage.getItem(chatReturnKey(workspaceId)))
}

export function writeChatReturn(
  storage: ReturnStorage,
  workspaceId: string,
  state: ChatReturnState,
): void {
  if (workspaceId === '') return

  storage.setItem(chatReturnKey(workspaceId), JSON.stringify(state))
}

export function clearChatReturn(storage: ReturnStorage, workspaceId: string): void {
  if (workspaceId === '') return

  storage.removeItem(chatReturnKey(workspaceId))
}

/** 현재 워크스페이스 외의 대화 복귀 캐시를 모두 지운다. 다른 접두사의 키는 남긴다. */
export function purgeOtherWorkspaces(
  storage: ReturnStorage,
  workspaceId: string,
): void {
  const keep = chatReturnKey(workspaceId)
  const stale: string[] = []

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key !== null && key !== keep && key.startsWith(KEY_PREFIX)) {
      stale.push(key)
    }
  }

  for (const key of stale) {
    storage.removeItem(key)
  }
}
