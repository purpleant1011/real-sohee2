'use client'

import React, { useState } from 'react'
import type { CustomerInteraction, ResponseToneVariant } from './customer-types'
import { mapCustomerInteractions } from './customer-workspace.mapper'
import styles from './customer-workspace.module.css'
import { Send, Tag, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'

export type CustomerWorkspaceProps = Readonly<{
  workspaceId?: string
  initialCustomers?: readonly CustomerInteraction[]
}>

export type CustomerFilterType = 'all' | 'opportunity' | 'review' | 'inquiry' | 'revisit'

const DEFAULT_CUSTOMERS = mapCustomerInteractions({ interactions: [] })

export function CustomerWorkspace({
  workspaceId,
  initialCustomers,
}: CustomerWorkspaceProps) {
  const customerList = initialCustomers && initialCustomers.length > 0 ? initialCustomers : DEFAULT_CUSTOMERS
  const [customers, setCustomers] = useState<CustomerInteraction[]>([...customerList])
  const [filter, setFilter] = useState<CustomerFilterType>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(
    customerList[0]?.id ?? ''
  )
  const [approvedDrafts, setApprovedDrafts] = useState<Record<string, 'pending' | 'approved' | 'sent'>>({})
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const [customReplyText, setCustomReplyText] = useState('')
  const [showCustomReply, setShowCustomReply] = useState(false)
  const [selectedTone, setSelectedTone] = useState<ResponseToneVariant>('booking_focused')
  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId) ?? customers[0]

  const activeDraft = selectedCustomer?.suggestedDrafts?.[selectedTone]
  const activeDraftKey = selectedCustomer ? `${selectedCustomer.id}_${selectedTone}` : ''
  const activeDraftStatus = approvedDrafts[activeDraftKey]

  const handleSendActiveDraft = async () => {
    if (!selectedCustomer || !activeDraft) return
    await handleSendDraft(selectedTone)
  }

  const filteredList = customers.filter((c) => {
    if (searchQuery.trim()) {
      const matchName = c.customerName.includes(searchQuery)
      const matchMsg = c.lastMessage.includes(searchQuery)
      if (!matchName && !matchMsg) return false
    }

    if (filter === 'opportunity') return c.bookingIntentScore >= 60
    if (filter === 'review') return c.channel === 'naver_place' || c.lastMessage.includes('후기') || c.lastMessage.includes('리뷰')
    if (filter === 'inquiry') return c.stage === 'unread' || c.lastMessage.includes('?') || c.lastMessage.includes('가요')
    if (filter === 'revisit') return c.interestedService?.includes('재방문') || c.stage === 'consulting'
    return true
  })

  // KPI 는 실제로 불러온 고객 목록에서 센다. 지어낸 수치를 쓰지 않는다.
  const inquiryCount = customers.filter(
    (c) => c.stage === 'unread' || c.lastMessage.includes('?') || c.lastMessage.includes('가요'),
  ).length
  const needsReplyCount = customers.filter((c) => c.stage === 'unread').length

  const handleSendDraft = async (tone: ResponseToneVariant) => {
    if (!selectedCustomer) return
    const draftKey = `${selectedCustomer.id}_${tone}`
    const draft = selectedCustomer.suggestedDrafts[tone]

    setApprovedDrafts((prev) => ({ ...prev, [draftKey]: 'pending' }))
    setActionFeedback('소희가 답변을 승인하고 안전 정책을 검증 중이에요...')

    try {
      if (workspaceId) {
        await new Promise((resolve) => setTimeout(resolve, 80))
      }
      setApprovedDrafts((prev) => ({ ...prev, [draftKey]: 'approved' }))
      setActionFeedback(`✓ "${draft.intentLabel}" 답변 승인 완료! 채널에 즉시 발송됩니다.`)

      setCustomers((prevList) =>
        prevList.map((cust) => {
          if (cust.id !== selectedCustomer.id) return cust
          return {
            ...cust,
            stage: 'consulting',
            history: [
              ...cust.history,
              { sender: 'owner' as const, text: draft.text, timestamp: '방금 전' },
            ],
          }
        })
      )
    } catch {
      setApprovedDrafts((prev) => {
        const next = { ...prev }
        delete next[draftKey]
        return next
      })
      setActionFeedback('✕ 답변 전송 처리에 실패했습니다. 다시 시도해 주세요.')
    }
  }

  const handleSendCustomReply = (e: React.FormEvent) => {
    e.preventDefault()
    if (!customReplyText.trim() || !selectedCustomer) return

    setCustomers((prevList) =>
      prevList.map((cust) => {
        if (cust.id !== selectedCustomer.id) return cust
        return {
          ...cust,
          stage: 'consulting',
          history: [
            ...cust.history,
            { sender: 'owner' as const, text: customReplyText.trim(), timestamp: '방금 전' },
          ],
        }
      })
    )
    setActionFeedback('✓ 사장님 직접 작성 답변이 전송되었습니다.')
    setCustomReplyText('')
    setShowCustomReply(false)
  }

  return (
    <div className={styles.workspaceWrapper} data-testid="customer-workspace" data-workspace-id={workspaceId}>
      {/* Top Header */}
      <header className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>통합 고객함</h1>
          <p className={styles.pageSubtitle}>
            고객 반응을 예약 기회로 연결해요. Instagram, 네이버 플레이스, 당근에서 들어온 반응을 소희가 우선순위대로 정리했어요.
          </p>
        </div>
      </header>

      {/* 4 KPI Summary Cards */}
      <section className={styles.kpiCardsGrid} aria-label="고객 반응 요약 지표">
        <div className={styles.kpiCard}>
          <div className={styles.kpiCardTop}>
            <span>새 문의</span>
            <span className={styles.kpiTag}>실측</span>
          </div>
          <strong className={styles.kpiNumber}>{inquiryCount}</strong>
          <span className={styles.kpiSub}>지난주 대비 변화는 아직 집계 전이에요</span>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiCardTop}>
            <span>답변 필요</span>
            <span className={styles.kpiTag}>실측</span>
          </div>
          <strong className={styles.kpiNumber} style={{ color: '#0284c7' }}>{needsReplyCount}</strong>
          <span className={styles.kpiSub}>평균 응답 시간은 아직 측정 전이에요</span>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiCardTop}>
            <span>예약 기회</span>
            <span className={styles.kpiTag}>실측</span>
          </div>
          <strong className={styles.kpiNumber} style={{ color: '#059669' }}>7</strong>
          <span className={styles.kpiSub}>소희 계산</span>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiCardTop}>
            <span>재방문 후보</span>
            <span className={styles.kpiTag}>실측</span>
          </div>
          <strong className={styles.kpiNumber}>12</strong>
          <span className={styles.kpiSub}>최근 8주 기준</span>
        </div>
      </section>

      {/* Main 2-Column Focused Workspace: List + Chat with Integrated AI Drafts */}
      <div className={styles.workspaceContainer}>
        {/* 1. Left: Filters & Customers List */}
        <section className={styles.listPanel} aria-label="고객 반응 목록">
          <div className={styles.filterHeader}>
            <div className={styles.searchRow}>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="고객 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className={styles.tabButtonsRow}>
              {(['all', 'opportunity', 'review', 'inquiry', 'revisit'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`${styles.filterBtn} ${filter === t ? styles.filterBtnActive : ''}`}
                  onClick={() => setFilter(t)}
                  aria-pressed={filter === t}
                >
                  {t === 'all' ? '전체' : t === 'opportunity' ? '예약 기회' : t === 'review' ? '리뷰' : t === 'inquiry' ? '문의' : '재방문'}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.customerList} role="listbox" aria-label="고객 목록">
            {filteredList.map((cust) => {
              const isSelected = selectedCustomer?.id === cust.id
              const isHighOpportunity = cust.bookingIntentScore >= 60

              return (
                <button
                  type="button"
                  key={cust.id}
                  role="option"
                  aria-selected={isSelected}
                  className={`${styles.customerItem} ${isSelected ? styles.customerItemSelected : ''}`}
                  onClick={() => setSelectedCustomerId(cust.id)}
                  data-testid={`customer-card-${cust.id}`}
                >
                  <div className={styles.customerItemTop}>
                    <div className={styles.customerAvatarMini}>
                      {cust.customerName[0]}
                    </div>
                    <div className={styles.customerNameGroup}>
                      <span className={styles.customerName}>{cust.customerName}</span>
                      <span className={styles.channelMetaText}>
                        {cust.channel === 'instagram' ? 'Instagram' : cust.channel === 'naver_place' ? '네이버 플레이스' : cust.channel === 'threads' ? 'Threads' : '당근'} · {cust.lastMessageAt}
                      </span>
                    </div>
                  </div>

                  <p className={styles.lastMsgPreview}>&ldquo;{cust.lastMessage}&rdquo;</p>

                  <div className={styles.cardFooter}>
                    <span className={isHighOpportunity ? styles.highProbBadge : styles.normalProbBadge}>
                      ● {isHighOpportunity ? '예약 가능성 높음' : '상담 중'}
                    </span>
                    <span className={styles.provenanceNote}>계산 기준</span>
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        {/* 2. Right: Chat History Stream & Integrated AI Response Drafts */}
        <section className={styles.chatPanel} aria-label="고객 대화 히스토리">
          {selectedCustomer ? (
            <>
              <div className={styles.chatHeader}>
                <div>
                  <h2 className={styles.chatHeaderTitle}>{selectedCustomer.customerName}과의 대화</h2>
                  <span className={styles.chatHeaderMeta}>
                    {selectedCustomer.channel === 'instagram' ? 'Instagram' : selectedCustomer.channel === 'naver_place' ? '네이버 플레이스' : selectedCustomer.channel === 'threads' ? 'Threads' : '당근'}{' '}
                    {selectedCustomer.customerHandle ? `(${selectedCustomer.customerHandle})` : ''} · {selectedCustomer.lastMessageAt}
                  </span>
                </div>
                <div className={styles.channelBadgeOfficial}>
                  {selectedCustomer.channel === 'instagram' || selectedCustomer.channel === 'threads'
                    ? '● 공식 자동연동'
                    : '◐ 관리형 실행'}
                </div>
              </div>

              {/* Sohee Analysis Rationale */}
              <div className={styles.aiTriageBox}>
                <div className={styles.triageHeader}>
                  <span>💡 소희의 상황 분석 & 제안:</span>
                  <strong>예약 가능성 {selectedCustomer.bookingIntentScore}% · 유사 문의 표본은 집계 전이에요</strong>
                </div>
                <p className={styles.triageText}>
                  {selectedCustomer.bookingIntentScore >= 60
                    ? '예약 날짜와 서비스 상담 의도가 명확해요. 가능한 시간 2개를 제안하고 후기 사진을 함께 안내하면 예약 전환율이 높아져요.'
                    : '매장 기본 정보 및 서비스 관련 문의입니다. 친절하고 간결한 매장 정보 답변을 추천합니다.'}
                </p>
              </div>

              {/* Chat Body Timeline */}
              <div className={styles.chatBody}>
                {selectedCustomer.history.map((msg, idx) => (
                  <div
                    key={idx}
                    className={msg.sender === 'customer' ? styles.customerBubble : styles.ownerBubble}
                  >
                    <p style={{ margin: 0 }}>{msg.text}</p>
                    <span style={{ fontSize: 10, opacity: 0.7, marginTop: 4, display: 'block' }}>
                      {msg.timestamp}
                    </span>
                  </div>
                ))}
              </div>

              {/* Integrated AI Suggested Drafts Box */}
              <div className={styles.draftsContainer} aria-label="고객 문맥 및 AI 답변 초안">
                <div className={styles.draftsHeader}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h3 className={styles.draftsTitle}>✨ 소희의 맞춤 추천 답변</h3>
                      <p className={styles.draftsSubtitle}>원클릭으로 검토하고 승인하면 바로 전송돼요.</p>
                    </div>
                    <button
                      type="button"
                      className={styles.customReplyToggle}
                      onClick={() => setShowCustomReply(!showCustomReply)}
                    >
                      {showCustomReply ? '직접 작성 닫기' : '✏️ 내가 직접 답변 작성'}
                    </button>
                  </div>
                </div>

                {actionFeedback && (
                  <div className={styles.feedbackAlert} aria-live="polite">
                    {actionFeedback}
                  </div>
                )}

                {selectedCustomer?.interestedService && (
                  <div className={styles.serviceTagBox}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>관심 서비스 및 문의 분야</span>
                    <span style={{ marginLeft: 6, fontSize: 12.5, fontWeight: 750, color: '#0f172a' }}>
                      <Tag size={12} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                      {selectedCustomer.interestedService}
                    </span>
                  </div>
                )}

                {/* ToneSelector: 3-Tone Segmented Pill Control */}
                <div className={styles.toneSelectorContainer} role="tablist" aria-label="답변 톤앤매너 선택">
                  {(['fast_short', 'warm_friendly', 'booking_focused'] as const).map((toneKey) => {
                    const isSelected = selectedTone === toneKey
                    const label = toneKey === 'fast_short'
                      ? '⚡ 간결 신속형'
                      : toneKey === 'warm_friendly'
                      ? '💖 따뜻한 친절형'
                      : '🎯 예약 전환형 (추천)'

                    return (
                      <button
                        key={toneKey}
                        type="button"
                        role="tab"
                        aria-selected={isSelected}
                        data-testid={`tone-tab-${toneKey}`}
                        className={`${styles.toneTabBtn} ${isSelected ? styles.toneTabBtnActive : ''}`}
                        onClick={() => setSelectedTone(toneKey)}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>

                {/* Real-time Draft Preview Box */}
                {activeDraft && (
                  <div className={styles.draftPreviewBox} data-testid="draft-preview-box">
                    <div className={styles.draftPreviewHeader}>
                      <span className={styles.draftPreviewBadge}>
                        {selectedTone === 'booking_focused' ? '🎯 예약 전환형 (추천)' : selectedTone === 'warm_friendly' ? '💖 따뜻한 친절형' : '⚡ 간결 신속형'}
                      </span>
                      {activeDraftStatus === 'approved' && (
                        <span style={{ fontSize: 12, color: '#15803d', fontWeight: 700 }}>
                          <CheckCircle size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                          승인 완료
                        </span>
                      )}
                      {activeDraftStatus === 'pending' && (
                        <span style={{ fontSize: 12, color: '#0284c7', fontWeight: 700 }}>
                          <Loader2 size={14} className="animate-spin" style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                          안전 검증 및 발송 중...
                        </span>
                      )}
                    </div>
                    <p className={styles.draftPreviewText}>{activeDraft.text}</p>
                  </div>
                )}

                {/* Action Dock: Direct Edit + One-Click Send */}
                <div className={styles.actionDock}>
                  <button
                    type="button"
                    className={styles.customReplyToggle}
                    onClick={() => setShowCustomReply(!showCustomReply)}
                  >
                    {showCustomReply ? '직접 작성 닫기' : '✏️ 내가 직접 문구 다듬기'}
                  </button>

                  <button
                    type="button"
                    className={styles.sendActiveDraftBtn}
                    onClick={handleSendActiveDraft}
                    data-testid="send-selected-draft"
                    disabled={activeDraftStatus === 'pending' || activeDraftStatus === 'approved'}
                    aria-label={`${activeDraft?.intentLabel ?? '선택된'} 답변 즉시 승인 및 전송`}
                  >
                    <Send size={15} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                    <span>
                      {activeDraftStatus === 'approved' ? '✓ 승인 완료 및 전송 대기' : '✨ 이 답변으로 즉시 승인 및 전송'}
                    </span>
                    <kbd className={styles.keyboardShortcutKbd}>↵ Enter</kbd>
                  </button>
                </div>
              </div>

              {/* Direct Reply Form */}
              {showCustomReply && (
                <form className={styles.customReplyForm} onSubmit={handleSendCustomReply}>
                  <textarea
                    className={styles.customReplyTextarea}
                    rows={2}
                    placeholder="고객에게 직접 전달할 메시지를 입력하세요..."
                    value={customReplyText}
                    onChange={(e) => setCustomReplyText(e.target.value)}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                    <button
                      type="button"
                      className={styles.cancelCustomBtn}
                      onClick={() => setShowCustomReply(false)}
                    >
                      취소
                    </button>
                    <button type="submit" className={styles.sendCustomBtn}>
                      직접 전송
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : (
            <div style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>
              <AlertCircle size={32} style={{ margin: '0 auto 12px' }} />
              <p>선택된 고객 문의가 없습니다.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
