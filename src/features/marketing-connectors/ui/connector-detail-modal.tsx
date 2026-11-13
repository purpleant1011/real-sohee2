'use client'

import React from 'react'
import Link from 'next/link'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import type { ConnectorDefinition, ConnectorConnectionSummary } from '../catalog'
import { getConnectorDisplayName } from './connector-display-names'

export interface ConnectorDetailModalProps {
  connector: ConnectorDefinition
  connection?: ConnectorConnectionSummary | null
  isOpen: boolean
  onClose: () => void
  onConnect?: () => void
  onDisconnect?: () => void
}

const METHOD_LABEL: Record<string, string> = {
  oauth: '공식 계정 연결',
  existing: '기존 채널 연결',
  import: '일정 파일 가져오기',
  unavailable: '연결 불가',
}

export function ConnectorDetailModal({
  connector,
  connection,
  isOpen,
  onClose,
  onConnect,
  onDisconnect,
}: ConnectorDetailModalProps): React.ReactElement | null {
  const isConnected = connection?.status === 'connected'
  const isClosingRef = React.useRef(false)

  React.useEffect(() => {
    if (isOpen) {
      isClosingRef.current = false
    }
  }, [isOpen])

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      if (!isClosingRef.current) {
        isClosingRef.current = true
        onClose()
      }
    }
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={handleOpenChange}
      title={getConnectorDisplayName(connector.id, connector.name)}
    >
      <div className="space-y-5 text-sm max-w-full">
        {/* 상태 배지 영역 */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-border/60">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {connector.category === 'productivity' ? '생산성·업무 도구' : '소셜·메시지 채널'}
            </span>
            <span className="text-xs text-muted-foreground/60">•</span>
            <span className="text-xs text-muted-foreground">
              {METHOD_LABEL[connector.method] ?? connector.method}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {isConnected ? (
              <Badge variant="success">연결됨</Badge>
            ) : connector.readiness === 'review_required' ? (
              <Badge
                variant="outline"
                className="border-amber-600/40 text-amber-900 dark:text-amber-200 bg-amber-500/10 font-medium"
              >
                현재 공급자 보안 심사 진행 중입니다
              </Badge>
            ) : connector.readiness === 'setup_required' ? (
              <Badge variant="outline">설정 필요</Badge>
            ) : connector.readiness === 'available' ? (
              <Badge variant="secondary">연동 가능</Badge>
            ) : (
              <Badge variant="secondary">지원 불가</Badge>
            )}
          </div>
        </div>

        {/* 목적 안내 */}
        <div className="space-y-1.5 rounded-lg bg-muted/40 p-3.5 border border-border/40">
          <h3 className="text-xs font-semibold text-foreground">활용 목적</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {connector.purpose}
          </p>
          <p className="text-xs font-medium text-primary/90 pt-1">
            주요 목적: 홍보 제안 및 예약 최적화
          </p>
        </div>

        {/* 수집 및 제외 범위 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5 rounded-lg border border-border/50 p-3 bg-background">
            <h4 className="text-xs font-semibold text-foreground flex items-center gap-1">
              <span>동의 후 읽을 정보</span>
            </h4>
            {connector.reads.length > 0 ? (
              <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1 pl-1">
                {connector.reads.map((item, idx) => (
                  <li key={idx} className="leading-snug">{item}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">읽는 정보가 없습니다.</p>
            )}
          </div>

          <div className="space-y-1.5 rounded-lg border border-border/50 p-3 bg-background">
            <h4 className="text-xs font-semibold text-foreground flex items-center gap-1">
              <span>읽지 않는 정보</span>
            </h4>
            {connector.excludes.length > 0 ? (
              <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1 pl-1">
                {connector.excludes.map((item, idx) => (
                  <li key={idx} className="leading-snug">{item}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">제외 정책이 설정되지 않았습니다.</p>
            )}
          </div>
        </div>

        {/* AI 처리 고지 및 데이터 보존 정책 */}
        <div className="space-y-2 rounded-lg border border-border/40 bg-muted/20 p-3 text-xs text-muted-foreground">
          <div className="space-y-0.5">
            <span className="font-semibold text-foreground block">AI 처리 고지</span>
            <p className="leading-relaxed">
              수집된 데이터는 AI(소희)의 맞춤형 마케팅 제안 및 예약 최적화 분석에만 안전하게 활용되며, AI 모델의 자체 학습용 데이터로 사용되지 않습니다.
            </p>
          </div>

          <div className="space-y-0.5 pt-1 border-t border-border/30">
            <span className="font-semibold text-foreground block">데이터 보존 기간</span>
            <p className="leading-relaxed">
              연결 유지 기간 동안 최대 30일간 암호화 보존 후 자동 파기되며, 연결 해제 시 즉시 영구 삭제됩니다.
            </p>
          </div>
        </div>

        {/* 연결 상태 정보 (연결되어 있을 때) */}
        {isConnected && (
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span>최근 동기화: {connection?.lastSyncAt ?? '미수집'}</span>
          </div>
        )}

        {/* 공급자 상태별 동작 CTA */}
        <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 border-t border-border/60">
          {isConnected ? (
            <>
              {connector.category === 'social' && connector.managementHref ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={connector.managementHref}>채널 관리 페이지</Link>
                </Button>
              ) : null}
              {onDisconnect && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onDisconnect}
                  className="text-destructive hover:bg-destructive/10 border-destructive/30"
                >
                  연결 해제
                </Button>
              )}
            </>
          ) : connector.readiness === 'setup_required' ? (
            <Button
              variant="default"
              size="sm"
              onClick={onConnect}
              className="w-full sm:w-auto"
            >
              연결 시작
            </Button>
          ) : connector.readiness === 'available' ? (
            <Button variant="default" size="sm" asChild className="w-full sm:w-auto">
              <Link href={connector.managementHref ?? '/app/channels'}>
                채널 관리 페이지 이동
              </Link>
            </Button>
          ) : connector.readiness === 'review_required' ? (
            <div className="w-full space-y-2">
              <Alert variant="warning" className="text-xs py-2">
                <AlertTitle className="text-xs font-semibold">보안 심사 진행 중</AlertTitle>
                <AlertDescription className="text-xs">
                  공급자 보안 심사가 완료되면 공식 연결이 활성화됩니다.
                </AlertDescription>
              </Alert>
              <Button variant="outline" size="sm" disabled className="w-full">
                현재 연결 불가 (심사 진행 중)
              </Button>
            </div>
          ) : (
            <div className="w-full">
              <Alert variant="info" className="text-xs py-2">
                <AlertTitle className="text-xs font-semibold">미지원 안내</AlertTitle>
                <AlertDescription className="text-xs">
                  공식 지원 미제공으로 연결이 불가능합니다.
                </AlertDescription>
              </Alert>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  )
}
