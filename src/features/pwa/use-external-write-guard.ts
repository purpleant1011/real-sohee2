'use client'

import { useMemo } from 'react'
import { createExternalWriteRunner, getPageActionGuard, type ExternalWriteRunner } from './external-write'
import { probeConnectivity, readOnline } from './network'

/**
 * 실제 외부 쓰기 버튼에서 쓰는 훅 (ANI-1778).
 *
 * 클릭 시점에 연결 상태를 다시 읽고, 힌트가 온라인이어도 실제 연결 확인(probe)을 통과해야
 * 작업을 시작한다 — 캡티브 포털이나 끊긴 업링크에서 `navigator.onLine` 이 true 인 경우를 막는다.
 * 같은 행위가 이미 진행 중이면 아무 것도 하지 않고, 실패한 작업을 큐에 쌓지도 않는다.
 */
export function useExternalWriteGuard(): ExternalWriteRunner {
  return useMemo(
    () =>
      createExternalWriteRunner({
        guard: getPageActionGuard(),
        isOnlineHint: readOnline,
        probe: probeConnectivity,
      }),
    [],
  )
}
