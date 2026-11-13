import { afterEach, describe, expect, it } from 'vitest'
import { hasPendingUserInput } from '../unsaved-input'

/**
 * ANI-1723: 앱 업데이트 적용 전에 사용자가 입력 중인 내용이 있는지 판정한다.
 * 값이 비어 있거나, 비활성/읽기 전용/숨김 필드는 "입력 중"으로 보지 않는다.
 */

afterEach(() => {
  document.body.innerHTML = ''
})

describe('hasPendingUserInput', () => {
  it('ignores empty and whitespace-only fields', () => {
    document.body.innerHTML = `
      <textarea></textarea>
      <input type="text" value="" />
      <div contenteditable="true">   </div>
    `
    expect(hasPendingUserInput()).toBe(false)
  })

  it('detects text typed into a textarea or text input', () => {
    const textarea = document.createElement('textarea')
    textarea.value = '고객님께 보낼 답장 초안'
    document.body.appendChild(textarea)
    expect(hasPendingUserInput()).toBe(true)

    textarea.value = ''
    const input = document.createElement('input')
    input.type = 'search'
    input.value = '예약'
    document.body.appendChild(input)
    expect(hasPendingUserInput()).toBe(true)
  })

  it('detects text inside a contenteditable block', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'plaintext-only')
    editor.textContent = '수정 중인 공지'
    document.body.appendChild(editor)
    expect(hasPendingUserInput()).toBe(true)

    editor.textContent = '   '
    expect(hasPendingUserInput()).toBe(false)
  })

  it('ignores non-text controls and non-editable blocks', () => {
    document.body.innerHTML = `
      <input type="hidden" value="secret" />
      <input type="checkbox" checked />
      <select><option selected>a</option></select>
      <div contenteditable="false">읽기 전용 안내</div>
    `
    expect(hasPendingUserInput()).toBe(false)
  })

  it('ignores disabled, read-only, hidden and aria-hidden fields', () => {
    document.body.innerHTML = `
      <textarea disabled>보낼 수 없는 값</textarea>
      <input type="text" readonly value="읽기 전용" />
      <div hidden><input type="text" value="숨김" /></div>
      <input type="text" aria-hidden="true" value="장식용" />
    `
    expect(hasPendingUserInput()).toBe(false)
  })

  it('looks inside an explicit root and stays safe without a document', () => {
    const root = document.createElement('section')
    root.innerHTML = '<textarea>임시 저장 안 된 메모</textarea>'
    expect(hasPendingUserInput(root)).toBe(true)
    expect(hasPendingUserInput(document.createElement('section'))).toBe(false)
  })
})
