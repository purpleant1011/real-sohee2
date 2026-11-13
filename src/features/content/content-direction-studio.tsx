'use client'

import React, { useState } from 'react'
import {
  type ContentDirection,
  type ImageLookType,
  type CompositionOption,
  IMAGE_LOOK_DEFINITIONS,
  COMPOSITION_OPTIONS,
} from './direction-types'
import styles from './content-direction-studio.module.css'
import { Sparkles, MessageSquare, Layers, Send, Upload } from 'lucide-react'

interface ContentDirectionStudioProps {
  initialDirection?: Partial<ContentDirection>
  workspaceId: string
  onSaveDirection?: (direction: ContentDirection) => void
  onRequestReview?: (direction: ContentDirection) => void
}

export function ContentDirectionStudio({
  initialDirection,
  workspaceId,
  onSaveDirection,
  onRequestReview,
}: ContentDirectionStudioProps) {
  const [direction, setDirection] = useState<ContentDirection>({
    id: initialDirection?.id ?? 'dir_sample_01',
    workspaceId,
    version: initialDirection?.version ?? 1,
    status: initialDirection?.status ?? 'editing',
    goal: initialDirection?.goal ?? '가을 시즌 예약 문의 증대',
    audience: initialDirection?.audience ?? '20~40대 지역 고객 및 주말 이용 고객',
    keyMessage: initialDirection?.keyMessage ?? '가을의 따뜻한 공간과 정성스러운 서비스를 지금 예약하세요',
    tone: initialDirection?.tone ?? '따뜻함, 신뢰감, 정성스러움',
    imageLook: initialDirection?.imageLook ?? 'owner_explaining',
    compositions: initialDirection?.compositions ?? ['upper_body', 'explaining_pose', 'text_margin'],
    freeformInstruction: initialDirection?.freeformInstruction ?? '',
    referenceAssets: initialDirection?.referenceAssets ?? [],
    channelSpecs: initialDirection?.channelSpecs ?? [
      { channel: 'instagram', role: '시각적 증명 및 DM 문의 유도', copyCount: 1, imageCount: 3, callToAction: '프로필 링크 예약' },
      { channel: 'threads', role: '진정성 있는 스토리텔링 및 대화 확산', copyCount: 1, imageCount: 2, callToAction: '댓글 문의' },
    ],
    approvalMode: initialDirection?.approvalMode ?? 'manual_review',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  const [chatInput, setChatInput] = useState('')
  const [messages, setMessages] = useState<Array<{ sender: 'sohee' | 'user'; text: string }>>([
    {
      sender: 'sohee',
      text: '안녕하세요 사장님! 이번 포스팅은 `가을 시즌 예약 문의 증대`를 목표로 잡았어요. 어떤 분위기의 비주얼로 제작해 드릴까요?',
    },
  ])

  // 이미지 룩 선택
  const handleSelectLook = (look: ImageLookType) => {
    const updated = {
      ...direction,
      imageLook: look,
      updatedAt: new Date().toISOString(),
    }
    setDirection(updated)
    setMessages((prev) => [
      ...prev,
      { sender: 'user', text: `이미지 룩을 '${IMAGE_LOOK_DEFINITIONS[look].label}'으로 변경해줘.` },
      { sender: 'sohee', text: `'${IMAGE_LOOK_DEFINITIONS[look].label}' 룩을 실시간 브리프에 반영했어요! ${IMAGE_LOOK_DEFINITIONS[look].tagline} 분위기로 초안을 구성할게요.` },
    ])
    onSaveDirection?.(updated)
  }

  // 구도 토글
  const handleToggleComposition = (comp: CompositionOption) => {
    const exists = direction.compositions.includes(comp)
    const newComps = exists
      ? direction.compositions.filter((c) => c !== comp)
      : [...direction.compositions, comp]

    const updated = {
      ...direction,
      compositions: newComps,
      updatedAt: new Date().toISOString(),
    }
    setDirection(updated)
    onSaveDirection?.(updated)
  }

  // 직접 설명 수정
  const handleFreeformChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const updated = {
      ...direction,
      freeformInstruction: e.target.value,
      updatedAt: new Date().toISOString(),
    }
    setDirection(updated)
    onSaveDirection?.(updated)
  }

  // 대화 전송
  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault()
    if (!chatInput.trim()) return

    const userText = chatInput.trim()
    setChatInput('')

    setMessages((prev) => [...prev, { sender: 'user', text: userText }])

    // 자연어 지시 반영 시뮬레이션
    setTimeout(() => {
      let reply = `사장님의 말씀("${userText}")을 브리프에 잘 기록해 두었어요.`
      if (userText.includes('실내') || userText.includes('따뜻')) {
        handleSelectLook('indoor_mood')
        reply = `'따뜻한 실내 무드' 룩으로 변경하고 브리프를 갱신했습니다!`
      } else if (userText.includes('자연광') || userText.includes('햇살')) {
        handleSelectLook('natural_light')
        reply = `'자연광 내추럴' 룩으로 실시간 변경했어요.`
      } else if (userText.includes('클로즈업') || userText.includes('디테일')) {
        handleSelectLook('editorial_close')
        reply = `'에디토리얼 클로즈업' 룩을 브리프에 세팅했어요.`
      }

      setMessages((prev) => [...prev, { sender: 'sohee', text: reply }])
    }, 400)
  }

  // 디렉션 보드 검토 준비
  const handleReviewBoard = () => {
    const updated: ContentDirection = {
      ...direction,
      status: 'ready_for_review',
      updatedAt: new Date().toISOString(),
    }
    setDirection(updated)
    setMessages((prev) => [
      ...prev,
      { sender: 'sohee', text: '✨ 디렉션 보드가 완성되었습니다! 이 기준에 맞춰 채널별 문안과 이미지 생성을 진행할까요?' },
    ])
    onRequestReview?.(updated)
  }

  return (
    <div className={styles.studioContainer} data-testid="content-direction-studio">
      {/* 1. Left: 소희 대화 레일 */}
      <section className={styles.conversationRail} aria-label="소희 대화 레일">
        <div className={styles.railHeader}>
          <div className={styles.soheeAvatar}>소희</div>
          <div>
            <h3 className={styles.railTitle}>소희와의 대화</h3>
            <p className={styles.railSubtitle}>실시간 크리에이티브 가이드</p>
          </div>
        </div>

        <div className={styles.messageList} data-testid="studio-chat-messages">
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={m.sender === 'sohee' ? styles.soheeBubble : styles.userBubble}
            >
              {m.text}
            </div>
          ))}
        </div>

        <form className={styles.chatInputBox} onSubmit={handleSendChat}>
          <input
            className={styles.chatInput}
            placeholder="예: 조금 더 밝은 톤으로 바꿔줘..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
          />
          <button className={styles.chatSendBtn} type="submit" aria-label="전송">
            <Send size={15} />
          </button>
        </form>
      </section>

      {/* 2. Center: 작업면 (이미지 룩, 구도, 설명) */}
      <section className={styles.workspacePanel} aria-label="콘텐츠 디렉션 작업면">
        {/* 이미지 룩 섹션 */}
        <div>
          <div className={styles.sectionHeader}>
            <h4 className={styles.sectionTitle}>
              <Sparkles size={18} color="#7c3aed" /> 1. 대표 이미지 룩 선택
            </h4>
            <p className={styles.sectionDesc}>우리 매장과 이번 목표에 가장 잘 어울리는 비주얼 무드를 골라주세요.</p>
          </div>

          <div className={styles.lookGrid} role="radiogroup" aria-label="이미지 룩">
            {(Object.keys(IMAGE_LOOK_DEFINITIONS) as ImageLookType[]).map((lookKey) => {
              const def = IMAGE_LOOK_DEFINITIONS[lookKey]
              const isSelected = direction.imageLook === lookKey
              return (
                <div
                  key={lookKey}
                  role="radio"
                  aria-checked={isSelected}
                  tabIndex={0}
                  className={`${styles.lookCard} ${isSelected ? styles.lookCardSelected : ''}`}
                  onClick={() => handleSelectLook(lookKey)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleSelectLook(lookKey)
                    }
                  }}
                  data-testid={`look-card-${lookKey}`}
                >
                  <span className={styles.lookBadge}>{def.badge}</span>
                  <h5 className={styles.lookCardTitle}>{def.label}</h5>
                  <p className={styles.lookCardTagline}>{def.tagline}</p>
                  <p className={styles.lookCardDesc}>{def.description}</p>
                </div>
              )
            })}
          </div>
        </div>

        {/* 구도 및 구성 선택 */}
        <div>
          <div className={styles.sectionHeader}>
            <h4 className={styles.sectionTitle}>
              <Layers size={18} color="#7c3aed" /> 2. 화면 구도 및 구성
            </h4>
            <p className={styles.sectionDesc}>원하시는 인물과 피사체의 배치를 모두 선택해 주세요.</p>
          </div>

          <div className={styles.compositionTags}>
            {(Object.keys(COMPOSITION_OPTIONS) as CompositionOption[]).map((compKey) => {
              const opt = COMPOSITION_OPTIONS[compKey]
              const isSelected = direction.compositions.includes(compKey)
              return (
                <button
                  type="button"
                  key={compKey}
                  className={`${styles.compTag} ${isSelected ? styles.compTagSelected : ''}`}
                  onClick={() => handleToggleComposition(compKey)}
                  data-testid={`comp-tag-${compKey}`}
                >
                  {isSelected ? '✓ ' : '+ '}{opt.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* 직접 설명 & 참고자산 */}
        <div>
          <div className={styles.sectionHeader}>
            <h4 className={styles.sectionTitle}>
              <MessageSquare size={18} color="#7c3aed" /> 3. 사장님의 직접 지시 및 참고 자료
            </h4>
            <p className={styles.sectionDesc}>꼭 강조하고 싶은 특별한 디테일이나 사진이 있다면 추가해 주세요.</p>
          </div>

          <textarea
            className={styles.freeformArea}
            placeholder="예: 이번 가을 시즌 신규 앰플 케어를 강조해주시고, 편안한 힐링 느낌을 전해주세요."
            value={direction.freeformInstruction}
            onChange={handleFreeformChange}
            data-testid="freeform-instruction"
          />

          <div style={{ marginTop: 12 }}>
            <div className={styles.assetUploadBox}>
              <Upload size={20} color="#94a3b8" style={{ marginBottom: 6 }} />
              <p style={{ margin: 0, fontSize: 13, color: '#64748b', fontWeight: 600 }}>
                참고 사진 및 매장 이미지 첨부 (최대 5장)
              </p>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>PNG, JPG 지원</span>
            </div>
          </div>
        </div>

        {/* 하단 검토 버튼 */}
        <div className={styles.reviewActionArea}>
          <button
            type="button"
            className={styles.reviewBtn}
            onClick={handleReviewBoard}
            data-testid="review-board-button"
          >
            {direction.status === 'ready_for_review' ? '✓ 디렉션 보드 준비됨' : '디렉션 보드 검토하기 →'}
          </button>
        </div>
      </section>

      {/* 3. Right: 실시간 라이브 브리프 */}
      <aside className={styles.liveBriefPanel} aria-label="실시간 라이브 브리프">
        <div className={styles.briefHeader}>
          <h4 className={styles.briefTitle}>라이브 브리프</h4>
          <span className={`${styles.statusBadge} ${direction.status === 'ready_for_review' ? styles.statusReady : ''}`}>
            {direction.status === 'ready_for_review' ? '준비됨' : '방향 편집 중'}
          </span>
        </div>

        <div className={styles.briefItemList}>
          <div className={styles.briefItem}>
            <span className={styles.briefItemLabel}>캠페인 목표</span>
            <span className={styles.briefItemValue}>{direction.goal}</span>
          </div>

          <div className={styles.briefItem}>
            <span className={styles.briefItemLabel}>타겟 고객</span>
            <span className={styles.briefItemValue}>{direction.audience}</span>
          </div>

          <div className={styles.briefItem}>
            <span className={styles.briefItemLabel}>핵심 메시지</span>
            <span className={styles.briefItemValue}>{direction.keyMessage}</span>
          </div>

          <div className={styles.briefItem}>
            <span className={styles.briefItemLabel}>선택된 이미지 룩</span>
            <span className={styles.briefItemValue} style={{ color: '#7c3aed' }}>
              {IMAGE_LOOK_DEFINITIONS[direction.imageLook].label}
            </span>
          </div>

          <div className={styles.briefItem}>
            <span className={styles.briefItemLabel}>선택된 구도 ({direction.compositions.length}개)</span>
            <span className={styles.briefItemValue}>
              {direction.compositions.map((c) => COMPOSITION_OPTIONS[c].label).join(', ')}
            </span>
          </div>

          <div className={styles.briefItem}>
            <span className={styles.briefItemLabel}>채널별 제작 범위</span>
            <div className={styles.channelSpecBadgeList}>
              {direction.channelSpecs.map((spec) => (
                <div key={spec.channel} className={styles.channelSpecBadge}>
                  <strong style={{ textTransform: 'capitalize' }}>{spec.channel}</strong>
                  <span>이미지 {spec.imageCount}장 · 문안 {spec.copyCount}건</span>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.briefItem}>
            <span className={styles.briefItemLabel}>승인 방식</span>
            <span className={styles.briefItemValue}>
              {direction.approvalMode === 'manual_review' ? '소희 제안 후 사장님 직접 승인' : '안전 범위 내 자율 실행'}
            </span>
          </div>
        </div>
      </aside>
    </div>
  )
}
