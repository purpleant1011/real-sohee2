'use client'

import React, { useState, useMemo, useCallback } from 'react'
import {
  CONNECTOR_CATALOG,
  type ConnectorDefinition,
  type ConnectorHubSnapshot,
  type ConnectorId,
  type ConnectorStatus,
} from '../catalog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, type TabItem } from '@/components/ui/tabs'
import { ConnectorCardActions } from './connector-card-actions'
import { ConnectorDetailModal } from './connector-detail-modal'
import { IcsImportModal } from '../imports/ui/ics-import-modal'
import type { CalendarOccurrence } from '../imports/ics-parser'
import { getConnectorDisplayName } from './connector-display-names'
import styles from './connector-hub.module.css'

function previewOccurrencesToImportEvents(
  occurrences: readonly CalendarOccurrence[],
  defaultTimeZone = 'Asia/Seoul'
) {
  return occurrences.map((occ, idx) => {
    const title = occ.title && occ.title.trim().length > 0 ? occ.title.trim() : `일정 #${idx + 1}`
    if (occ.kind === 'timed') {
      return {
        id: occ.id,
        title,
        startsAt: occ.startsAt,
        endsAt: occ.endsAt,
        timeZone: defaultTimeZone,
      }
    }
    return {
      id: occ.id,
      title,
      startsAt: `${occ.startDate}T00:00:00.000Z`,
      endsAt: `${occ.endDateExclusive}T00:00:00.000Z`,
      startDate: occ.startDate,
      endDateExclusive: occ.endDateExclusive,
      timeZone: defaultTimeZone,
    }
  })
}

export interface ConnectorHubProps {
  snapshot: ConnectorHubSnapshot | null
  loading?: boolean
  error?: string | null
  notice?: string | null
  onRetry?: () => void
  onDisconnect?: (id: ConnectorId) => Promise<void>
  onConnect?: (connector: ConnectorDefinition) => void | Promise<void>
}

type TabType = 'available' | 'connected'

