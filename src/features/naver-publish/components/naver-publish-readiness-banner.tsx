'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, Download, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { detectBrowserEnvironment } from '../utils/browser-detector'

export type NaverConnectorStatus = Readonly<{
  hasConnection: boolean
  isOnline: boolean
  accountLabel: string | null
  canAutoPublish: boolean
  reauthRequired?: boolean
  lastSeenAgoSeconds?: number | null
}>

export type NaverPublishReadinessBannerProps = Readonly<{
  workspaceId: string
  targetAccount?: string | null
  compact?: boolean
  onPublishClick?: () => void
  onFastCopyClick?: () => void
}>

// 서버 기록은 현재 브라우저의 실행 가능 여부를 증명하지 않는다.
export function NaverPublishReadinessBanner(props: NaverPublishReadinessBannerProps) {
  return <NaverConnectionRecord key={props.workspaceId} {...props} />
}

function NaverConnectionRecord({
  workspaceId,
  targetAccount,
  compact = false,
  onFastCopyClick,
}: NaverPublishReadinessBannerProps) {
  const [status, setStatus] = useState<NaverConnectorStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [browserInfo] = useState(() => detectBrowserEnvironment())

  useEffect(() => {
    let active = true
    let checking = false

    async function checkRecord() {
      if (checking) return
      checking = true
      try {
        const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/naver-connector/status`, { cache: 'no-store' })
        if (!res.ok) throw new Error('status unavailable')
        const data = await res.json()
        if (typeof data?.isOnline !== 'boolean' || typeof data?.hasConnection !== 'boolean') throw new Error('invalid status')
        if (active) {
          setStatus(data)
          setError(false)
        }
      } catch {
        if (active) {
          setStatus(null)
          setError(true)
        }
      } finally {
        checking = false
        if (active) setLoading(false)
      }
    }

    void checkRecord()
    const timer = setInterval(() => void checkRecord(), 5000)
    return () => { active = false; clearInterval(timer) }
  }, [workspaceId, reloadKey])

  async function handleCopyExtensionUrl() {
    try {
      await navigator.clipboard.writeText(browserInfo.extensionUrl ?? 'chrome://extensions')
      setCopiedUrl(true)
      toast.success('확장 프로그램 관리자 주소를 복사했어요. 새 탭 주소창에 붙여넣어 주세요.')
    } catch {
      setCopiedUrl(false)
      toast.error('주소를 복사하지 못했어요. 브라우저의 확장 프로그램 설정을 직접 열어 주세요.')
    }
  }

  return (
    <section aria-label="네이버 연결 기록" className={`rounded-2xl border bg-muted/30 space-y-3 ${compact ? 'p-3.5' : 'p-4 sm:p-5'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h4 className="font-bold text-sm">네이버 블로그 연결 기록</h4>
          <p role="status" className="text-xs text-muted-foreground">
            {loading ? '서버 기록을 조회하고 있어요.' : error ? '연결 기록을 조회하지 못했어요. 다시 확인해 주세요.' : status?.hasConnection
              ? `${status.accountLabel ?? targetAccount ?? '네이버 블로그'} · ${status.isOnline ? '최근 기기 통신 기록 있음' : '최근 기기 통신 미확인'}`
              : '저장된 네이버 연결 기록이 없어요.'}
          </p>
          <p className="text-xs text-muted-foreground">현재 브라우저의 확장 프로그램·연결기·네이버 계정은 별도 확인이 필요해요. 서버 통신 기록만으로 게시 가능 여부나 로그인 만료를 알 수 없어요.</p>
        </div>
        <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={() => { setStatus(null); setLoading(true); setError(false); setReloadKey((value) => value + 1) }}>
          <RefreshCw className={`size-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />확인
        </Button>
      </div>
      {onFastCopyClick ? <div className="border-t pt-3 space-y-2">
        <p className="text-xs text-muted-foreground">내용을 복사해 네이버에서 직접 작성할 수 있어요. 사진 업로드·서식·공개 범위는 네이버에서 확인해 주세요.</p>
        <Button type="button" variant="outline" size="sm" onClick={onFastCopyClick}><Copy className="size-3.5 mr-1" />내용 복사 후 네이버 열기</Button>
      </div> : null}
      {browserInfo.os !== 'mobile' ? <div className="border-t pt-3 space-y-2">
        <p className="text-xs text-muted-foreground">{browserInfo.tipMessage} 설치와 권한 승인은 직접 진행해 주세요.</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm"><a href="/downloads/sohee-naver-connector.zip" download="sohee-naver-connector.zip"><Download className="size-3.5 mr-1" />확장프로그램 다운로드 (ZIP)</a></Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void handleCopyExtensionUrl()}>
            {copiedUrl ? <Check className="size-3.5 mr-1" /> : <Copy className="size-3.5 mr-1" />}관리자 주소 복사
          </Button>
        </div>
      </div> : null}
    </section>
  )
}
