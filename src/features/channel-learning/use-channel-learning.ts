'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Capability,
  LearningCandidate,
  LearningPlatform,
  LearningSource,
  ReviewDecisionItem,
} from './contracts'

export interface UseChannelLearningOptions {
  workspaceId: string
  canManage: boolean
  onKnowledgeUpdated?: () => void
  fetcher?: typeof fetch
}

export interface AddSourceInput {
  platform: LearningPlatform
  url: string
  consent: {
    text: boolean
    images: boolean
  }
}

export interface VerifySourceInput {
  sourceId: string
  revision: number
  challengeId?: string
}

export interface StartCollectionInput {
  sourceId: string
  revision: number
}

export interface CancelSourceInput {
  sourceId: string
  revision: number
}

export interface DeleteSourceInput {
  sourceId: string
  revision: number
}

export interface ReviewCandidatesInput {
  sourceId: string
  revision: number
  evidenceRevision: number
  decisions: ReviewDecisionItem[]
}

export interface SourceDetailResult {
  source: LearningSource
  candidates: LearningCandidate[]
  jobs: unknown[]
}

function extractErrorCodeAndMessage(body: any): { rawMessage?: string; rawCode?: string } {
  if (!body) return {}
  let rawCode: string | undefined
  let rawMessage: string | undefined

  if (typeof body.error === 'object' && body.error !== null) {
    rawCode = body.error.code
    rawMessage = body.error.message
  } else if (typeof body.error === 'string') {
    rawCode = body.error
  }

  if (!rawCode && body.code) rawCode = body.code
  if (!rawMessage && body.message) rawMessage = body.message

  return { rawMessage, rawCode }
}

function sanitizeErrorMessage(
  status: number,
  rawMessage?: string,
  rawCode?: string,
): { message: string; code?: string } {
  if (
    rawCode === 'CONNECTION_REQUIRED' ||
    rawMessage?.includes('연결이 필요') ||
    rawMessage?.includes('계정 연결') ||
    rawMessage?.includes('OAuth')
  ) {
    return {
      message: '채널 연결이 필요해요. 채널 연결 관리에서 계정을 먼저 연결해 주세요.',
      code: 'CONNECTION_REQUIRED',
    }
  }
  if (rawCode === 'CAPABILITY_BLOCKED') {
    return {
      message: '이 채널은 현재 공식 연동이 지원되지 않아 자동 수집이 차단되어 있습니다.',
      code: 'CAPABILITY_BLOCKED',
    }
  }
  if (rawCode === 'STALE_REVISION') {
    return {
      message: '지식 정보가 변경되어 최신 상태가 아닙니다. 목록을 새로고침한 뒤 다시 시도해 주세요.',
      code: 'STALE_REVISION',
    }
  }
  if (status === 409) {
    return {
      message: '지식 정보가 변경되어 최신 상태가 아닙니다. 목록을 새로고침한 뒤 다시 시도해 주세요.',
      code: rawCode ?? 'STALE_REVISION',
    }
  }
  if (status === 403) {
    return { message: '채널 정보를 변경할 권한이 없습니다.', code: 'FORBIDDEN' }
  }
  if (status === 404) {
    return { message: '요청한 채널 출처를 찾을 수 없습니다.', code: 'NOT_FOUND' }
  }
  if (
    rawMessage &&
    !rawMessage.includes('FB_') &&
    !rawMessage.includes('META_') &&
    !rawMessage.includes('token') &&
    !rawMessage.includes('secret')
  ) {
    // If it's already a safe user-facing Korean message, we can pass it through
    if (/^[가-힣0-9\s.,!?·()~%]+$/.test(rawMessage)) {
      return { message: rawMessage, code: rawCode }
    }
  }
  return { message: '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.', code: rawCode }
}

