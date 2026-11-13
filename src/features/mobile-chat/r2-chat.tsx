'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import { CHAT_SEND_FAILED_NOTICE, type ChatSendResult } from './chat-send'
import { chatScreenConfig, MobileChatView, type ChatViewSnapshot } from './mobile-chat-view'
import { emptyChatSnapshot, failedOrStaleChatSnapshot, loadingChatSnapshot, unauthorizedChatSnapshot } from './r2-chat-snapshot'
import { agentMessagesSnapshot, agentThreadLookup, readAgentChatResponse, restoreAgentActivities } from './agent-chat'
import { outgoingBubble } from './transcript'
import { ChatComposerHost } from './chat-parts'

export interface R2ChatProps {
  workspaceId: string
  fetchImpl?: typeof fetch
}

/** 매장 전환 시 이전 대화·실행·결과를 동기적으로 제거한다. */
export function R2Chat({ workspaceId, fetchImpl }: R2ChatProps) {
  return <R2ChatSession key={workspaceId} workspaceId={workspaceId} fetchImpl={fetchImpl} />
}

function R2ChatSession({ workspaceId, fetchImpl }: R2ChatProps) {
  const request = fetchImpl ?? fetch
  const [snapshot, setSnapshot] = useState<ChatViewSnapshot>(loadingChatSnapshot)
  const [reloadKey, setReloadKey] = useState(0)
  const [threadId, setThreadId] = useState<string | null>(null)
  const activeSend = useRef<AbortController | null>(null)
  const uncertainRequest = useRef(false)
  const uncertainRun = useRef<string | null>(null)
  const uncertainThread = useRef<string | null>(null)
  const path = `/api/workspaces/${encodeURIComponent(workspaceId)}/agent/chat`

  useEffect(() => () => activeSend.current?.abort(), [])

  const fail = useCallback(() => {
    setSnapshot(current => failedOrStaleChatSnapshot(current, new Date().toISOString(), typeof navigator !== 'undefined' && navigator.onLine === false))
  }, [])

  const load = useCallback(async (signal?: AbortSignal, preferredThread?: string): Promise<boolean> => {
    try {
      let target = preferredThread ?? uncertainThread.current ?? undefined
      if (!target) {
        const response = await request(path, { cache: 'no-store', signal })
        if (signal?.aborted) return false
        if (!response.ok) {
          if ([401, 403].includes(response.status)) setSnapshot(unauthorizedChatSnapshot(new Date().toISOString()))
          else fail()
          return false
        }
        const lookup = agentThreadLookup(await response.json())
        if (!lookup.ok) { fail(); return false }
        if (!lookup.threadId) {
          setThreadId(null)
          setSnapshot({ ...emptyChatSnapshot(new Date().toISOString()), uncertain: uncertainRequest.current })
          return true
        }
        target = lookup.threadId
      }
      const response = await request(`${path}?threadId=${encodeURIComponent(target)}`, { cache: 'no-store', signal })
      if (signal?.aborted) return false
      if (!response.ok) {
        if ([401, 403].includes(response.status)) setSnapshot(unauthorizedChatSnapshot(new Date().toISOString()))
        else fail()
        return false
      }
      const next = agentMessagesSnapshot(await response.json(), workspaceId, target)
      if (signal?.aborted) return false
      if (next.loadState === 'error') { fail(); return false }
      if (next.agentRunId) {
        try {
          next.activities = await restoreAgentActivities(workspaceId, next.agentRunId, request, signal)
        } catch {
          next.activityUnavailable = true
        }
      }
      if (signal?.aborted) return false
      if (uncertainRequest.current && uncertainRun.current && next.agentResult?.runId === uncertainRun.current) {
        uncertainRequest.current = false
        uncertainRun.current = null
        uncertainThread.current = null
      }
      setThreadId(target)
      setSnapshot({ ...next, uncertain: next.uncertain === true || uncertainRequest.current })
      return true
    } catch {
      if (!signal?.aborted) fail()
      return false
    }
  }, [path, request, workspaceId, fail])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load, reloadKey])

  const retry = useCallback(() => {
    setSnapshot(current => ({ ...current, loadState: 'loading' }))
    setReloadKey(key => key + 1)
  }, [])

  const send = useCallback(async (text: string): Promise<ChatSendResult> => {
    const content = text.trim()
    if (!content || activeSend.current || uncertainRequest.current || snapshot.uncertain || snapshot.loadState === 'loading' || snapshot.loadState === 'error' || snapshot.unauthorized) return { ok: false, message: CHAT_SEND_FAILED_NOTICE }
    const controller = new AbortController()
    activeSend.current = controller
    const clientMessageId = crypto.randomUUID()
    let receivedRun = false
    setSnapshot(current => ({ ...current, sending: true, activities: [], progress: undefined, activityUnavailable: false,
      queued: [outgoingBubble(clientMessageId, content)] }))
    try {
      const context = snapshot.agentResult
      const response = await request(path, {
        method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({
          threadId: threadId ?? undefined, clientMessageId,
          message: content, currentUserMessage: content,
          messages: snapshot.bubbles.filter(bubble => !bubble.pending && bubble.role !== 'system').map(bubble => ({ role: bubble.role === 'owner' ? 'user' : 'assistant', content: bubble.text })),
          ...(context?.missionId ? { missionId: context.missionId, previousRunId: context.runId, expectedPlanVersion: context.planVersion } : {}),
        }),
      })
      if (!response.ok && response.status >= 400 && response.status < 500 && response.status !== 408) {
        if ([401, 403].includes(response.status)) setSnapshot(unauthorizedChatSnapshot(new Date().toISOString()))
        else setSnapshot(current => ({ ...current, sending: false, queued: [], progress: undefined }))
        return { ok: false, message: CHAT_SEND_FAILED_NOTICE }
      }
      const result = await readAgentChatResponse(response, workspaceId, {
        signal: controller.signal,
        onRun: (runId, serverThreadId) => {
          receivedRun = true
          uncertainRun.current = runId
          uncertainThread.current = serverThreadId ?? threadId
          if (serverThreadId) setThreadId(serverThreadId)
          setSnapshot(current => ({ ...current, agentRunId: runId }))
        },
        onActivity: event => setSnapshot(current => ({ ...current, activities: [...(current.activities ?? []), event] })),
        onProgress: progress => setSnapshot(current => ({ ...current, progress })),
      })
      if (controller.signal.aborted) return { ok: false, message: CHAT_SEND_FAILED_NOTICE }
      uncertainRun.current = null
      uncertainThread.current = null
      setSnapshot(current => ({ ...current, sending: false, queued: [], progress: undefined, agentResult: result,
        bubbles: [...current.bubbles, { ...outgoingBubble(clientMessageId, content), pending: false },
          { id: `reply-${clientMessageId}`, role: 'sohee', text: result.content, pending: false, evidence: [], approval: null }] }))
      const target = result.threadId ?? threadId
      if (target) await load(controller.signal, target)
      return { ok: true }
    } catch {
      if (!controller.signal.aborted) {
        // 응답 유실은 미실행의 증거가 아니다. 조회만 허용하고 자동/중복 전송을 잠근다.
        uncertainRequest.current = true
        setSnapshot(current => ({ ...current, sending: false, queued: [], uncertain: true,
          activityUnavailable: receivedRun ? current.activityUnavailable : true }))
      }
      return { ok: false, message: CHAT_SEND_FAILED_NOTICE }
    } finally {
      activeSend.current = null
    }
  }, [path, request, workspaceId, threadId, snapshot, load])

  const { mode, title } = chatScreenConfig()
  const composerDisabled = snapshot.loadState === 'loading' || snapshot.loadState === 'error' || snapshot.unauthorized === true || snapshot.uncertain === true || snapshot.sending === true

  return (
    <MobileAppShell>
      <ShellScreen mode={mode} title={title} composer={<ChatComposerHost onSend={send} disabled={composerDisabled} />}>
        <MobileChatView snapshot={snapshot} onSend={send} onRetry={retry} showComposer={false} />
      </ShellScreen>
    </MobileAppShell>
  )
}
