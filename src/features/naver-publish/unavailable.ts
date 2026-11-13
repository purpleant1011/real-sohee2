export const NAVER_PUBLISH_NOT_READY = 'NAVER_PUBLISH_NOT_READY' as const

export const NAVER_PUBLISH_NOT_READY_MESSAGE =
  '네이버 블로그에는 소희가 대신 올리지 않아요. 복사·사진 저장 후 네이버에서 직접 게시해 주세요.' as const

/**
 * What every server-side Naver publish entry point returns until the connected-extension path is live.
 * Naver has no public write API, so the server must never report a publish it did not observe.
 */
export function naverPublishNotReadyResult() {
  return {
    success: false,
    verified: false,
    channel: 'naver_blog',
    errorCode: NAVER_PUBLISH_NOT_READY,
    message: NAVER_PUBLISH_NOT_READY_MESSAGE,
  } as const
}
