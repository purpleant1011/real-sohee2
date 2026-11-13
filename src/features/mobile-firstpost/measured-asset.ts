'use client'

import { useEffect, useState } from 'react'
import type { PreviewAsset } from './preview-set'

/**
 * 사진 원본 크기 측정 (ANI-1678 / ANI-1764).
 *
 * 승인 스냅샷은 서버가 아는 원본 크기(`width`/`height`)를 함께 내려준다(ANI-1764).
 * 서버가 모르는 사진만 브라우저에서 실제 원본 크기를 잰다 — 이 훅은 그 fallback 이다.
 * 재지 못하면 0 을 그대로 두어 미리보기가 사진 없이 그려지지 않게 한다(fail-closed).
 */
export type MeasuredAssetStatus = 'none' | 'measuring' | 'measured' | 'failed'

export type MeasuredAssetResult = Readonly<{
  asset: PreviewAsset | null
  status: MeasuredAssetStatus
}>

const NO_ASSET: MeasuredAssetResult = { asset: null, status: 'none' }

/**
 * `attempt` 는 같은 사진을 다시 재게 하는 세대 번호다. 값이 바뀌면 측정 키가 달라져
 * 이전 실패(`failedKey`)가 초기화되고 사진을 다시 요청한다 — 화면의 '다시 확인'용.
 */
export function useMeasuredImage(asset: PreviewAsset | null, attempt = 0): MeasuredAssetResult {
  const key = asset ? `${asset.assetId}|${asset.imageUrl}|${attempt}` : ''
  const src = asset?.imageUrl ?? ''
  const needs = asset !== null && !(asset.width > 0 && asset.height > 0) && src.trim().length > 0
  const [measured, setMeasured] = useState<{ key: string; width: number; height: number } | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)

  useEffect(() => {
    if (!needs || !src) return
    // 브라우저가 없는 환경(테스트 SSR)에서는 잴 수 없다. 상태는 렌더에서 'failed' 로 계산한다.
    if (typeof Image === 'undefined') return
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      if (img.naturalWidth > 0 && img.naturalHeight > 0) setMeasured({ key, width: img.naturalWidth, height: img.naturalHeight })
      else setFailedKey(key)
    }
    img.onerror = () => {
      if (!cancelled) setFailedKey(key)
    }
    img.src = src
    return () => {
      cancelled = true
      img.onload = null
      img.onerror = null
    }
  }, [needs, key, src])

  if (!asset) return NO_ASSET
  if (!needs) return { asset, status: 'measured' }
  if (typeof Image === 'undefined') return { asset, status: 'failed' }
  if (measured?.key === key) {
    return { asset: { ...asset, width: measured.width, height: measured.height }, status: 'measured' }
  }
  if (failedKey === key) return { asset, status: 'failed' }
  return { asset, status: 'measuring' }
}

/** 크기 측정값만 필요한 소비처용(첫 포스팅 흐름). */
export function useMeasuredAsset(asset: PreviewAsset | null): PreviewAsset | null {
  return useMeasuredImage(asset).asset
}
