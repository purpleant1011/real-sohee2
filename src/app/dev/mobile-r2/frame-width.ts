/** 미리보기 iframe 폭 기본값·허용 범위. 모바일 390 기준이며 데스크톱 미리보기용으로만 쓴다. */
export const DEFAULT_FRAME_WIDTH = 390
export const MIN_FRAME_WIDTH = 320
export const MAX_FRAME_WIDTH = 480

/**
 * `?w=` 값을 iframe 폭(px)으로 해석한다. 없거나 숫자가 아니면 기본값,
 * 범위를 벗어나면 경계로 보정한다(잘못된 값으로 레이아웃이 깨지지 않게).
 */
export function parseFrameWidth(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value || !/^\d+$/.test(value.trim())) return DEFAULT_FRAME_WIDTH
  const width = Number.parseInt(value.trim(), 10)
  if (!Number.isFinite(width)) return DEFAULT_FRAME_WIDTH
  return Math.min(MAX_FRAME_WIDTH, Math.max(MIN_FRAME_WIDTH, width))
}
