/** 대화 옆 원고 레일에서 고른 문단을 같은 content 의 문단 수정 패널로 넘기는 브라우저 이벤트. */
export const NAVER_BLOCK_SELECT_EVENT = 'sohee:naver-block-select'

export type NaverBlockSelectDetail = Readonly<{ contentId: string; index: number }>

export function dispatchNaverBlockSelect(detail: NaverBlockSelectDetail) {
  window.dispatchEvent(new CustomEvent<NaverBlockSelectDetail>(NAVER_BLOCK_SELECT_EVENT, { detail }))
}
