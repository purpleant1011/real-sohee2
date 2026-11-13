const PHONE_UA = /iPhone|iPod|Android.*Mobile/i

export interface HostPresentation { forceMobile: boolean; forcePc: boolean; initialMobile: boolean }

/**
 * 접속 호스트·기기로 표현(모바일/PC)을 정한다. 백엔드·권한·데이터는 같고 표현만 다르다.
 * - m.example.com: 항상 모바일 UI
 * - example.com / www: 데스크톱 브라우저는 PC UI, 실제 휴대폰은 모바일 UI
 */
export function resolveHostPresentation(rawHost: string | null | undefined, userAgent: string | null | undefined): HostPresentation {
  const host = (rawHost ?? '').toLowerCase().replace(/:\d+$/, '')
  const phone = PHONE_UA.test(userAgent ?? '')
  const mobileHost = host === 'm.example.com'
  const pcHost = host === 'example.com' || host === 'www.example.com'
  const forceMobile = mobileHost || (pcHost && phone)
  const forcePc = pcHost && !phone
  return { forceMobile, forcePc, initialMobile: forceMobile || (!forcePc && phone) }
}
