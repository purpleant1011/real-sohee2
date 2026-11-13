/**
 * PC 또는 첫 포스팅 모바일 R2 플래그가 꺼진 환경에서 사장님이 '글 만들기' 진입 시 보낼 실제 글쓰기 시작 화면.
 * PC에서는 콘텐츠 허브의 4채널 글 만들기 스튜디오(`?studio=four-channel`)로 연결한다.
 */
export const WORK_NEW_FALLBACK_ROUTE = '/app/content?studio=four-channel'

/**
 * `/app/work/new` 첫 포스팅 실라우트를 열지 판정한다(ANI-1767).
 *
 * 화면(`FirstPostFlow`)은 `NEXT_PUBLIC_MOBILE_R2_FIRSTPOST === 'on'` 일 때만 첫 포스팅 3단계를
 * 그린다(`first-post-flow.tsx` 의 `isFirstPostR2Enabled`). 서버 페이지가 그 'use client' 모듈의
 * 함수를 직접 부르면 클라이언트 참조 프록시라 실행되지 않으므로, 같은 계약을 여기서 한 번만
 * 문자열로 비교한다. 두 정의가 갈라지는 회귀는 `first-post-routes.test.ts` 가 잡는다.
 */
export function shouldOpenFirstPostRoute(r2Enabled: boolean, firstPostFlag: string | undefined): boolean {
  return r2Enabled && firstPostFlag === 'on'
}