export function useChannelLearning({
  workspaceId,
  canManage,
  onKnowledgeUpdated,
  fetcher,
}: UseChannelLearningOptions) {
  const [sources, setSources] = useState<LearningSource[]>([])
  const [capabilities, setCapabilities] = useState<Capability[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  const transport = fetcher ?? fetch

  // Track active fetch abort controller for current workspace
  const abortControllerRef = useRef<AbortController | null>(null)
  const currentWorkspaceRef = useRef<string>(workspaceId)
  const pollCountRef = useRef<number>(0)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 워크스페이스 변경 시 즉시 기존 상태 clear (stale 잔류 방지)
  useEffect(() => {
    currentWorkspaceRef.current = workspaceId
    setSources([])
    setCapabilities([])
    setError(null)
    setErrorCode(null)
    pollCountRef.current = 0
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
    }
  }, [workspaceId])

  const loadSources = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller

    setIsLoading(true)
    setError(null)
    setErrorCode(null)

    try {
      const res = await transport(`/api/workspaces/${workspaceId}/knowledge/channels`, {
        signal: controller.signal,
        headers: {
          'Cache-Control': 'no-store',
        },
      })

      if (!res.ok) {
        if (currentWorkspaceRef.current === workspaceId) {
          const body = await res.json().catch(() => ({}))
          const { rawMessage, rawCode } = extractErrorCodeAndMessage(body)
          const sanitized = sanitizeErrorMessage(res.status, rawMessage, rawCode)
          setError(sanitized.message)
          setErrorCode(sanitized.code ?? null)
        }
        return
      }

      const data = await res.json()
      if (currentWorkspaceRef.current === workspaceId) {
        setSources(Array.isArray(data.sources) ? data.sources : [])
        setCapabilities(Array.isArray(data.capabilities) ? data.capabilities : [])
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return
      }
      if (currentWorkspaceRef.current === workspaceId) {
        setError('채널 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
        setErrorCode(null)
      }
    } finally {
      if (currentWorkspaceRef.current === workspaceId) {
        setIsLoading(false)
      }
    }
  }, [workspaceId, transport])

  useEffect(() => {
    void loadSources()
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current)
      }
    }
  }, [loadSources])

  // Active Job Bounded Polling (queued, collecting, extracting)
  useEffect(() => {
    const hasActiveJob = sources.some(
      (s) =>
        s.collection === 'queued' ||
        s.collection === 'collecting' ||
        s.collection === 'extracting',
    )

    if (!hasActiveJob) {
      pollCountRef.current = 0
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current)
      }
      return
    }

    // 오프라인 상태이면 자동 폴링 중단
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return
    }

    // 최대 20회(약 60초) bounded poll
    if (pollCountRef.current >= 20) {
      return
    }

    pollTimerRef.current = setTimeout(() => {
      if (currentWorkspaceRef.current === workspaceId) {
        pollCountRef.current += 1
        void loadSources()
      }
    }, 3000)

    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current)
      }
    }
  }, [sources, loadSources, workspaceId])

  const addSource = useCallback(
    async (input: AddSourceInput) => {
      const targetWorkspace = workspaceId
      if (!canManage) {
        const msg = '채널 정보를 변경할 권한이 없습니다.'
        setError(msg)
        setErrorCode('FORBIDDEN')
        return { success: false, error: msg, code: 'FORBIDDEN' }
      }

      setError(null)
      setErrorCode(null)
      try {
        const res = await transport(`/api/workspaces/${workspaceId}/knowledge/channels`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          },
          body: JSON.stringify(input),
        })

        if (currentWorkspaceRef.current !== targetWorkspace) {
          return { success: false, error: '작업공간이 전환되었습니다.' }
        }

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          const { rawMessage, rawCode } = extractErrorCodeAndMessage(body)
          const sanitized = sanitizeErrorMessage(res.status, rawMessage, rawCode)
          setError(sanitized.message)
          setErrorCode(sanitized.code ?? null)
          return { success: false, error: sanitized.message, code: sanitized.code }
        }

        const data = await res.json()
        await loadSources()
        if (currentWorkspaceRef.current === targetWorkspace) {
          onKnowledgeUpdated?.()
        }
        return { success: true, source: data.source }
      } catch {
        if (currentWorkspaceRef.current !== targetWorkspace) return { success: false }
        const errorMsg = '채널 주소를 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.'
        setError(errorMsg)
        setErrorCode(null)
        return { success: false, error: errorMsg }
      }
    },
    [canManage, workspaceId, loadSources, onKnowledgeUpdated, transport],
  )

  const verifySource = useCallback(
    async ({ sourceId, revision, challengeId }: VerifySourceInput) => {
      const targetWorkspace = workspaceId
      if (!canManage) {
        const msg = '채널 정보를 변경할 권한이 없습니다.'
        setError(msg)
        setErrorCode('FORBIDDEN')
        return { success: false, error: msg, code: 'FORBIDDEN' }
      }

      setError(null)
      setErrorCode(null)
      try {
        const res = await transport(
          `/api/workspaces/${workspaceId}/knowledge/channels/${sourceId}/verify`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
            },
            body: JSON.stringify({ revision, challengeId }),
          },
        )

        if (currentWorkspaceRef.current !== targetWorkspace) {
          return { success: false, error: '작업공간이 전환되었습니다.' }
        }

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          const { rawMessage, rawCode } = extractErrorCodeAndMessage(body)
          const sanitized = sanitizeErrorMessage(res.status, rawMessage, rawCode)
          setError(sanitized.message)
          setErrorCode(sanitized.code ?? null)
          return { success: false, error: sanitized.message, code: sanitized.code }
        }

        const data = await res.json()
        await loadSources()
        if (currentWorkspaceRef.current === targetWorkspace) {
          onKnowledgeUpdated?.()
        }
        return { success: true, challenge: data.challenge }
      } catch {
        if (currentWorkspaceRef.current !== targetWorkspace) return { success: false }
        const errorMsg = '본인 채널 확인을 진행하지 못했습니다. 잠시 후 다시 시도해 주세요.'
        setError(errorMsg)
        setErrorCode(null)
        return { success: false, error: errorMsg }
      }
    },
    [canManage, workspaceId, loadSources, onKnowledgeUpdated, transport],
  )

  const startCollection = useCallback(
    async ({ sourceId, revision }: StartCollectionInput) => {
      const targetWorkspace = workspaceId
      if (!canManage) {
        const msg = '채널 정보를 변경할 권한이 없습니다.'
        setError(msg)
        setErrorCode('FORBIDDEN')
        return { success: false, error: msg, code: 'FORBIDDEN' }
      }

      setError(null)
      setErrorCode(null)
      try {
        const res = await transport(
          `/api/workspaces/${workspaceId}/knowledge/channels/${sourceId}/collect`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
            },
            body: JSON.stringify({ revision }),
          },
        )

        if (currentWorkspaceRef.current !== targetWorkspace) {
          return { success: false, error: '작업공간이 전환되었습니다.' }
        }

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          const { rawMessage, rawCode } = extractErrorCodeAndMessage(body)
          const sanitized = sanitizeErrorMessage(res.status, rawMessage, rawCode)
          setError(sanitized.message)
          setErrorCode(sanitized.code ?? null)
          return { success: false, error: sanitized.message, code: sanitized.code }
        }

        const data = await res.json()
        await loadSources()
        if (currentWorkspaceRef.current === targetWorkspace) {
          onKnowledgeUpdated?.()
        }
        return { success: true, jobId: data.jobId }
      } catch {
        if (currentWorkspaceRef.current !== targetWorkspace) return { success: false }
        const errorMsg = '수집을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.'
        setError(errorMsg)
        setErrorCode(null)
        return { success: false, error: errorMsg }
      }
    },
    [canManage, workspaceId, loadSources, onKnowledgeUpdated, transport],
  )

  const cancelSource = useCallback(
    async ({ sourceId, revision }: CancelSourceInput) => {
      const targetWorkspace = workspaceId
      if (!canManage) {
        const msg = '채널 정보를 변경할 권한이 없습니다.'
        setError(msg)
        setErrorCode('FORBIDDEN')
        return { success: false, error: msg, code: 'FORBIDDEN' }
      }

      setError(null)
      setErrorCode(null)
      try {
        const res = await transport(
          `/api/workspaces/${workspaceId}/knowledge/channels/${sourceId}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
            },
            body: JSON.stringify({ revision, action: 'cancel' }),
          },
        )

        if (currentWorkspaceRef.current !== targetWorkspace) {
          return { success: false, error: '작업공간이 전환되었습니다.' }
        }

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          const { rawMessage, rawCode } = extractErrorCodeAndMessage(body)
          const sanitized = sanitizeErrorMessage(res.status, rawMessage, rawCode)
          setError(sanitized.message)
          setErrorCode(sanitized.code ?? null)
          return { success: false, error: sanitized.message, code: sanitized.code }
        }

        await loadSources()
        if (currentWorkspaceRef.current === targetWorkspace) {
          onKnowledgeUpdated?.()
        }
        return { success: true }
      } catch {
        if (currentWorkspaceRef.current !== targetWorkspace) return { success: false }
        const errorMsg = '수집을 중단하지 못했습니다. 잠시 후 다시 시도해 주세요.'
        setError(errorMsg)
        setErrorCode(null)
        return { success: false, error: errorMsg }
      }
    },
    [canManage, workspaceId, loadSources, onKnowledgeUpdated, transport],
  )

  const deleteSource = useCallback(
    async ({ sourceId, revision }: DeleteSourceInput) => {
      const targetWorkspace = workspaceId
      if (!canManage) {
        const msg = '채널 정보를 변경할 권한이 없습니다.'
        setError(msg)
        setErrorCode('FORBIDDEN')
        return { success: false, error: msg, code: 'FORBIDDEN' }
      }

      setError(null)
      setErrorCode(null)
      try {
        const res = await transport(
          `/api/workspaces/${workspaceId}/knowledge/channels/${sourceId}`,
          {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
            },
            body: JSON.stringify({ revision }),
          },
        )

        if (currentWorkspaceRef.current !== targetWorkspace) {
          return { success: false, error: '작업공간이 전환되었습니다.' }
        }

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          const { rawMessage, rawCode } = extractErrorCodeAndMessage(body)
          const sanitized = sanitizeErrorMessage(res.status, rawMessage, rawCode)
          setError(sanitized.message)
          setErrorCode(sanitized.code ?? null)
          return { success: false, error: sanitized.message, code: sanitized.code }
        }

        await loadSources()
        if (currentWorkspaceRef.current === targetWorkspace) {
          onKnowledgeUpdated?.()
        }
        return { success: true }
      } catch {
        if (currentWorkspaceRef.current !== targetWorkspace) return { success: false }
        const errorMsg = '채널을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.'
        setError(errorMsg)
        setErrorCode(null)
        return { success: false, error: errorMsg }
      }
    },
    [canManage, workspaceId, loadSources, onKnowledgeUpdated, transport],
  )

  const reviewCandidates = useCallback(
    async ({ sourceId, revision, evidenceRevision, decisions }: ReviewCandidatesInput) => {
      const targetWorkspace = workspaceId
      if (!canManage) {
        const msg = '채널 정보를 변경할 권한이 없습니다.'
        setError(msg)
        setErrorCode('FORBIDDEN')
        return { success: false, error: msg, code: 'FORBIDDEN' }
      }

      setError(null)
      setErrorCode(null)
      try {
        const res = await transport(
          `/api/workspaces/${workspaceId}/knowledge/channels/${sourceId}/review`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
            },
            body: JSON.stringify({ revision, evidenceRevision, decisions }),
          },
        )

        if (currentWorkspaceRef.current !== targetWorkspace) {
          return { success: false, error: '작업공간이 전환되었습니다.' }
        }

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          const { rawMessage, rawCode } = extractErrorCodeAndMessage(body)
          const sanitized = sanitizeErrorMessage(res.status, rawMessage, rawCode)
          setError(sanitized.message)
          setErrorCode(sanitized.code ?? null)
          return { success: false, error: sanitized.message, code: sanitized.code }
        }

        await loadSources()
        if (currentWorkspaceRef.current === targetWorkspace) {
          onKnowledgeUpdated?.()
        }
        return { success: true }
      } catch {
        if (currentWorkspaceRef.current !== targetWorkspace) return { success: false }
        const errorMsg = '후보 승인 검토를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
        setError(errorMsg)
        setErrorCode(null)
        return { success: false, error: errorMsg }
      }
    },
    [canManage, workspaceId, loadSources, onKnowledgeUpdated, transport],
  )

  const fetchSourceDetail = useCallback(
    async (sourceId: string): Promise<SourceDetailResult | null> => {
      const targetWorkspace = workspaceId
      setError(null)
      setErrorCode(null)
      try {
        const res = await transport(
          `/api/workspaces/${workspaceId}/knowledge/channels/${sourceId}`,
          {
            headers: {
              'Cache-Control': 'no-store',
            },
          },
        )

        if (currentWorkspaceRef.current !== targetWorkspace) {
          return null
        }

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          const { rawMessage, rawCode } = extractErrorCodeAndMessage(body)
          const sanitized = sanitizeErrorMessage(res.status, rawMessage, rawCode)
          setError(sanitized.message)
          setErrorCode(sanitized.code ?? null)
          return null
        }

        const data = await res.json()
        return {
          source: data.source,
          candidates: Array.isArray(data.candidates) ? data.candidates : [],
          jobs: Array.isArray(data.jobs) ? data.jobs : [],
        }
      } catch {
        if (currentWorkspaceRef.current !== targetWorkspace) return null
        const errorMsg = '채널 상세 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
        setError(errorMsg)
        setErrorCode(null)
        return null
      }
    },
    [workspaceId, transport],
  )

  return {
    sources,
    capabilities,
    isLoading,
    error,
    errorCode,
    refresh: loadSources,
    addSource,
    verifySource,
    startCollection,
    cancelSource,
    deleteSource,
    reviewCandidates,
    fetchSourceDetail,
  }
}
