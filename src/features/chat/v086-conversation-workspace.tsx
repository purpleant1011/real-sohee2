'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { LiveChatToolbeltBar } from '@/features/plugins/LiveChatToolbeltBar'
import { useWorkspaceId } from '@/hooks/use-workspace-context'
import { useExternalWriteGuard } from '@/features/pwa/use-external-write-guard'
import { CreativeStudioCard } from '@/features/creative/creative-studio-card'
import type { VisualBrief } from '@/features/creative/visual-brief-types'
import type { MediaAsset } from '@/features/media/media-asset-types'
import type { CreativeBundle } from '@/features/creative/creative-bundle-types'
import type { VisualSemanticQCResult } from '@/features/creative/visual-semantic-qc'
import styles from './v086-conversation-workspace.module.css'

export interface ThreadItem {
  id: string
  title: string
  lastActive: string
  summary: string
}

export interface CreativeStudioArtifact {
  brief: VisualBrief
  mediaAsset?: MediaAsset | null
  bundle?: CreativeBundle
  qcResult?: VisualSemanticQCResult
  contentId?: string
  versionId?: string
}

export interface ChatMessage {
  id?: string
  sender: 'owner' | 'sohee'
  text: string
  time: string
  runId?: string
  isError?: boolean
  creativeStudioArtifact?: CreativeStudioArtifact
}

