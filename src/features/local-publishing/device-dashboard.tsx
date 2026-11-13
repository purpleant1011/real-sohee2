'use client'

import { useActionState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Laptop, KeyRound } from 'lucide-react'

import { createPairingCodeAction, type PairingCodeState } from './actions/create-pairing-code'
import { revokeDeviceAction } from './actions/revoke-device'
import type { BrowserConnectionView, ConnectorDeviceView } from './device-dashboard-repository'

const initialPairingState: PairingCodeState = Object.freeze({ code: null, expiresAt: null, error: null })

const statusCopy = {
  connected: '연결됨',
  reauth_required: '로그인 필요',
  target_mismatch: '다른 계정 확인 필요',
  unavailable: '기기 오프라인',
  revoked: '연결 해제됨',
} as const

export function DeviceDashboard({
  devices,
  connections,
  manualPairingCollapsed = false,
}: Readonly<{
  devices: readonly ConnectorDeviceView[]
  connections: readonly BrowserConnectionView[]
  manualPairingCollapsed?: boolean
}>) {
  const [pairing, createPairing, pairingPending] = useActionState(createPairingCodeAction, initialPairingState)
  const primary = devices.find((device) => device.status === 'active') ?? devices[0] ?? null
  const olderCount = primary ? devices.filter((device) => device.id !== primary.id).length : 0

  return (
    <Card className="max-w-4xl border border-zinc-200/80 dark:border-zinc-800 shadow-xs">
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Laptop className="size-5 text-primary" aria-hidden />
            PC 브라우저 연결 관리
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            {primary ? '기기 연결됨' : '연결된 기기 없음'}
          </Badge>
        </div>
        <CardDescription>
          네이버와 당근 로그인은 PC 브라우저에서 직접 진행해요. 비밀번호와 개인 로그인 정보는 소희에 저장하지 않아요.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {manualPairingCollapsed ? (
          <details className="rounded-xl border border-zinc-200/70 dark:border-zinc-800 p-3 text-xs">
            <summary className="font-semibold cursor-pointer text-muted-foreground hover:text-foreground">
              직접 연결 코드 사용
            </summary>
            <div className="pt-3">
              <ManualPairingControls pairing={pairing} pairingPending={pairingPending} createPairing={createPairing} />
            </div>
          </details>
        ) : (
          <ManualPairingControls pairing={pairing} pairingPending={pairingPending} createPairing={createPairing} />
        )}

        {!primary ? (
          <p className="text-sm text-muted-foreground py-2">아직 연결된 PC 브라우저 기기가 없어요.</p>
        ) : (
          <div className="space-y-3 pt-2">
            {olderCount > 0 ? (
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">현재 게시 기기</h3>
            ) : null}
            <ul className="space-y-2">
              <DeviceItem connections={connections} device={primary} />
            </ul>
            {olderCount > 0 ? (
              <details className="rounded-xl border border-zinc-200/70 dark:border-zinc-800 p-3 text-xs">
                <summary className="font-semibold cursor-pointer text-muted-foreground hover:text-foreground">
                  이전 연결 {olderCount}개 보기
                </summary>
                <p className="pt-2 text-muted-foreground">현재 게시에는 가장 최근에 통신한 활성 기기를 사용해요.</p>
              </details>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function DeviceItem({ device, connections }: Readonly<{
  device: ConnectorDeviceView
  connections: readonly BrowserConnectionView[]
}>) {
  const linked = connections.filter((connection) => connection.deviceId === device.id)
  return (
    <li className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
      <div className="space-y-1">
        <h3 className="font-bold text-sm text-foreground">{device.displayName}</h3>
        <p className="text-muted-foreground">{device.platform === 'macos' ? 'macOS' : 'Windows'} · 연결 도구 {device.clientVersion}</p>
        {linked.length === 0 ? (
          <p className="text-muted-foreground">게시 채널 확인 필요</p>
        ) : (
          <ul className="space-y-1 pt-1">
            {linked.map((connection) => (
              <li key={connection.id} className="flex items-center gap-1.5 text-xs">
                <a href={connection.targetUrl} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                  {connection.accountLabel}
                </a>
                <span className="text-muted-foreground"> · {connection.channel === 'naver_blog' ? '네이버 블로그' : '당근 비즈프로필'} · </span>
                <span className="font-semibold text-foreground">{statusCopy[connection.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {device.status !== 'revoked' ? (
        <form action={revokeDeviceAction}>
          <input type="hidden" name="deviceId" value={device.id} />
          <Button type="submit" variant="outline" size="sm" className="min-h-10 text-xs text-destructive hover:bg-destructive/10">
            기기 연결 해제
          </Button>
        </form>
      ) : (
        <Badge variant="secondary">연결 해제됨</Badge>
      )}
    </li>
  )
}

function ManualPairingControls({ pairing, pairingPending, createPairing }: Readonly<{
  pairing: PairingCodeState
  pairingPending: boolean
  createPairing: (payload: FormData) => void
}>) {
  return (
    <div className="space-y-2.5">
      <form action={createPairing} className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pairingPending} size="sm" className="min-h-11 text-xs font-semibold gap-1.5">
          <KeyRound className="size-3.5" aria-hidden />
          {pairingPending ? '연결 코드 만드는 중' : '브라우저 연결 코드 만들기'}
        </Button>
        <span className="text-xs text-muted-foreground">연결 코드는 한 번만 사용할 수 있고 10분 뒤 만료돼요.</span>
      </form>
      {pairing.code ? (
        <div role="status" className="p-3.5 rounded-xl bg-primary/5 border border-primary/20 space-y-1">
          <p className="text-xs font-medium text-foreground">브라우저 확장 도구에 다음 코드를 입력해 주세요.</p>
          <output className="block text-xl font-mono font-bold text-primary tracking-widest">{pairing.code}</output>
          <p className="text-[11px] text-muted-foreground">{pairing.expiresAt ? `${new Date(pairing.expiresAt).toLocaleString('ko-KR')}까지 유효` : null}</p>
        </div>
      ) : null}
      {pairing.error ? <p role="alert" className="text-xs text-destructive">{pairing.error}</p> : null}
    </div>
  )
}
