'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useWorkspaceId } from '@/hooks/use-workspace-context'
import { ConnectorHub } from './ui/connector-hub'
import type { ConnectorDefinition, ConnectorHubSnapshot, ConnectorId } from './catalog'
import { isValidDisconnectReceipt } from './disconnect-receipt'

const DELETE_DEADLINE_MS = 15000
const DELETE_TIMEOUT = Symbol('delete-timeout')
type DeleteOutcome =
  | { kind: 'ok'; body: unknown }
  | { kind: 'http-error'; errorData: unknown }
  | { kind: 'network-reject'; error: unknown }

function isValidSnapshot(data: unknown, expectedWorkspaceId: string): data is ConnectorHubSnapshot {
  if (!data || typeof data !== 'object') return false
  const s = data as Partial<ConnectorHubSnapshot>
  if (typeof s.workspaceId !== 'string' || s.workspaceId !== expectedWorkspaceId) return false
  if (!Array.isArray(s.connections)) return false
  if (typeof s.storageReady !== 'boolean') return false
  return true
}

export function ConnectorEntry(): React.ReactElement {
  const workspaceId = useWorkspaceId()
  const [prevWorkspaceId, setPrevWorkspaceId] = useState(workspaceId)
  const [snapshot, setSnapshot] = useState<ConnectorHubSnapshot | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState<number>(0)

  // DELETE mutex & single-flight
  const isDeletingRef = useRef<boolean>(false)
  const deleteEpochRef = useRef<number>(0)
  const deleteAbortRef = useRef<AbortController | null>(null)

  // 워크스페이스 전환 시 렌더링 단계에서 이전 데이터를 즉시 제거하여 깜빡임/데이터 유출 방지
  if (workspaceId !== prevWorkspaceId) {
    setPrevWorkspaceId(workspaceId)
    setSnapshot(null)
    setError(null)
    setNotice(null)
    setLoading(true)
  }

  const workspaceIdRef = useRef(workspaceId)
  const isUnmountedRef = useRef(false)

  useEffect(() => {
    workspaceIdRef.current = workspaceId
    // 워크스페이스 전환 시에만 이전 DELETE 요청 abort 및 epoch 증가
    isDeletingRef.current = false
    deleteEpochRef.current += 1
    if (deleteAbortRef.current) {
      deleteAbortRef.current.abort()
      deleteAbortRef.current = null
    }
  }, [workspaceId])

  useEffect(() => {
    isUnmountedRef.current = false
    return () => {
      isUnmountedRef.current = true
      if (deleteAbortRef.current) {
        deleteAbortRef.current.abort()
      }
    }
  }, [])

  const abortControllerRef = useRef<AbortController | null>(null)
  const requestSeqRef = useRef<number>(0)

  const handleRetry = useCallback(() => {
    setSnapshot(null)
    setError(null)
    setLoading(true)
    setReloadKey((k) => k + 1)
  }, [])

  useEffect(() => {
    const currentSeq = ++requestSeqRef.current

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    const controller = new AbortController()
    abortControllerRef.current = controller

    async function load() {
      if (!workspaceId) {
        if (currentSeq === requestSeqRef.current) {
          setLoading(false)
          setError('워크스페이스 정보를 확인할 수 없습니다.')
        }
        return
      }

      try {
        const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/marketing-connectors`, {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`도구 연결 정보를 불러오지 못했습니다 (${response.status})`)
        }

        const data: unknown = await response.json()

        if (!isValidSnapshot(data, workspaceId)) {
          throw new Error('요청한 워크스페이스의 응답과 일치하지 않거나 응답 형식이 올바르지 않습니다.')
        }

        const snapshotData = data as ConnectorHubSnapshot

        if (currentSeq === requestSeqRef.current) {
          setSnapshot(snapshotData)

          // 삭제 안내 SSOT: snapshotData.pendingDeletions로 notice 재대사
          if (Array.isArray(snapshotData.pendingDeletions)) {
            if (snapshotData.pendingDeletions.length > 0) {
              setNotice('정보 수집을 중단했으며 자료 삭제는 확인 중입니다.')
            } else {
              // [] 명시 확인 시 임시 notice 해소
              setNotice(null)
            }
          }
          // undefined는 미확인 상태이므로 transient receipt notice 보존
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        if (currentSeq === requestSeqRef.current) {
          const message = err instanceof Error ? err.message : '도구 연결 정보를 불러오는 중 오류가 발생했습니다.'
          setError(message)
        }
      } finally {
        if (currentSeq === requestSeqRef.current) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [workspaceId, reloadKey])

  const handleDisconnect = useCallback(
    async (connectorId: ConnectorId) => {
      // 1. 같은 워크스페이스 내 single-flight: 진행 중인 DELETE가 있으면 거부
      if (!workspaceId || isDeletingRef.current) return
      isDeletingRef.current = true

      const targetWorkspaceId = workspaceId
      const currentOpEpoch = ++deleteEpochRef.current

      // 새 DELETE는 진행 중인 DELETE를 abort하지 않음 (workspace 전환/unmount 시에만 abort)
      const controller = new AbortController()
      deleteAbortRef.current = controller

      const isCurrent = () => {
        return (
          !isUnmountedRef.current &&
          currentOpEpoch === deleteEpochRef.current &&
          targetWorkspaceId === workspaceIdRef.current
        )
      }

      // fetch + body JSON 전체에 걸린 deadline. signal을 무시하는 fetch/json도 race로 종료한다.
      let timer: ReturnType<typeof setTimeout> | undefined
      let timedOut = false
      const timeoutPromise = new Promise<typeof DELETE_TIMEOUT>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true
          resolve(DELETE_TIMEOUT)
          controller.abort() // timeout abort (workspace/unmount abort와 구분: timedOut 플래그)
        }, DELETE_DEADLINE_MS)
      })

      const requestPromise = (async (): Promise<DeleteOutcome> => {
        try {
          const response = await fetch(`/api/workspaces/${encodeURIComponent(targetWorkspaceId)}/marketing-connectors`, {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ connectorId }),
            signal: controller.signal,
          })
          if (!response.ok) {
            const errorData = await response.json().catch(() => null)
            return { kind: 'http-error', errorData }
          }
          const body: unknown = await response.json().catch(() => null)
          return { kind: 'ok', body }
        } catch (fetchError) {
          return { kind: 'network-reject', error: fetchError }
        }
      })()
      // race에서 진 요청의 늦은 reject가 unhandled rejection이 되지 않도록 흡수
      requestPromise.catch(() => undefined)

      try {
        const outcome = await Promise.race([requestPromise, timeoutPromise])

        const handleIndeterminateFailure = (errorMessage: string): never => {
          if (isCurrent()) {
            // 서버 commit 후 응답 유실 가능: 모든 현재 epoch 비확정 failure는 snapshot 숨김 + 결과불명 한국어 global error + GET retry
            setSnapshot(null)
            setLoading(false)
            setError(errorMessage)
            void fetch(`/api/workspaces/${encodeURIComponent(targetWorkspaceId)}/marketing-connectors`, {
              signal: controller.signal,
            }).catch(() => undefined)
          }
          throw new Error(errorMessage)
        }

        if (outcome === DELETE_TIMEOUT) {
          return handleIndeterminateFailure('연결 해제 요청 결과를 확인하지 못했습니다. 최신 상태를 다시 확인해 주세요.')
        }

        // 네트워크 응답 직후 검증: stale이면 throw하지 않고 즉시 조용히 종료
        if (!isCurrent()) {
          return
        }

        if (outcome.kind === 'network-reject') {
          if (!timedOut && outcome.error instanceof DOMException && outcome.error.name === 'AbortError') {
            return
          }
          return handleIndeterminateFailure('연결 해제 요청 결과를 확인하지 못했습니다. 최신 상태를 다시 확인해 주세요.')
        }

        if (outcome.kind === 'http-error') {
          const errorData = outcome.errorData as { message?: string; error?: unknown } | null
          const msg =
            errorData?.message ||
            (typeof errorData?.error === 'string' && !errorData.error.includes('_')
              ? errorData.error
              : '연결 해제 요청을 처리하지 못했습니다.')
          throw new Error(msg)
        }

        const r = outcome.body
        if (!isValidDisconnectReceipt(r, connectorId)) {
          return handleIndeterminateFailure('연결 해제 응답 영수증이 올바르지 않아 현재 상태를 확정할 수 없습니다. 다시 시도하여 최신 상태를 확인해 주세요.')
        }

        // transient receipt notice: refetch 로딩/에러 중 보존
        if (r.pendingDeletion) {
          setNotice('정보 수집을 중단했으며 자료 삭제는 확인 중입니다.')
        }

        // 성공 후 최신 스냅샷 재조회
        handleRetry()
      } catch (err) {
        if (!timedOut && err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        // stale이면 Hub의 catch로 에러를 전파하지 않고 조용히 종료
        if (!isCurrent()) {
          return
        }
        throw err
      } finally {
        if (timer !== undefined) clearTimeout(timer)
        if (currentOpEpoch === deleteEpochRef.current) {
          isDeletingRef.current = false
        }
      }
    },
    [workspaceId, handleRetry]
  )

  const handleConnect = useCallback(
    async (connector: ConnectorDefinition) => {
      if (!workspaceId) return
      if (connector.category === 'social') {
        window.location.href = connector.managementHref ?? '/app/channels'
        return
      }
      if (connector.id === 'google_calendar') {
        try {
          const res = await fetch(
            `/api/workspaces/${encodeURIComponent(workspaceId)}/marketing-connectors/google/authorize`,
            { method: 'POST' }
          )
          const data = (await res.json()) as { authorizeUrl?: string; message?: string; error?: string }
          if (data.authorizeUrl) {
            window.location.href = data.authorizeUrl
          } else {
            const msg = data.error === 'SERVER_MISCONFIGURED'
              ? '구글 계정 연결 설정이 필요합니다. 관리자 설정을 먼저 완료해 주세요.'
              : data.message || '구글 연결 주소를 불러오지 못했습니다.'
            alert(msg)
          }
        } catch {
          alert('구글 연결을 시작하는 중 오류가 발생했습니다.')
        }
        return
      }
      if (connector.id === 'outlook_mail') {
        try {
          const res = await fetch(
            `/api/workspaces/${encodeURIComponent(workspaceId)}/marketing-connectors/microsoft/authorize`,
            { method: 'POST' }
          )
          const data = (await res.json()) as { authorizeUrl?: string; message?: string; error?: string }
          if (data.authorizeUrl) {
            window.location.href = data.authorizeUrl
          } else {
            const msg = data.error === 'SERVER_MISCONFIGURED'
              ? '마이크로소프트 계정 연결 설정이 필요합니다. 관리자 설정을 먼저 완료해 주세요.'
              : data.message || '마이크로소프트 연결 주소를 불러오지 못했습니다.'
            alert(msg)
          }
        } catch {
          alert('마이크로소프트 연결을 시작하는 중 오류가 발생했습니다.')
        }
        return
      }
      if (connector.id === 'google_sheets') {
        alert('구글 스프레드시트 연결을 위해서는 구글 계정 연결 및 관리자 설정이 필요합니다.')
        return
      }
    },
    [workspaceId]
  )

  return (
    <ConnectorHub
      key={workspaceId}
      snapshot={snapshot}
      loading={loading}
      error={error}
      notice={notice}
      onRetry={handleRetry}
      onDisconnect={handleDisconnect}
      onConnect={handleConnect}
    />
  )
}