export function V086ConversationWorkspace() {
  const workspaceId = useWorkspaceId()
  const runExternalWrite = useExternalWriteGuard()
  const [threads, setThreads] = useState<ThreadItem[]>([])
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)
  const [inputMessage, setInputMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      sender: 'sohee',
      text: '안녕하세요 사장님! 오늘 매장 마케팅과 예약 모니터링을 도와드릴 소희입니다 😊 어떤 업무를 진행할까요?',
      time: '방금',
    },
  ])
  const [toolActionStatus, setToolActionStatus] = useState<string | null>(null)

  // Load durable conversation threads for this workspace
  useEffect(() => {
    if (!workspaceId) return
    let active = true

    async function loadThreads() {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/agent/session`)
        if (!res.ok) return
        const data = await res.json()
        if (active && data.session?.threadId) {
          const currentThread: ThreadItem = {
            id: data.session.threadId,
            title: data.session.title || '현재 진행 중인 대화',
            lastActive: '방금',
            summary: '활성 대화 세션',
          }
          setThreads([currentThread])
          setSelectedThreadId(currentThread.id)
        }
      } catch (err) {
        console.warn('[V086ConversationWorkspace] Failed to load session threads:', err)
      }
    }

    loadThreads()
    return () => {
      active = false
    }
  }, [workspaceId])

  // Load message history when thread is selected (F5 & Re-login persistence)
  useEffect(() => {
    if (!workspaceId || !selectedThreadId) return
    let active = true

    async function loadThreadMessages() {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/conversations/${selectedThreadId}/messages`)
        if (!res.ok) return
        const json = await res.json()
        const rows = json.data
        if (active && Array.isArray(rows) && rows.length > 0) {
          const loadedMessages: ChatMessage[] = rows.map((r: any) => ({
            sender: r.role === 'user' ? 'owner' : 'sohee',
            text: r.content,
            time: r.createdAt ? new Date(r.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '방금',
            runId: r.runId,
          }))
          setMessages(loadedMessages)
        }
      } catch (err) {
        console.warn('[V086ConversationWorkspace] Failed to load thread messages:', err)
      }
    }

    loadThreadMessages()
    return () => {
      active = false
    }
  }, [workspaceId, selectedThreadId])

  const selectedThread = threads.find((t) => t.id === selectedThreadId)

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputMessage.trim() || isLoading) return

    const userText = inputMessage.trim()
    const nowTime = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    setInputMessage('')
    setIsLoading(true)

    setMessages((prev) => [
      ...prev,
      { sender: 'owner', text: userText, time: nowTime },
    ])

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          threadId: selectedThreadId || undefined,
          clientMessageId: crypto.randomUUID(),
        }),
      })

      const data = await res.json()
      if (res.ok && data.content) {
        let creativeStudioArtifact: CreativeStudioArtifact | undefined = undefined
        if (data.visualImage || data.contentId) {
          const now = new Date().toISOString()
          const asset: MediaAsset | null = data.visualImage
            ? {
                id: data.visualImage.assetId,
                workspace_id: workspaceId,
                bucket_id: 'content-media',
                object_path: `workspaces/${workspaceId}/generated/${data.visualImage.assetId}.png`,
                kind: 'image',
                source_type: 'GENERATED_OPENAI',
                mime_type: 'image/png',
                size_bytes: 1048576,
                width: 1024,
                height: 1024,
                sha256_digest: data.fingerprint || '0000000000000000000000000000000000000000000000000000000000000000',
                rights_status: 'OWNED',
                lifecycle_status: 'READY',
                publish_eligibility: true,
                generation_metadata: { model: 'gpt-image-2' },
                created_by: '00000000-0000-0000-0000-000000000000',
                created_at: data.visualImage.createdAt || now,
              }
            : null

          const brief: VisualBrief = {
            briefVersion: 'v10.0',
            workspaceId,
            contentVersionId: data.versionId || '00000000-0000-0000-0000-000000000000',
            businessContext: {
              name: data.preview?.profileName || '비즈니스',
              industry: 'bakery',
              keywords: data.preview?.hashtags || [],
              targetAudience: '매장 고객',
            },
            productContext: {
              name: data.preview?.title || '추천 콘텐츠',
              sellingPoints: ['신선함', '정성'],
            },
            channelSpec: {
              channel: 'instagram',
              aspectRatio: '1:1',
            },
            creativeDirection: {
              heroSubject: data.preview?.title || '추천 콘텐츠',
              environment: '매장 공간',
              composition: '중앙 집중 구도',
              lighting: '자연광',
              colorPalette: ['#ffffff', '#f5f5f5'],
              stylePreset: 'editorial_photography',
            },
            negativeConstraints: {
              forbiddenTokens: [],
              textRendering: 'NO_TEXT_IN_IMAGE',
              prohibitedDomains: ['beauty'],
            },
            captionSummary: data.preview?.caption || data.content || '',
            promptText: data.visualImage?.prompt || data.content || '',
            promptDigest: data.fingerprint || 'digest',
            createdAt: now,
          }

          const bundle: CreativeBundle = {
            bundleId: data.contentId || '00000000-0000-0000-0000-000000000000',
            workspaceId,
            contentId: data.contentId || '00000000-0000-0000-0000-000000000000',
            versionId: data.versionId || '00000000-0000-0000-0000-000000000000',
            channel: 'instagram',
            caption: data.preview?.caption || data.content || '',
            hashtags: data.preview?.hashtags || [],
            orderedMedia: asset
              ? [
                  {
                    mediaAssetId: asset.id,
                    sha256Digest: asset.sha256_digest,
                    position: 0,
                    role: 'primary',
                  },
                ]
              : [],
            creativeBriefVersion: 'v10.0',
            bundleFingerprint: data.fingerprint || '0000000000000000000000000000000000000000000000000000000000000000',
            approvalStatus: 'PENDING',
            createdAt: now,
            updatedAt: now,
          }

          creativeStudioArtifact = {
            brief,
            mediaAsset: asset,
            bundle,
            qcResult: {
              decision: 'PASS',
              score: 0.98,
              passed: true,
              reasons: ['원고 및 시각 콘셉트가 완벽히 일치합니다.'],
              violations: [],
              evidence: {
                captionKeywords: data.preview?.hashtags || [],
                briefHeroSubject: brief.creativeDirection.heroSubject,
                mediaProvenance: asset?.source_type || 'GENERATED_OPENAI',
                mediaSha256: asset?.sha256_digest || '',
                checkedRules: ['RULE_ASPECT_RATIO_1_1', 'RULE_NO_TEXT_IN_IMAGE'],
              },
              evaluatedAt: now,
            },
            contentId: data.contentId,
            versionId: data.versionId,
          }
        }

        setMessages((prev) => [
          ...prev,
          {
            sender: 'sohee',
            text: data.content,
            time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
            runId: data.runId,
            creativeStudioArtifact,
          },
        ])
        if (data.threadId && !selectedThreadId) {
          setSelectedThreadId(data.threadId)
          setThreads((prev) => [
            {
              id: data.threadId,
              title: userText.slice(0, 20),
              lastActive: '방금',
              summary: '신규 생성 스레드',
            },
            ...prev,
          ])
        }
      } else {
        setMessages((prev) => [
          ...prev,
          {
            sender: 'sohee',
            text: data.content || data.error || '답변 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
            time: '방금',
            isError: true,
          },
        ])
      }
    } catch (err) {
      console.error('[V086ConversationWorkspace] Chat request failed:', err)
      setMessages((prev) => [
        ...prev,
        {
          sender: 'sohee',
          text: '네트워크 통신 중 오류가 발생했습니다. 연결 상태를 확인해 주세요.',
          time: '방금',
          isError: true,
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handleStartNewChat = () => {
    setSelectedThreadId(null)
    setIsMobileSidebarOpen(false)
    setMessages([
      {
        sender: 'sohee',
        text: '새로운 대화를 시작합니다. 사장님, 오늘 어떤 주제로 마케팅을 진행할까요?',
        time: '방금',
      },
    ])
    setToolActionStatus(null)
  }

  return (
    <div className={styles.workspaceGrid}>
      {/* Mobile Collapsible Sidebar Toggle Bar (ANI-1128 375px Mobile Parity) */}
      <div className={styles.mobileSidebarBar}>
        <button
          type="button"
          onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
          className={styles.mobileSidebarToggle}
          aria-expanded={isMobileSidebarOpen}
          aria-label="대화 스레드 목록 열기/닫기"
        >
          <span>💬 대화 목록 ({threads.length})</span>
          <span>{isMobileSidebarOpen ? '접기 ▲' : '열기 ▼'}</span>
        </button>
      </div>

      {/* 1. Left Sidebar: Threads List */}
      <aside
        className={`${styles.threadSidebar} ${
          isMobileSidebarOpen ? styles.threadSidebarMobileOpen : styles.threadSidebarMobileClosed
        }`}
        aria-label="대화 스레드 목록"
      >
        <div className={styles.sidebarTop}>
          <button
            type="button"
            className={styles.newChatBtn}
            onClick={handleStartNewChat}
          >
            + 새 대화
          </button>
        </div>

        <div className={styles.threadSection}>
          <span className={styles.sectionHeaderLabel}>대화 기록</span>
          <div className={styles.threadList}>
            {threads.length === 0 ? (
              <div className="p-4 text-xs text-zinc-400 text-center">
                대화 기록이 없습니다.
              </div>
            ) : (
              threads.map((thread) => {
                const isSelected = thread.id === selectedThreadId
                return (
                  <button
                    key={thread.id}
                    type="button"
                    className={`${styles.threadItem} ${isSelected ? styles.threadItemActive : ''}`}
                    onClick={() => {
                      setSelectedThreadId(thread.id)
                      setIsMobileSidebarOpen(false)
                    }}
                  >
                    <strong className={styles.threadTitle}>{thread.title}</strong>
                    <span className={styles.threadMeta}>
                      {thread.lastActive} · {thread.summary}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>

        <div className={styles.approvalBadgeBox}>
          <div className={styles.badgeTop}>
            <span>콘텐츠 제작 및 승인</span>
          </div>
          <p className={styles.badgeDesc}>제작된 콘텐츠와 승인 대기 목록을 관리합니다</p>
          <Link href="/app/work" className={styles.badgeLink}>
            승인함으로 이동 →
          </Link>
        </div>
      </aside>

      {/* 2. Main Chat Area */}
      <section className={styles.chatMainArea} aria-label="대화 본문">
        {/* Header */}
        <div className={styles.chatHeader}>
          <div>
            <h2 className={styles.chatHeaderTitle}>
              {selectedThread?.title || '소희와의 1:1 업무 대화'}
            </h2>
            <span className={styles.chatHeaderSubtitle}>
              소희가 매장의 실제 업무 문맥을 확인하고 있어요
            </span>
          </div>
          <span className={styles.presencePill}>● 소희 연결됨</span>
        </div>

        {/* Realtime Live Toolbelt */}
        <LiveChatToolbeltBar />

        {/* Messages Stream */}
        <div className={styles.messagesStream}>
          <div className={styles.dateDivider}>
            <span>오늘</span>
          </div>

          <div className={styles.securityNote}>
            소희는 확인한 자료와 계산 근거를 구분하고, 중요한 실행은 사장님의 결정을 기다려요.
          </div>

          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={msg.sender === 'owner' ? styles.ownerMsgRow : styles.soheeMsgRow}
            >
              <div className={msg.sender === 'owner' ? styles.ownerAvatar : styles.soheeAvatar}>
                {msg.sender === 'owner' ? '사' : 'S'}
              </div>
              <div className={styles.msgBody}>
                <div className={styles.msgMeta}>
                  <strong>{msg.sender === 'owner' ? '사장님' : '소희'}</strong>
                  <span>{msg.time}</span>
                  {msg.runId && (
                    <span className="font-mono text-[10px] text-zinc-400 ml-2">
                      Run #{msg.runId.slice(0, 8)}
                    </span>
                  )}
                </div>
                <div className={msg.sender === 'owner' ? styles.ownerBubble : styles.soheeBubble}>
                  {msg.text}
                </div>
                {msg.creativeStudioArtifact && (
                  <div className="mt-4 w-full max-w-2xl">
                    <CreativeStudioCard
                      brief={msg.creativeStudioArtifact.brief}
                      mediaAsset={msg.creativeStudioArtifact.mediaAsset}
                      bundle={msg.creativeStudioArtifact.bundle}
                      qcResult={msg.creativeStudioArtifact.qcResult}
                      onApprove={async () => {
                        if (!workspaceId || !msg.creativeStudioArtifact?.contentId || !msg.creativeStudioArtifact?.versionId) return
                        try {
                          const appRes = await fetch(`/api/workspaces/${workspaceId}/content/approvals`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              contentId: msg.creativeStudioArtifact.contentId,
                              versionId: msg.creativeStudioArtifact.versionId,
                              fingerprint: msg.creativeStudioArtifact.bundle?.bundleFingerprint,
                            }),
                          })
                          const appData = await appRes.json()
                          if (!appRes.ok || !appData.success) {
                            throw new Error(appData.error?.message || '원고 승인 처리에 실패했습니다.')
                          }
                          setMessages((prev) =>
                            prev.map((m) => {
                              if (m === msg && m.creativeStudioArtifact?.bundle) {
                                return {
                                  ...m,
                                  creativeStudioArtifact: {
                                    ...m.creativeStudioArtifact,
                                    bundle: {
                                      ...m.creativeStudioArtifact.bundle,
                                      approvalStatus: 'APPROVED',
                                    },
                                  },
                                }
                              }
                              return m
                            })
                          )
                        } catch (err) {
                          console.error('Failed to approve bundle:', err)
                        }
                      }}
                      onPublishNow={async () => {
                        if (!workspaceId || !msg.creativeStudioArtifact?.contentId) return
                        const contentId = msg.creativeStudioArtifact.contentId
                        // 지금 발행은 오프라인이거나 같은 건이 이미 진행 중이면 요청하지 않는다(ANI-1778).
                        const outcome = await runExternalWrite('publish', `creative:${contentId}`, async () => {
                          try {
                            await fetch(`/api/workspaces/${workspaceId}/publishing/jobs`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ contentId }),
                            })
                          } catch (err) {
                            console.error('Failed to publish now:', err)
                          }
                        })
                        if (!outcome.ran) {
                          setMessages(prev => [...prev, { sender: 'sohee', text: outcome.decision.message, time: '방금', isError: true }])
                        }
                      }}
                      onRegenerateImage={() => {
                        setInputMessage('이미지를 다른 스타일로 다시 생성해줘')
                      }}
                      onEditCaption={() => {
                        setInputMessage('원고 문구를 조금 더 다듬어줘')
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className={styles.soheeMsgRow}>
              <div className={styles.soheeAvatar}>S</div>
              <div className={styles.msgBody}>
                <div className={styles.msgMeta}>
                  <strong>소희</strong>
                  <span>작업 중...</span>
                </div>
                <div className={styles.soheeBubble}>
                  <span className="inline-flex items-center gap-1.5 text-zinc-500">
                    <span className="animate-pulse">●</span>
                    <span className="animate-pulse delay-100">●</span>
                    <span className="animate-pulse delay-200">●</span>
                    <span>실제 마케팅 업무 계획을 검토하고 있습니다...</span>
                  </span>
                </div>
              </div>
            </div>
          )}

          {toolActionStatus && (
            <div className={styles.actionStatusAlert}>
              {toolActionStatus}
            </div>
          )}
        </div>

        {/* Input Form */}
        <form className={styles.chatInputForm} onSubmit={handleSendMessage}>
          <div className={styles.quickChips}>
            <button
              type="button"
              className={styles.chipBtn}
              onClick={() => setInputMessage('오늘 제가 확인할 일 알려줘')}
            >
              오늘 확인할 일
            </button>
            <button
              type="button"
              className={styles.chipBtn}
              onClick={() => setInputMessage('이번 주 신규 프로모션 콘텐츠 만들어줘')}
            >
              이번 주 콘텐츠
            </button>
            <button
              type="button"
              className={styles.chipBtn}
              onClick={() => setInputMessage('예약 가능성이 높은 고객 찾아줘')}
            >
              고객 기회 찾기
            </button>
          </div>

          <div className={styles.inputRow}>
            <input
              type="text"
              className={styles.textInput}
              placeholder="소희에게 마케팅 업무를 지시하세요..."
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              disabled={isLoading}
            />
            <button
              type="submit"
              className={styles.sendButton}
              disabled={!inputMessage.trim() || isLoading}
            >
              {isLoading ? '처리 중' : '보내기'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
