'use client'

import React, { useState, useEffect, useRef } from 'react'
import styles from './v085-command-center.module.css'

export interface CompiledPlan {
  id: string
  instruction: string
  goal: string
  executionSteps: string[]
  autoAllowed: string[]
  approvalRequired: string[]
  estimatedCredits: string
}

const QUICK_CHIPS = [
  '화·목 오후 빈 예약 채워줘',
  '가을 트렌드 인스타 이벤트 기획해줘',
  '오늘 미응답 고객 먼저 챙겨줘',
  '이번 주 업무 예산 아껴줘',
]

/**
 * 계획 수립 API 가 아직 이 화면에 연결되지 않았다.
 * 샘플 계획을 결과처럼 보여주지 않고, 연결 전이라는 사실을 그대로 안내한다.
 */
export const PLAN_NOT_CONNECTED_MESSAGE = '계획 세우기가 아직 연결되지 않았어요.'

export function V085CommandCenter() {
  const [inputText, setInputText] = useState('')
  const [isCompiling, setIsCompiling] = useState(false)
  const [compiledPlan, setCompiledPlan] = useState<CompiledPlan | null>(null)
  const [planUnavailable, setPlanUnavailable] = useState(false)
  const [isVoiceActive, setIsVoiceActive] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      } else if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleCommandSubmit = (textToSubmit?: string) => {
    const text = textToSubmit ?? inputText
    if (!text.trim()) return

    // 실제 계획 수립 경로가 연결되기 전에는 계획을 만들어 낸 척하지 않는다.
    setIsCompiling(false)
    setCompiledPlan(null)
    setPlanUnavailable(true)
  }

  const toggleVoice = () => {
    setIsVoiceActive(!isVoiceActive)
  }

  return (
    <section className={styles.commandSection} aria-labelledby="command-center-title">
      <div className={styles.sectionHeader}>
        <div className={styles.titleGroup}>
          <span className={styles.headerTag}>⚡ 실시간 지시 인터페이스</span>
          <h2 id="command-center-title" className={styles.sectionTitle}>
            소희에게 지시하기 (명령 센터)
          </h2>
          <p className={styles.sectionDesc}>
            사장님이 자연어로 지시하면, 소희가 목표·실행계획·예산이 포함된 자동화 규칙으로 변환해 드려요.
          </p>
        </div>
      </div>

      {/* Quick Prompt Chips */}
      <div className={styles.chipsRow} role="group" aria-label="빠른 추천 지시 목록">
        {QUICK_CHIPS.map((chip, idx) => (
          <button
            key={idx}
            type="button"
            className={styles.chipButton}
            onClick={() => {
              setInputText(chip)
              handleCommandSubmit(chip)
            }}
          >
            💬 {chip}
          </button>
        ))}
      </div>

      {/* Command Input Bar */}
      <form
        className={styles.inputForm}
        onSubmit={(e) => {
          e.preventDefault()
          handleCommandSubmit()
        }}
      >
        <div className={styles.inputWrapper}>
          <input
            ref={inputRef}
            type="text"
            className={styles.textInput}
            placeholder="소희에게 이번 주 마케팅 목표나 업무를 지시하세요 (예: 화·목 빈 예약 채워줘)"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            aria-label="소희에게 지시할 내용 입력"
          />
          <button
            type="button"
            className={`${styles.voiceButton} ${isVoiceActive ? styles.voiceActive : ''}`}
            onClick={toggleVoice}
            title="음성으로 지시하기 (Push to talk)"
            aria-pressed={isVoiceActive}
          >
            {isVoiceActive ? '🔴 듣는 중...' : '🎙️'}
          </button>
        </div>
        <button
          type="submit"
          className={styles.submitButton}
          disabled={!inputText.trim() || isCompiling}
        >
          {isCompiling ? '계획 수립 중...' : '지시하기'}
        </button>
      </form>

      {/* 계획 수립 경로가 연결되기 전 안내. 샘플 계획으로 대체하지 않는다. */}
      {planUnavailable && !compiledPlan && (
        <p role="status" className={styles.sectionDesc}>
          {PLAN_NOT_CONNECTED_MESSAGE} 지시하신 내용은 저장되지 않았어요. 계획 세우기가 연결되면 다시 안내드릴게요.
        </p>
      )}

      {/* Compiled Plan Card (Rule Compiler Result) */}
      {compiledPlan && (
        <div className={styles.planCard} aria-live="polite">
          <div className={styles.planHeader}>
            <span className={styles.planTag}>📋 소희가 이해한 실행 계획 (자동화 변환안)</span>
            <h3 className={styles.planTitle}>&ldquo;{compiledPlan.instruction}&rdquo;</h3>
          </div>

          <div className={styles.planSection}>
            <strong className={styles.sectionLabel}>🎯 핵심 목표</strong>
            <p className={styles.goalText}>{compiledPlan.goal}</p>
          </div>

          <div className={styles.planSection}>
            <strong className={styles.sectionLabel}>🚀 구체적 실행 방안</strong>
            <ul className={styles.stepsList}>
              {compiledPlan.executionSteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ul>
          </div>

          <div className={styles.rulesComparisonGrid}>
            <div className={styles.safeBox}>
              <strong className={styles.safeLabel}>✓ 안전 자동 실행 범위</strong>
              <ul>
                {compiledPlan.autoAllowed.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>

            <div className={styles.approvalBox}>
              <strong className={styles.approvalLabel}>⚠️ 사장님 확인 후 실행</strong>
              <ul>
                {compiledPlan.approvalRequired.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className={styles.budgetEstimateRow}>
            <span className={styles.budgetLabel}>예상 업무 크레딧:</span>
            <strong className={styles.budgetValue}>{compiledPlan.estimatedCredits}</strong>
          </div>

          {/* 적용 버튼은 실제 저장 API 가 연결된 뒤에만 노출한다. 지금은 성공을 흉내내지 않는다. */}
          <div className={styles.planActions}>
            <button
              type="button"
              className={styles.editPlanButton}
              onClick={() => setCompiledPlan(null)}
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
