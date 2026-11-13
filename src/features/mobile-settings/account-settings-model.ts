import type { BusinessSettings, SettingsActionResult } from '@/features/settings/types'

/**
 * 설정(`/app/account`) R2 화면이 받는 값(ANI-1771, 플래그 뒤).
 *
 * `ok: false` 는 "설정이 비어 있음"이 아니라 **서버 정본을 읽지 못했다**는 뜻이다.
 * 이 구분이 없으면 조회 실패가 빈 사업 정보로 보인다 — 오류와 빈 값을 섞지 않는다.
 * 가게 식별자(workspaceId)는 이 화면에 넘기지 않는다. 서버가 세션으로 정한다.
 */
export type AccountSettingsProp =
  | Readonly<{ ok: true; business: BusinessSettings; canEdit: boolean }>
  | Readonly<{ ok: false }>

export type AccountSaveState = Readonly<{ tone: 'saved' | 'error'; message: string }>

/**
 * 저장 결과를 화면 문구로 옮긴다.
 * 성공 문구는 서버 액션이 `ok: true` 를 돌려준 경우에만 쓴다(전송 성공 ≠ 저장 확인).
 */
export function accountSaveState(result: SettingsActionResult): AccountSaveState {
  if (result.ok) return { tone: 'saved', message: result.message }
  const fieldMessage = result.fieldErrors?.businessName?.[0]
  return { tone: 'error', message: fieldMessage ? `${result.message} ${fieldMessage}` : result.message }
}

export function accountEditNote(canEdit: boolean): string {
  return canEdit
    ? '저장하면 이 가게의 사업 정보가 바로 바뀌어요.'
    : '지금 역할은 저장된 내용을 볼 수만 있어요. 바꾸려면 가게 관리자에게 요청해 주세요.'
}