export function ConnectorHub({
  snapshot,
  loading = false,
  error = null,
  notice = null,
  onRetry,
  onDisconnect,
  onConnect,
}: ConnectorHubProps): React.ReactElement {
  const [activeTab, setActiveTab] = useState<TabType>('available')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedConnector, setSelectedConnector] = useState<ConnectorDefinition | null>(null)
  const [disconnectingId, setDisconnectingId] = useState<ConnectorId | null>(null)
  const [disconnectError, setDisconnectError] = useState<string | null>(null)
  const [prevWorkspaceId, setPrevWorkspaceId] = useState(snapshot?.workspaceId)
  const [isIcsModalOpen, setIsIcsModalOpen] = useState(false)
  const [isIcsSubmitting, setIsIcsSubmitting] = useState(false)

  const handleConnect = useCallback(
    async (connector: ConnectorDefinition) => {
      if (connector.id === 'apple_calendar') {
        setIsIcsModalOpen(true)
        return
      }
      if (onConnect) {
        await onConnect(connector)
      }
    },
    [onConnect]
  )

  const handleIcsConfirm = useCallback(
    async (selectedOccurrences: CalendarOccurrence[], sourceHash: string) => {
      if (!snapshot?.workspaceId) return
      setIsIcsSubmitting(true)
      try {
        const res = await fetch(
          `/api/workspaces/${encodeURIComponent(snapshot.workspaceId)}/marketing-connectors/apple-calendar/import`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              events: previewOccurrencesToImportEvents(selectedOccurrences, 'Asia/Seoul'),
              sourceHash,
            }),
          }
        )
        if (res.ok) {
          setIsIcsModalOpen(false)
          onRetry?.()
        } else {
          const errData = await res.json().catch(() => ({}))
          alert(errData.message || '일정을 가져오지 못했습니다.')
        }
      } catch {
        alert('일정을 가져오는 중 오류가 발생했습니다.')
      } finally {
        setIsIcsSubmitting(false)
      }
    },
    [snapshot, onRetry]
  )

  // workspace 전환 시 선택 상세 및 연결 해제 상태 소거
  if (snapshot?.workspaceId !== prevWorkspaceId) {
    setPrevWorkspaceId(snapshot?.workspaceId)
    setSelectedConnector(null)
    setDisconnectError(null)
    setDisconnectingId(null)
  }

  // 커넥터별 연결 상태 맵
  const connectionMap = useMemo(() => {
    const map = new Map<ConnectorId, { status: ConnectorStatus; lastSyncAt: string | null }>()
    if (snapshot?.connections) {
      for (const conn of snapshot.connections) {
        map.set(conn.connectorId, { status: conn.status, lastSyncAt: conn.lastSyncAt })
      }
    }
    return map
  }, [snapshot])

  // 필터링된 커넥터 목록
  const filteredConnectors = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()

    return CONNECTOR_CATALOG.filter((item) => {
      // 미지원 커넥터는 사용자 허브 목록에서 제외 (앞으로도 지원 불가한 항목 숨김)
      if (item.readiness === 'unsupported') {
        return false
      }

      // 탭 필터: connected 탭에서는 disconnected가 아닌 모든 상태(connected, reauth_required, error) 유지
      if (activeTab === 'connected') {
        const conn = connectionMap.get(item.id)
        if (!conn || conn.status === 'disconnected') {
          return false
        }
      }

      // 검색어 필터
      if (!query) return true

      const displayName = getConnectorDisplayName(item.id, item.name)
      const displayNameMatch = displayName.toLowerCase().includes(query)
      const nameMatch = item.name.toLowerCase().includes(query)
      const idMatch = item.id.toLowerCase().includes(query)
      const aliasMatch = item.aliases.some((alias) => alias.toLowerCase().includes(query))
      const purposeMatch = item.purpose.toLowerCase().includes(query)

      return displayNameMatch || nameMatch || idMatch || aliasMatch || purposeMatch
    })
  }, [activeTab, searchQuery, connectionMap])

  // 생산성 및 소셜 그룹 분리
  const productivityConnectors = useMemo(
    () => filteredConnectors.filter((c) => c.category === 'productivity'),
    [filteredConnectors]
  )
  const socialConnectors = useMemo(
    () => filteredConnectors.filter((c) => c.category === 'social'),
    [filteredConnectors]
  )

  const handleDisconnect = useCallback(
    async (id: ConnectorId) => {
      if (!onDisconnect || disconnectingId) return

      setDisconnectingId(id)
      setDisconnectError(null)
      try {
        await onDisconnect(id)
      } catch (err) {
        // stale 또는 unmounted 시 에러 무시
        if (snapshot?.workspaceId !== prevWorkspaceId) return
        const msg = err instanceof Error ? err.message : '연결을 해제하지 못했어요. 다시 시도해 주세요.'
        setDisconnectError(msg)
      } finally {
        setDisconnectingId((current) => (current === id ? null : current))
      }
    },
    [onDisconnect, disconnectingId, snapshot?.workspaceId, prevWorkspaceId]
  )

  // 상태 배지 렌더링 헬퍼 (재인증 배지는 명도 대비 WCAG 4.5:1 준수하도록 outline에 진한 텍스트 적용)
  const renderStatusBadge = useCallback(
    (item: ConnectorDefinition) => {
      const conn = connectionMap.get(item.id)
      if (conn) {
        if (conn.status === 'connected') {
          return <Badge variant="success">연결됨</Badge>
        }
        if (conn.status === 'reauth_required') {
          return (
            <Badge
              variant="outline"
              className="border-amber-600/40 text-amber-900 dark:text-amber-200 bg-amber-500/10 font-semibold"
            >
              재인증 필요
            </Badge>
          )
        }
        if (conn.status === 'error') {
          return <Badge variant="destructive">오류</Badge>
        }
      }

      switch (item.readiness) {
        case 'available':
          return <Badge variant="secondary">연동 가능</Badge>
        case 'setup_required':
          return <Badge variant="outline">설정 필요</Badge>
        case 'review_required':
          return <Badge variant="outline">준비 중</Badge>
        case 'unsupported':
          return <Badge variant="secondary">지원 불가</Badge>
        default:
          return null
      }
    },
    [connectionMap]
  )

  // 커넥터 카드 렌더링 (부모는 div로 두어 자식 인터랙션 전파 방지)
  const renderCard = useCallback(
    (item: ConnectorDefinition) => {
      const conn = connectionMap.get(item.id)
      const isConnected = conn && conn.status !== 'disconnected'
      const isAnyDisconnecting = !!disconnectingId
      const displayName = getConnectorDisplayName(item.id, item.name)

      return (
        <div key={item.id} className={`${styles.card} min-w-0 w-full overflow-hidden`}>
          <div
            role="region"
            aria-label={`${displayName} 요약`}
            className="cursor-pointer min-h-[44px] min-w-0"
            onClick={() => setSelectedConnector(item)}
          >
            <div className={styles.cardHeader}>
              <span className={`${styles.cardName} min-w-0 break-words`}>{displayName}</span>
              {renderStatusBadge(item)}
            </div>
            <p className={`${styles.cardPurpose} break-words line-clamp-2`}>{item.purpose}</p>
          </div>

          <div className={styles.cardFooter}>
            <ConnectorCardActions
              connector={item}
              connection={
                conn
                  ? {
                      connectorId: item.id,
                      status: conn.status,
                      lastSyncAt: conn.lastSyncAt,
                      capabilities: [],
                    }
                  : null
              }
              isDisconnecting={isAnyDisconnecting}
              onDisconnect={isConnected ? () => handleDisconnect(item.id) : undefined}
              onConnect={() => handleConnect(item)}
              onViewDetail={() => setSelectedConnector(item)}
            />
          </div>
        </div>
      )
    },
    [connectionMap, disconnectingId, handleDisconnect, handleConnect, renderStatusBadge]
  )

  // 탭 콘텐츠 (실제 결과 및 빈 상태를 tabpanel 안에 연계)
  const tabContent = useMemo(() => {
    if (filteredConnectors.length === 0) {
      return (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>검색 결과가 없어요</p>
          <p className={styles.emptyDescription}>
            {activeTab === 'connected'
              ? '아직 연결된 도구가 없거나 검색어와 일치하는 연결이 없습니다.'
              : '입력하신 검색어와 일치하는 도구를 찾을 수 없습니다.'}
          </p>
        </div>
      )
    }

    return (
      <div className="space-y-6 pt-2">
        {productivityConnectors.length > 0 && (
          <section className={styles.groupSection} aria-labelledby="productivity-group">
            <h2 id="productivity-group" className={styles.groupTitle}>
              업무·생산성 도구 ({productivityConnectors.length})
            </h2>
            <div className={`${styles.cardGrid} min-w-0 w-full`}>
              {productivityConnectors.map((item) => renderCard(item))}
            </div>
          </section>
        )}

        {socialConnectors.length > 0 && (
          <section className={styles.groupSection} aria-labelledby="social-group">
            <h2 id="social-group" className={styles.groupTitle}>
              소셜·메시지 채널 ({socialConnectors.length})
            </h2>
            <div className={`${styles.cardGrid} min-w-0 w-full`}>
              {socialConnectors.map((item) => renderCard(item))}
            </div>
          </section>
        )}
      </div>
    )
  }, [
    filteredConnectors.length,
    activeTab,
    productivityConnectors,
    socialConnectors,
    renderCard,
  ])

  const tabItems: TabItem[] = useMemo(() => [
    { id: 'available', label: '사용 가능', content: tabContent },
    { id: 'connected', label: '연결됨', content: tabContent },
  ], [tabContent])

  if (loading) {
    return (
      <div className={`${styles.hubContainer} w-full min-w-0 overflow-hidden`} role="status" aria-label="불러오는 중">
        <div className={styles.hubHeader}>
          <h1 className={styles.hubTitle}>업무 도구 연결</h1>
          <p className={styles.hubSubtitle}>연결할 도구와 활용할 사업 정보를 확인하세요.</p>
        </div>
        {notice && (
          <Alert variant="info">
            <AlertTitle>안내</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-4 pt-4">
          <Skeleton className="min-h-[44px] h-11 w-full max-w-xs" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`${styles.hubContainer} w-full min-w-0 overflow-hidden`}>
        <div className={styles.hubHeader}>
          <h1 className={styles.hubTitle}>업무 도구 연결</h1>
        </div>
        {notice && (
          <Alert variant="info">
            <AlertTitle>안내</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>오류가 발생했어요</p>
          <p className={styles.emptyDescription}>{error}</p>
          {onRetry && (
            <Button variant="default" size="sm" onClick={onRetry} className="mt-4 min-h-[44px]">
              다시 시도
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={`${styles.hubContainer} w-full min-w-0 overflow-hidden`}>
      <div className={styles.hubHeader}>
        <h1 className={styles.hubTitle}>업무 도구 연결</h1>
        <p className={styles.hubSubtitle}>연결할 도구와 활용할 사업 정보를 확인하세요.</p>
      </div>

      {/* 저장소 준비 미완료 경고 */}
      {snapshot && !snapshot.storageReady && (
        <Alert variant="warning">
          <AlertTitle>저장소 준비 중</AlertTitle>
          <AlertDescription>
            도구 연결 저장소 확인이 완료되지 않았습니다. 현재 설정 상태를 불러오는 중입니다.
          </AlertDescription>
        </Alert>
      )}

      {notice && (
        <Alert variant="info">
          <AlertTitle>안내</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      {disconnectError && (
        <Alert variant="destructive">
          <AlertTitle>연결 해제 오류</AlertTitle>
          <AlertDescription>{disconnectError}</AlertDescription>
        </Alert>
      )}

      {/* 검색 인풋 */}
      <div className="flex justify-end w-full">
        <div className={styles.searchWrapper}>
          <Input
            type="search"
            aria-label="도구 검색"
            placeholder="도구 검색 (예: 지메일, 캘린더, 인스타...)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full min-h-[44px] text-sm"
          />
        </div>
      </div>

      {/* 기존 Tabs 컴포넌트: role="tabpanel" 안에 실제 콘텐츠 연계 */}
      <Tabs
        value={activeTab}
        onValueChange={(val) => setActiveTab(val as TabType)}
        tabs={tabItems}
        aria-label="도구 분류"
      />

      {/* 상세 모달 */}
      {selectedConnector && (
        <ConnectorDetailModal
          connector={selectedConnector}
          connection={
            connectionMap.get(selectedConnector.id)
              ? {
                  connectorId: selectedConnector.id,
                  status: connectionMap.get(selectedConnector.id)!.status,
                  lastSyncAt: connectionMap.get(selectedConnector.id)!.lastSyncAt,
                  capabilities: [],
                }
              : null
          }
          isOpen={!!selectedConnector}
          onClose={() => setSelectedConnector(null)}
          onConnect={() => {
            const c = selectedConnector
            setSelectedConnector(null)
            void handleConnect(c)
          }}
          onDisconnect={
            connectionMap.get(selectedConnector.id)?.status === 'connected'
              ? () => handleDisconnect(selectedConnector.id)
              : undefined
          }
        />
      )}

      {/* Apple Calendar ICS 가져오기 모달 */}
      <IcsImportModal
        open={isIcsModalOpen}
        onOpenChange={(open) => setIsIcsModalOpen(open)}
        isSubmitting={isIcsSubmitting}
        onConfirm={handleIcsConfirm}
      />
    </div>
  )
}
