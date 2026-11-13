/**
 * ANI-1723: 앱 업데이트를 적용하기 전에 사용자가 입력 중인 내용이 있는지 판정한다.
 *
 * 새 워커로 전환하면 화면이 새로고침되므로, 아직 서버에 저장되지 않은 입력이
 * 사라질 수 있다. 형식이 있는 필드(체크박스·선택·숨김)와 이미 저장/표시용으로
 * 잠긴 필드(disabled·readonly·hidden·aria-hidden)는 판정에서 제외한다.
 */

/** 값을 직접 받는 입력 타입. 그 외(hidden·checkbox·radio·file·button 등)는 제외한다. */
const TEXT_ENTRY_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
  'date',
  'datetime-local',
  'month',
  'time',
  'week',
])

const CANDIDATE_SELECTOR = 'input, textarea, [contenteditable]'

function isContentEditableElement(element: Element): boolean {
  const attribute = element.getAttribute('contenteditable')
  if (attribute === null) return false
  const value = attribute.trim().toLowerCase()
  return value === '' || value === 'true' || value === 'plaintext-only'
}

function isTextEntryElement(element: Element): boolean {
  if (element.tagName === 'INPUT') {
    const type = (element.getAttribute('type') ?? 'text').trim().toLowerCase()
    return TEXT_ENTRY_INPUT_TYPES.has(type)
  }
  if (element.tagName === 'TEXTAREA') return true
  return isContentEditableElement(element)
}

function readInputValue(element: Element): string {
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
    return (element as HTMLInputElement | HTMLTextAreaElement).value ?? ''
  }
  return element.textContent ?? ''
}

function isInactive(element: Element): boolean {
  const field = element as HTMLInputElement | HTMLTextAreaElement
  if (field.disabled === true) return true
  if (field.readOnly === true) return true
  // 숨김·장식용·비활성 영역의 필드는 사용자가 입력할 수 없다.
  return element.closest('[hidden], [aria-hidden="true"], [inert]') !== null
}

function collectCandidates(scope: ParentNode): Element[] {
  const candidates: Element[] = []
  if (typeof Element !== 'undefined' && scope instanceof Element && scope.matches(CANDIDATE_SELECTOR)) {
    candidates.push(scope)
  }
  candidates.push(...Array.from(scope.querySelectorAll(CANDIDATE_SELECTOR)))
  return candidates
}

/**
 * 저장되지 않은 입력이 남아 있으면 true.
 * `root` 를 주면 그 하위만 본다. 문서가 없는 환경(SSR/워커)에서는 false 로 안전하게 끝난다.
 */
export function hasPendingUserInput(root?: ParentNode): boolean {
  const scope = root ?? (typeof document === 'undefined' ? null : document.body)
  if (!scope) return false

  for (const element of collectCandidates(scope)) {
    if (!isTextEntryElement(element)) continue
    if (isInactive(element)) continue
    if (readInputValue(element).trim().length > 0) return true
  }
  return false
}
