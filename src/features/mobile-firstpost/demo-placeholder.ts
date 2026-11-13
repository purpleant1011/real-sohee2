/**
 * 예시·시험 화면 전용 자리표시자 (ANI-1764).
 *
 * 실제 사진 대신 화면 배치만 보여 주기 위한 인라인 SVG 다. 파일·URL·스톡 사진을
 * 쓰지 않으며, `ACTUAL` 화면에서는 미리보기 계약이 이 주소를 거절한다.
 * 예시 화면에는 반드시 데이터셋 모드 라벨(`SHOWCASE_DEMO`)이 함께 보인다.
 */
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="810" viewBox="0 0 1080 810">' +
  '<rect width="1080" height="810" fill="#E8E6E1"/>' +
  '<g fill="#6F6A62" font-family="sans-serif" text-anchor="middle">' +
  '<text x="540" y="390" font-size="52">예시 화면</text>' +
  '<text x="540" y="456" font-size="30">실제 사진이 들어갈 자리예요</text>' +
  '</g></svg>'

export const DEMO_PLACEHOLDER_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(SVG)}`
