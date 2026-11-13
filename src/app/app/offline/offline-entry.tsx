'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { StateView } from '@/components/mobile-ui/state-view'

/** 네트워크가 없다고 확인된 상태. 브라우저가 online 이라고 해도 서버 확인 전에는 성공이라 쓰지 않는다. */
function offlineNow(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/**
 * M26 연결 상태 안내 — `/app/offline` (ANI-1664 proposed 경로 신설).
 *
 * 이 경로는 오늘 404 였다. 플래그 OFF 면 서버 페이지가 그대로 404 로 닫는다.
 * 플래그 ON 이면 폭과 무관하게 같은 안내를 보여준다 — 보존해야 할 기존 PC 레이아웃이 없는
 * 오류 안내 화면이기 때문이다(모바일 전용 정보구조가 아니다).
 *
 * 읽기 전용이다. 오프라인에서 자동 전송·예약·결제 재시도를 하지 않고, 고객 정보를 저장하지 않는다.
 * '다시 연결' 은 브라우저 연결만 확인하고 화면을 되돌릴 뿐, 서버에 아무 쓰기도 보내지 않는다.
 */
export function OfflineEntry() {
  const router = useRouter()
  const [stillOffline, setStillOffline] = useState(false)

  // 네트워크가 돌아오면 안내를 내린다. 이동은 사장님이 '다시 연결' 로 직접 한다.
  useEffect(() => {
    const onOnline = () => setStillOffline(false)
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])

  const recheck = useCallback(() => {
    if (offlineNow()) {
      setStillOffline(true)
      return
    }
    setStillOffline(false)
    if (typeof history !== 'undefined' && history.length > 1) router.back()
    else router.replace('/app')
  }, [router])

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <StateView
        kind="offline"
        description="마지막 확인 내용은 서버에서 다시 확인해야 합니다. 이 화면은 아무 내용도 저장하지 않아요."
        action={
          <div className="space-y-2">
            <Button className="min-h-11 w-full" onClick={recheck} type="button">
              다시 연결
            </Button>
            {stillOffline ? (
              <p role="status" className="text-sm text-muted-foreground">
                아직 연결되지 않았어요. 연결된 뒤에 다시 눌러 주세요.
              </p>
            ) : null}
          </div>
        }
      />
    </main>
  )
}
