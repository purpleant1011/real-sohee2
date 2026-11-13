'use client'

import { useSyncExternalStore } from 'react'

/** 네트워크 상태 (ANI-1719). navigator.onLine 은 힌트일 뿐이므로 확인용 probe 를 함께 제공한다. */

type ConnectionLike = { effectiveType?: string; saveData?: boolean; addEventListener?: (t: string, l: () => void) => void; removeEventListener?: (t: string, l: () => void) => void }

function getConnection(): ConnectionLike | undefined {
  if (typeof navigator === 'undefined') return undefined
  return (navigator as Navigator & { connection?: ConnectionLike }).connection
}

export function isSlowConnection(): boolean {
  const connection = getConnection()
  if (!connection) return false
  if (connection.saveData) return true
  return connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g'
}

export function readOnline(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine !== false
}

export function subscribeToNetwork(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  const connection = getConnection()
  connection?.addEventListener?.('change', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
    connection?.removeEventListener?.('change', onChange)
  }
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribeToNetwork, readOnline, () => true)
}

/** '다시 확인' 버튼에서 사용. 캐시를 타지 않는 작은 파일로 실제 연결을 확인한다. */
export async function probeConnectivity(timeoutMs = 4000): Promise<boolean> {
  if (typeof fetch === 'undefined') return false
  const controller = typeof AbortController === 'undefined' ? null : new AbortController()
  const timer = setTimeout(() => controller?.abort(), timeoutMs)
  try {
    const response = await fetch('/manifest.webmanifest?probe=1', {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller?.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
