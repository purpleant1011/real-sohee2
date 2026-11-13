'use client'

import React from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { ConnectorDefinition, ConnectorConnectionSummary } from '../catalog'
import { getConnectorDisplayName } from './connector-display-names'

export interface ConnectorCardActionsProps {
  connector: ConnectorDefinition
  connection?: ConnectorConnectionSummary | null
  onViewDetail?: () => void
  onConnect?: () => void
  onDisconnect?: () => void
  onManage?: () => void
  isDisconnecting?: boolean
  className?: string
}

export function ConnectorCardActions({
  connector,
  connection,
  onViewDetail,
  onConnect,
  onDisconnect,
  onManage,
  isDisconnecting = false,
  className = '',
}: ConnectorCardActionsProps): React.ReactElement {
  const isConnected = connection?.status === 'connected'
  const displayName = getConnectorDisplayName(connector.id, connector.name)

  if (isConnected) {
    return (
      <div className={`flex items-center justify-between gap-2 w-full ${className}`}>
        <div className="flex items-center gap-1.5">
          <Badge variant="success">연결됨</Badge>
        </div>

        <div className="flex items-center gap-1.5">
          {connector.category === 'social' && connector.managementHref ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={connector.managementHref}>채널 관리</Link>
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={onManage ?? onViewDetail}
              aria-label={`${displayName} 관리`}
            >
              관리
            </Button>
          )}

          {connector.category !== 'social' && onDisconnect && (
            <Button
              variant="ghost"
              size="sm"
              disabled={isDisconnecting}
              onClick={onDisconnect}
              aria-label={isDisconnecting ? `${displayName} 해제 중` : `${displayName} 연결 해제`}
              className="text-xs text-muted-foreground hover:text-destructive h-8 px-2"
            >
              {isDisconnecting ? '해제 중...' : '연결 해제'}
            </Button>
          )}

          {onViewDetail && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onViewDetail}
              aria-label={`${displayName} 상세 정보 보기`}
              className="text-xs text-muted-foreground hover:text-foreground h-8 px-2"
            >
              상세보기
            </Button>
          )}
        </div>
      </div>
    )
  }

  // 미연결 상태 분기
  const renderReadinessAction = () => {
    switch (connector.readiness) {
      case 'setup_required':
        return (
          <Button
            variant="default"
            size="sm"
            onClick={onConnect}
            aria-label={`${displayName} 연결하기`}
          >
            연결하기
          </Button>
        )
      case 'review_required':
        return (
          <Button
            variant="outline"
            size="sm"
            disabled
            aria-label={`${displayName} 심사중`}
          >
            심사중
          </Button>
        )
      case 'available':
        if (connector.category === 'social' && connector.managementHref) {
          return (
            <Button variant="outline" size="sm" asChild>
              <Link href={connector.managementHref}>채널 관리</Link>
            </Button>
          )
        }
        return (
          <Button
            variant="default"
            size="sm"
            onClick={onConnect ?? onViewDetail}
            aria-label={`${displayName} 연결하기`}
          >
            연결하기
          </Button>
        )
      case 'unsupported':
      default:
        return (
          <Button
            variant="secondary"
            size="sm"
            disabled
            aria-label={`${displayName} 미지원`}
          >
            미지원
          </Button>
        )
    }
  }

  return (
    <div className={`flex items-center justify-between gap-2 w-full ${className}`}>
      <div className="flex items-center gap-1.5">
        {renderReadinessAction()}
      </div>

      <div className="flex items-center gap-1.5">
        {onViewDetail && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onViewDetail}
            aria-label={`${displayName} 상세 정보 보기`}
            className="text-xs text-muted-foreground hover:text-foreground h-8 px-2"
          >
            상세보기
          </Button>
        )}
      </div>
    </div>
  )
}
