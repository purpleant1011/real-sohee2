'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import type { ComposerSubmit } from './conversation-composer'
import {
  IMAGE_TEMPLATES,
  INTERVIEW_INTRODUCTION,
  serializeContentInterviewControl,
  WORKSPACE_STYLE_IMAGE_ID,
  type ContentInterviewView,
  type ImagePreferences,
  type ImageTemplate,
  type InterviewGroupKey,
} from './content-interview'
import {
  EMPTY_STYLE_SUMMARY,
  type WorkspaceStyleSummary,
} from '@/features/image-style/style-summary'
import { loadWorkspaceStyleSummaryAction } from '@/features/image-style/actions/load-style-summary'
import styles from './conversation-shell.module.css'

type InterviewAnswerPayload = Readonly<{
  value: string
  source: 'option' | 'free_text'
  customText?: string
}>

type ContentInterviewCardProps = Readonly<{
  attachmentIds?: readonly string[]
  clarification: ContentInterviewView
  disabled?: boolean
  onSubmit: (submission: ComposerSubmit) => void | boolean | Promise<void | boolean>
  workspaceId?: string
}>

const channelLabels: Record<string, string> = {
  instagram: 'Instagram',
  threads: 'Threads',
  naver_blog: '네이버 블로그',
  daangn_business: '당근 비즈프로필',
}

function makeSubmission(message: string, displayMessage: string, attachmentIds: readonly string[]): ComposerSubmit {
  return {
    message,
    displayMessage,
    attachmentIds: [...attachmentIds],
    clientMessageId: crypto.randomUUID(),
  }
}

function answerPayload(value: string, source: InterviewAnswerPayload['source'], customText?: string): InterviewAnswerPayload {
  return {
    value,
    source,
    ...(customText ? { customText } : {}),
  }
}

export function ContentInterviewCard({
  attachmentIds = [],
  clarification,
  disabled = false,
  onSubmit,
  workspaceId,
}: ContentInterviewCardProps) {
  const [selectedValue, setSelectedValue] = useState<string | null>(null)
  const [freeText, setFreeText] = useState('')
  const [groupAnswers, setGroupAnswers] = useState<Partial<Record<InterviewGroupKey, InterviewAnswerPayload>>>({})
  const [styleSummary, setStyleSummary] = useState<WorkspaceStyleSummary>(EMPTY_STYLE_SUMMARY)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(WORKSPACE_STYLE_IMAGE_ID)
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([])
  const imageTemplates = clarification.imageTemplates ?? []
  const [imagePreferences, setImagePreferences] = useState<Omit<ImagePreferences, 'templateId'>>(() => ({
    modelAge: '30s',
    framing: 'upper_body',
    pose: 'front',
    background: 'bright_studio',
    textOverlay: 'none',
  }))
  const [errorMessage, setErrorMessage] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const eventFactsId = useId()
  const freeTextRef = useRef<HTMLTextAreaElement>(null)
  const groupTextRefs = useRef<Partial<Record<InterviewGroupKey, HTMLTextAreaElement | null>>>({})

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    loadWorkspaceStyleSummaryAction({ workspaceId })
      .then((res) => {
        if (cancelled) return
        if (res && 'data' in res && res.data) {
          setStyleSummary(res.data)
          if (res.data.image.references.length > 0) {
            setSelectedReferenceIds(res.data.image.references.map((r) => r.id))
          }
        }
      })
      .catch(() => {
        // 실패 시 EMPTY_STYLE_SUMMARY 유지
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  function invokeSubmit(message: string, displayMessage: string): void {
    if (disabled || submitted || !message.trim()) return
    setSubmitted(true)
    const result = onSubmit(makeSubmission(message.trim(), displayMessage.trim(), attachmentIds))
    if (result instanceof Promise) {
      void result.then((accepted) => {
        if (accepted === false) setSubmitted(false)
      }).catch(() => setSubmitted(false))
    } else if (result === false) {
      setSubmitted(false)
    }
  }

  function selectSingleOption(option: ContentInterviewView['options'][number]) {
    if (disabled || submitted) return
    setErrorMessage('')
    setSelectedValue(option.value)
    if (option.value === 'custom') {
      window.requestAnimationFrame(() => freeTextRef.current?.focus())
      return
    }
    invokeSubmit(JSON.stringify(answerPayload(option.value, 'option')), option.label)
  }

  function selectGroupOption(
    key: InterviewGroupKey,
    option: Readonly<{ value: string; label: string }>,
  ) {
    if (disabled || submitted) return
    setErrorMessage('')
    const answer = option.value === 'custom'
      ? answerPayload('custom', 'free_text')
      : answerPayload(option.value, 'option')
    const nextAnswers = { ...groupAnswers, [key]: answer }
    setGroupAnswers(nextAnswers)
    if (option.value === 'custom') {
      window.requestAnimationFrame(() => groupTextRefs.current[key]?.focus())
      return
    }
  }

  function selectImageTemplate(template: ImageTemplate) {
    if (disabled || submitted) return
    setErrorMessage('')
    setSelectedTemplateId(template.id)
    setImagePreferences((prev) => ({
      ...prev,
      ...template.defaults,
    }))
  }

  function selectWorkspaceStyle() {
    if (disabled || submitted) return
    setErrorMessage('')
    setSelectedTemplateId(WORKSPACE_STYLE_IMAGE_ID)
  }

  function toggleReference(id: string) {
    if (disabled || submitted) return
    setSelectedReferenceIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  function updateImagePreference<Key extends keyof Omit<ImagePreferences, 'templateId'>>(
    key: Key,
    value: Omit<ImagePreferences, 'templateId'>[Key],
  ) {
    setErrorMessage('')
    setImagePreferences((current) => ({ ...current, [key]: value }))
  }

  function submitSingleFreeText() {
    const value = freeText.trim()
    if (!value) {
      setErrorMessage('원하는 방향을 한 문장으로 입력해 주세요.')
      freeTextRef.current?.focus()
      return
    }
    invokeSubmit(JSON.stringify(answerPayload('custom', 'free_text', value)), value)
  }

  function submitGroupAnswers() {
    const callToActionAnswer = groupAnswers.callToAction
    const callToActionText = callToActionAnswer?.value === 'custom' ? callToActionAnswer.customText?.trim() ?? '' : ''

    if (!callToActionAnswer) {
      setErrorMessage('글을 읽은 분이 할 행동을 선택해 주세요.')
      return
    }
    if (callToActionAnswer.value === 'custom' && !callToActionText) {
      setErrorMessage('행동 유도를 직접 입력해 주세요.')
      groupTextRefs.current.callToAction?.focus()
      return
    }

    const isWorkspaceStyle = selectedTemplateId === WORKSPACE_STYLE_IMAGE_ID
    const template = isWorkspaceStyle
      ? null
      : (imageTemplates.find((item) => item.id === selectedTemplateId) ??
         IMAGE_TEMPLATES.find((item) => item.id === selectedTemplateId) ??
         null)

    if (!isWorkspaceStyle && !template) {
      setErrorMessage('원하는 이미지 스타일을 선택해 주세요.')
      return
    }

    const allReferences = styleSummary.image.references
    let styleRefPayload: readonly string[] | undefined = undefined
    if (allReferences.length > 0) {
      if (selectedReferenceIds.length > 0) {
        styleRefPayload = selectedReferenceIds
      } else {
        styleRefPayload = undefined
      }
    }

    const chosenTemplateId = isWorkspaceStyle ? WORKSPACE_STYLE_IMAGE_ID : template!.id

    const payload = JSON.stringify({
      image: answerPayload(chosenTemplateId, 'option'),
      callToAction: callToActionAnswer.value === 'custom'
        ? answerPayload('custom', 'free_text', callToActionText)
        : callToActionAnswer,
      imagePreferences: {
        templateId: chosenTemplateId,
        ...imagePreferences,
        ...(imagePreferences.extraDirection?.trim()
          ? { extraDirection: imagePreferences.extraDirection.trim() }
          : { extraDirection: undefined }),
        ...(styleRefPayload !== undefined ? { styleReferenceIds: styleRefPayload } : {}),
      },
    })

    const callToActionLabel = callToActionAnswer.value === 'custom'
      ? callToActionText
      : clarification.optionGroups.find((group) => group.key === 'callToAction')
        ?.options.find((item) => item.value === callToActionAnswer.value)?.label ?? callToActionAnswer.value

    const styleLabel = isWorkspaceStyle
      ? (styleSummary.image.configured
          ? '우리 매장 이미지 스타일 그대로'
          : '소희가 업종에 맞게 알아서')
      : template!.label

    invokeSubmit(payload, `행동 유도: ${callToActionLabel} · 이미지 스타일: ${styleLabel}`)
  }

  const isCollecting = clarification.status === 'collecting'
  const isEventFacts =
    clarification.questionId === 'eventFacts' ||
    clarification.questionKind === 'event_facts' ||
    clarification.stepLabel?.startsWith('이벤트 정보')
  const optionGroups = clarification.optionGroups
  const showSingleOptions = isCollecting && clarification.step < 4 && !isEventFacts
  const showGroupOptions = isCollecting && clarification.step === 4 && optionGroups.length > 0
  const showReviewSummary = clarification.status === 'ready_to_generate' && clarification.summary
  const displayStepLabel = clarification.stepLabel?.includes('/')
    ? clarification.stepLabel
    : clarification.stepLabel
      ? `${clarification.stepLabel} · ${clarification.step} / ${clarification.totalSteps}`
      : `${clarification.step} / ${clarification.totalSteps}`

  return (
    <section
      aria-label="콘텐츠 방향 질문"
      className={styles.interviewCard}
      data-disabled={disabled || undefined}
    >
      <div className={styles.interviewCardHeader}>
        <div>
          <span className={styles.interviewEyebrow}>콘텐츠 방향 질문</span>
          <strong>{displayStepLabel}</strong>
        </div>
        <span className={styles.interviewStepLabel}>소희가 차근차근 확인할게요</span>
      </div>

      <div className={styles.interviewQuestion}>
        <p className={styles.interviewWarmCopy}>
          {isEventFacts
            ? '이름·기간·혜택·참여/문의 방법을 알려 주시면 문구에 정확히 반영할게요.'
            : clarification.step === 1
              ? INTERVIEW_INTRODUCTION
              : '그 방향으로 이해했어요. 다음 질문에서 필요한 부분만 이어서 확인할게요.'}
        </p>
        <h2>{clarification.question}</h2>
        {clarification.step === 3 ? (
          <div style={{ marginTop: '0.5rem', fontSize: '0.82rem', color: 'var(--v07-ink-soft)' }}>
            {styleSummary.text.configured ? (
              <>
                <span>우리 글 방식 적용 중 — {styleSummary.text.voiceSummary}</span>{' '}
                <Link href="/app/settings/brand" style={{ color: 'var(--v07-accent)', fontWeight: 600, textDecoration: 'underline' }}>수정</Link>
              </>
            ) : (
              <>
                <span>글 쓰는 방식을 링크로 만들어 두면 매번 같은 느낌으로 써요</span>{' '}
                <Link href="/app/settings/image-style" style={{ color: 'var(--v07-accent)', fontWeight: 600, textDecoration: 'underline' }}>만들기</Link>
              </>
            )}
          </div>
        ) : null}
      </div>

      {isCollecting ? (
        <div className={styles.interviewFreeTextBlock}>
          <button className={styles.interviewContinue} disabled={disabled || submitted} type="button"
            onClick={() => invokeSubmit(serializeContentInterviewControl({ action: 'quick_generate' }), '질문 생략하고 초안 만들기')}>
            질문 생략하고 초안 만들기
          </button>
          <p className={styles.interviewAttachmentHint}>지금까지 알려주신 내용과 가게 정보를 바탕으로 문구와 이미지를 준비해요. 실제 게시는 완성된 내용을 확인하고 승인한 뒤 진행해요.</p>
        </div>
      ) : null}

      {isCollecting && isEventFacts ? (
        <div className={styles.interviewFreeTextBlock}>
          <label htmlFor={eventFactsId}>
            <span>이벤트 상세 내용 직접 적어 주세요</span>
          </label>
          <textarea
            id={eventFactsId}
            className={styles.interviewFreeText}
            disabled={disabled || submitted}
            maxLength={2_000}
            onChange={(event) => {
              setErrorMessage('')
              setFreeText(event.target.value)
            }}
            placeholder="예) 가을 맞이 첫 방문 20% 할인 / 11월 한 달 / 카카오톡으로 문의"
            ref={freeTextRef}
            rows={3}
            value={freeText}
          />
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              className={styles.interviewContinue}
              disabled={disabled || submitted}
              onClick={() => {
                const value = freeText.trim()
                if (!value) {
                  setErrorMessage('이벤트 정보를 입력하거나, 나중에 채우기를 선택해 주세요.')
                  freeTextRef.current?.focus()
                  return
                }
                invokeSubmit(JSON.stringify(answerPayload('custom', 'free_text', value)), value)
              }}
              type="button"
            >
              이 답변으로 계속하기
            </button>
            <button
              className={styles.interviewOption}
              disabled={disabled || submitted}
              onClick={() => {
                invokeSubmit(JSON.stringify(answerPayload('skip', 'option', '나중에 채울게요')), '나중에 채울게요')
              }}
              type="button"
            >
              나중에 채울게요
            </button>
          </div>
        </div>
      ) : null}

      {showSingleOptions ? (
        <div aria-label="답변 선택지" className={styles.interviewOptions}>
          {clarification.options.map((option) => (
            <button
              aria-pressed={selectedValue === option.value}
              className={styles.interviewOption}
              disabled={disabled || submitted}
              key={option.value}
              onClick={() => selectSingleOption(option)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      {showGroupOptions ? (
        <div className={styles.interviewOptionGroups}>
          {optionGroups.map((group) => {
            const selected = groupAnswers[group.key]
            const isCustom = selected?.value === 'custom'
            return (
              <fieldset className={styles.interviewOptionGroup} key={group.key}>
                <legend>{group.label}</legend>
                <div className={styles.interviewOptions}>
                  {group.options.map((option) => (
                    <button
                      aria-label={option.value === 'custom' ? `${group.label} ${option.label}` : undefined}
                      aria-pressed={selected?.value === option.value}
                      className={styles.interviewOption}
                      disabled={disabled || submitted}
                      key={`${group.key}-${option.value}`}
                      onClick={() => selectGroupOption(group.key, option)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {isCustom ? (
                  <textarea
                    aria-label={`${group.label} 직접 입력`}
                    className={styles.interviewFreeText}
                    disabled={disabled || submitted}
                    maxLength={2_000}
                    onChange={(event) => {
                      setErrorMessage('')
                      setGroupAnswers((current) => ({
                        ...current,
                        [group.key]: answerPayload('custom', 'free_text', event.target.value),
                      }))
                    }}
                    placeholder={`${group.label}을 직접 적어 주세요`}
                    ref={(node) => { groupTextRefs.current[group.key] = node }}
                    rows={2}
                    value={selected?.customText ?? ''}
                  />
                ) : null}
              </fieldset>
            )
          })}
        </div>
      ) : null}

      {showGroupOptions ? (
        <section aria-label="이미지 인터뷰" className={styles.imageInterview}>
          <div className={styles.imageInterviewHeading}>
            <div>
              <span>이미지 인터뷰</span>
              <h3>어떤 이미지 스타일이 좋을까요?</h3>
              <p>지식관리 이미지 스타일을 바탕으로 추천했어요. 필요한 경우 직접 변경할 수 있습니다.</p>
            </div>
            <small>필요한 항목만 바꿔도 돼요</small>
          </div>

          {styleSummary.image.configured ? (
            <div style={{ marginBottom: '1rem' }}>
              <button
                type="button"
                aria-pressed={selectedTemplateId === WORKSPACE_STYLE_IMAGE_ID}
                className={styles.imageTemplate}
                style={{ width: '100%', padding: '0.75rem', cursor: 'pointer' }}
                onClick={selectWorkspaceStyle}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <strong style={{ fontSize: '0.92rem', padding: 0 }}>우리 매장 이미지 스타일 그대로</strong>
                  <b style={{
                    backgroundColor: 'rgb(108 68 214 / 90%)',
                    color: '#fff',
                    borderRadius: '999px',
                    padding: '0.2rem 0.5rem',
                    fontSize: '0.68rem',
                  }}>추천</b>
                </div>
                <small style={{ minHeight: 'unset', padding: 0, marginTop: '0.35rem', color: 'var(--v07-ink-soft)' }}>
                  {styleSummary.image.headline}
                </small>
              </button>

              {styleSummary.image.references.length > 0 ? (
                <div style={{ marginTop: '0.75rem' }}>
                  <p style={{ fontSize: '0.78rem', color: 'var(--v07-ink-soft)', marginBottom: '0.5rem' }}>
                    이번 글에 참고할 기준 사진을 골라요. 고르지 않으면 전체를 참고해요.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '0.5rem' }}>
                    {styleSummary.image.references.map((ref, idx) => (
                      <div
                        key={ref.id}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          border: '1px solid var(--v07-line)',
                          borderRadius: '0.5rem',
                          padding: '0.5rem',
                          background: 'var(--v07-surface)',
                        }}
                      >
                        <div style={{ position: 'relative', width: '100%', height: '90px', marginBottom: '0.35rem' }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={ref.url}
                            alt={`기준 사진 ${idx + 1}`}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '0.25rem' }}
                          />
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.25rem', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            aria-label={`기준 사진 ${idx + 1} 참고`}
                            checked={selectedReferenceIds.includes(ref.id)}
                            onChange={() => toggleReference(ref.id)}
                          />
                          <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>기준 사진 {idx + 1}</span>
                        </label>
                        {ref.note ? (
                          <span style={{ fontSize: '0.68rem', color: 'var(--v07-muted)', lineHeight: 1.3 }}>
                            {ref.note}
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{
                border: '1px dashed var(--v07-line-strong)',
                borderRadius: 'var(--v07-radius-md)',
                padding: '0.75rem',
                marginBottom: '0.75rem',
                background: 'var(--v07-surface-soft)',
              }}>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--v07-ink-soft)' }}>
                  아직 이미지 스타일이 없어요. 링크나 사진으로 1분이면 만들 수 있어요.
                </p>
                <Link
                  href="/app/settings/image-style"
                  style={{ display: 'inline-block', marginTop: '0.35rem', fontSize: '0.78rem', color: 'var(--v07-accent)', fontWeight: 600, textDecoration: 'underline' }}
                >
                  이미지 스타일 만들기
                </Link>
              </div>
              <button
                type="button"
                aria-pressed={selectedTemplateId === WORKSPACE_STYLE_IMAGE_ID}
                className={styles.imageTemplate}
                style={{ width: '100%', padding: '0.75rem', cursor: 'pointer' }}
                onClick={selectWorkspaceStyle}
              >
                <strong style={{ fontSize: '0.92rem', padding: 0 }}>소희가 업종에 맞게 알아서</strong>
                <small style={{ minHeight: 'unset', padding: 0, marginTop: '0.35rem' }}>
                  우리 업종과 글 내용에 어울리는 최적의 스타일로 연출해요
                </small>
              </button>
            </div>
          )}

          <details style={{ marginBottom: '1rem', border: '1px solid var(--v07-line)', borderRadius: 'var(--v07-radius-md)', padding: '0.5rem' }}>
            <summary style={{ cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, padding: '0.25rem' }}>
              장면 느낌 직접 고르기 (선택)
            </summary>
            <div style={{ marginTop: '0.75rem' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1rem' }}>
                {(imageTemplates.length > 0 ? imageTemplates : IMAGE_TEMPLATES).map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    aria-pressed={selectedTemplateId === template.id}
                    className={styles.interviewOption}
                    style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem' }}
                    onClick={() => selectImageTemplate(template)}
                  >
                    {template.label}
                  </button>
                ))}
              </div>

              <div style={{ borderTop: '1px solid var(--v07-line)', paddingTop: '0.75rem' }}>
                <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.78rem', color: 'var(--v07-muted)' }}>자세히 정하기</h4>
                <div className={styles.imagePreferenceBar} style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
                  <label>모델 연령
                    <select aria-label="모델 연령" onChange={(event) => updateImagePreference('modelAge', event.target.value as ImagePreferences['modelAge'])} value={imagePreferences.modelAge}>
                      <option value="20s">20대</option><option value="30s">30대</option><option value="40s">40대</option><option value="50plus">50대 이상</option>
                    </select>
                  </label>
                  <label>인물 범위
                    <select aria-label="인물 범위" onChange={(event) => updateImagePreference('framing', event.target.value as ImagePreferences['framing'])} value={imagePreferences.framing}>
                      <option value="face">얼굴 중심</option><option value="upper_body">상반신</option><option value="full_body">전신</option>
                    </select>
                  </label>
                  <label>포즈
                    <select aria-label="포즈" onChange={(event) => updateImagePreference('pose', event.target.value as ImagePreferences['pose'])} value={imagePreferences.pose}>
                      <option value="front">정면</option><option value="side">측면</option><option value="explaining">설명하는 모습</option><option value="consulting">상담 중</option><option value="relaxed">자연스러운 모습</option>
                    </select>
                  </label>
                  <label>배경
                    <select aria-label="배경" onChange={(event) => updateImagePreference('background', event.target.value as ImagePreferences['background'])} value={imagePreferences.background}>
                      <option value="bright_studio">밝은 실내</option><option value="warm_studio">따뜻한 실내</option><option value="treatment_room">작업 공간</option><option value="natural_light">자연광</option><option value="product_space">제품이 보이는 공간</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>
          </details>

          <div className={styles.imagePreferenceBar} style={{ gridTemplateColumns: '1fr', marginBottom: '0.5rem' }}>
            <label>텍스트 요소
              <select aria-label="텍스트 요소" onChange={(event) => updateImagePreference('textOverlay', event.target.value as ImagePreferences['textOverlay'])} value={imagePreferences.textOverlay}>
                <option value="none">사진에 글자 없음</option>
                <option value="short_copy">짧은 문구 자리를 비워 두기 (나중에 정확한 글자로 얹어요)</option>
                <option value="information">정보 문구 자리를 비워 두기 (나중에 정확한 글자로 얹어요)</option>
              </select>
            </label>
            <label className={styles.imageExtraDirection}>추가로 원하는 점
              <input aria-label="이미지에 추가로 원하는 점" maxLength={500} onChange={(event) => updateImagePreference('extraDirection', event.target.value)} placeholder="예: 제품이 자연스럽게 보이게" value={imagePreferences.extraDirection ?? ''} />
            </label>
          </div>
        </section>
      ) : null}

      {showSingleOptions && selectedValue === 'custom' ? (
        <div className={styles.interviewFreeTextBlock}>
          <label>
            <span>원하는 방향을 직접 적어 주세요</span>
            <textarea
              aria-label="콘텐츠 방향 직접 입력"
              className={styles.interviewFreeText}
              disabled={disabled || submitted}
              maxLength={2_000}
              onChange={(event) => {
                setErrorMessage('')
                setFreeText(event.target.value)
              }}
              placeholder="예: 우리 동네에서 차분하게 이야기하고 싶어요"
              ref={freeTextRef}
              rows={3}
              value={freeText}
            />
          </label>
          <button
            className={styles.interviewContinue}
            disabled={disabled || submitted}
            onClick={submitSingleFreeText}
            type="button"
          >
            이 답변으로 계속하기
          </button>
        </div>
      ) : null}

      {showGroupOptions ? (
        <button
          className={styles.interviewContinue}
          disabled={disabled || submitted}
          onClick={submitGroupAnswers}
          type="button"
        >
          이 설정으로 계속하기
        </button>
      ) : null}

      {showReviewSummary ? (
        <section aria-label="소희가 이해한 제작 방향" className={styles.interviewSummary}>
          <h3>소희가 이해한 제작 방향</h3>
          <dl>
            <div><dt>채널</dt><dd>{clarification.summary.channels.map((channel) => channelLabels[channel] ?? channel).join(', ')}</dd></div>
            <div><dt>목표</dt><dd>{clarification.summary.goal}</dd></div>
            {clarification.summary.eventFacts ? <div><dt>이벤트 정보</dt><dd>{clarification.summary.eventFacts}</dd></div> : null}
            <div><dt>대상과 고민</dt><dd>{clarification.summary.audience}</dd></div>
            <div><dt>글 흐름</dt><dd>{clarification.summary.structure}</dd></div>
            <div><dt>이미지 분위기</dt><dd>{clarification.summary.imageMood}</dd></div>
            {clarification.summary.imageTemplate ? <div><dt>이미지 스타일</dt><dd>{clarification.summary.imageTemplate}</dd></div> : null}
            <div><dt>행동 유도</dt><dd>{clarification.summary.callToAction}</dd></div>
            <div><dt>독자의 고민</dt><dd>{clarification.summary.audienceProblem}</dd></div>
            <div><dt>말투</dt><dd>{clarification.summary.tone}</dd></div>
            <div><dt>메시지 방향</dt><dd>{clarification.summary.messageAngle}</dd></div>
            <div><dt>이미지 구도</dt><dd>{clarification.summary.imageComposition}</dd></div>
            <div><dt>참고 이미지</dt><dd>참고 이미지 {clarification.summary.referenceMediaCount}장</dd></div>
            {clarification.summary.imageExtraDirection ? <div><dt>이미지에 추가로 원하는 점</dt><dd>{clarification.summary.imageExtraDirection}</dd></div> : null}
          </dl>
          {clarification.summary.sceneRoles.length > 0 ? (
            <div className={styles.interviewSummaryList}>
              <strong>이미지 장면 역할</strong>
              <ul>{clarification.summary.sceneRoles.map((item) => <li key={`scene-${item}`}>{item}</li>)}</ul>
            </div>
          ) : null}
          {clarification.summary.imageAvoid.length > 0 ? (
            <div className={styles.interviewSummaryList}>
              <strong>이미지에서 피할 장면</strong>
              <ul>{clarification.summary.imageAvoid.map((item) => <li key={`image-avoid-${item}`}>{item}</li>)}</ul>
            </div>
          ) : null}
          {clarification.summary.mustInclude.length > 0 ? (
            <div className={styles.interviewSummaryList}>
              <strong>꼭 담을 내용</strong>
              <ul>{clarification.summary.mustInclude.map((item) => <li key={`include-${item}`}>{item}</li>)}</ul>
            </div>
          ) : null}
          {clarification.summary.mustAvoid.length > 0 ? (
            <div className={styles.interviewSummaryList}>
              <strong>피할 내용</strong>
              <ul>{clarification.summary.mustAvoid.map((item) => <li key={`avoid-${item}`}>{item}</li>)}</ul>
            </div>
          ) : null}
          <div className={styles.interviewSummaryActions}>
            <strong>필요한 부분을 다시 확인할까요?</strong>
            <div>
              {clarification.previousAnswers.map((answer) => (
                <button
                  disabled={disabled || submitted}
                  key={`edit-${answer.step}`}
                  onClick={() => invokeSubmit(
                    serializeContentInterviewControl({ action: 'edit', step: answer.step }),
                    `${answer.step}단계 답변 수정`,
                  )}
                  type="button"
                >
                  {answer.step}단계 수정
                </button>
              ))}
              <button
                className={styles.interviewStartButton}
                disabled={disabled || submitted}
                onClick={() => invokeSubmit(
                  serializeContentInterviewControl({ action: 'start_generation' }),
                  '이 방향으로 제작 시작',
                )}
                type="button"
              >
                이 방향으로 제작 시작
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {clarification.previousAnswers.length > 0 ? (
        <details className={styles.interviewPreviousAnswers}>
          <summary>이전 답변 접기</summary>
          <ul>
            {clarification.previousAnswers.map((answer) => (
              <li key={`previous-${answer.step}`}>
                <strong>{answer.step}단계</strong>
                <span>{answer.label}</span>
                {answer.customText ? <small>{answer.customText}</small> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {isCollecting ? <p className={styles.interviewAttachmentHint}>아래 입력창에서 이미지도 첨부할 수 있어요.</p> : null}
      {errorMessage ? <p className={styles.interviewError} role="alert">{errorMessage}</p> : null}
    </section>
  )
}
