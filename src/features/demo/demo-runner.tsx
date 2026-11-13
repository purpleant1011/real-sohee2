'use client'

import { useState } from 'react'
import { advanceDemo, resetDemo, type DemoStep } from './demo-machine'
import styles from './demo.module.css'

const demoStages = [
  {
    title: '기회 발견',
    currentWork: '오늘 소개할 메뉴와 고객에게 전할 이야기를 골랐습니다.',
    nextAction: '선택한 이야기로 초안을 준비합니다.',
  },
  {
    title: '초안 준비',
    currentWork: '가게의 말투에 맞춘 짧은 게시글 초안을 만들었습니다.',
    nextAction: '게시 전에 사장님의 확인을 받습니다.',
  },
  {
    title: '승인 확인',
    currentWork: '게시할 내용과 표현을 함께 확인했습니다.',
    nextAction: '확인한 내용으로 게시 준비를 마칩니다.',
  },
  {
    title: '게시 준비',
    currentWork: '채널별로 필요한 문구와 이미지를 정리했습니다.',
    nextAction: '반응을 살펴볼 수 있도록 성과를 정리합니다.',
  },
  {
    title: '성과 정리',
    currentWork: '다음 운영 판단에 쓸 수 있도록 반응을 보기 좋게 묶었습니다.',
    nextAction: '체험이 완료되었습니다.',
  },
] as const

function isCompleted(step: DemoStep) {
  return step === 5
}

export function DemoRunner() {
  const [step, setStep] = useState<DemoStep>(0)
  const currentStage = demoStages[Math.min(step, demoStages.length - 1)]
  const completed = isCompleted(step)

  function handleAdvance() {
    setStep((currentStep) => advanceDemo(currentStep))
  }

  function handleReset() {
    setStep(resetDemo())
  }

  return (
    <section className={styles.demo} aria-labelledby="demo-title">
      <div className={styles.intro}>
        <p className={styles.kicker}>예시 데이터로 살펴보는 소희</p>
        <h1 id="demo-title">5단계 무료 체험</h1>
        <p>가게의 일상에서 마케팅 준비가 어떻게 이어지는지, 저장하거나 전송하지 않는 예시 흐름으로 확인해 보세요.</p>
      </div>

      <div className={styles.workspace}>
        <div className={styles.progressHeader}>
          <div>
            <p className={styles.eyebrow}>진행 상황</p>
            <p className={styles.progressText} aria-label={`전체 5단계 중 ${step}단계 완료`}>
              {step} / 5
            </p>
          </div>
          <p className={styles.memoryNotice}>브라우저를 새로고침하면 처음으로 돌아갑니다.</p>
        </div>

        <div
          aria-label={`전체 5단계 중 ${step}단계 완료`}
          aria-valuemax={5}
          aria-valuemin={0}
          aria-valuenow={step}
          className={styles.progressBar}
          role="progressbar"
        >
          <span className={styles.progressFill} style={{ inlineSize: `${step * 20}%` }} />
        </div>
        <p aria-atomic="true" aria-live="polite" className={styles.liveStatus} role="status">
          {step === 0 ? '' : `5단계 중 ${step}단계 완료`}
        </p>

        <ol className={styles.stageList} aria-label="무료 체험 단계">
          {demoStages.map((stage, index) => {
            const stageNumber = index + 1
            const stageState = step >= stageNumber ? 'completed' : step === index ? 'current' : 'upcoming'

            return (
              <li className={styles.stage} data-state={stageState} key={stage.title}>
                <span aria-hidden="true" className={styles.stageNumber}>
                  {stageNumber}
                </span>
                <span>{stage.title}</span>
              </li>
            )
          })}
        </ol>

        {completed ? (
          <div className={styles.completion}>
            <p className={styles.completionLabel}>체험 완료</p>
            <h2>운영의 흐름을 한 번에 살펴봤습니다.</h2>
            <p>이 화면의 내용은 모두 예시이며, 실제 가게 정보나 성과 수치, 날짜를 바꾸지 않습니다.</p>
            <p className={styles.assurance}>예시 데이터 · 외부 전송 없음</p>
            <p className={styles.assurance}>저장되지 않음</p>
            <button className={styles.secondaryButton} type="button" onClick={handleReset}>
              처음부터 다시 보기
            </button>
          </div>
        ) : (
          <div className={styles.stageDetail}>
            <p className={styles.eyebrow}>현재 작업</p>
            <h2>{currentStage.title}</h2>
            <p>{currentStage.currentWork}</p>
            <div className={styles.nextAction}>
              <p className={styles.eyebrow}>다음 행동</p>
              <p>{currentStage.nextAction}</p>
            </div>
            <button className={styles.primaryButton} type="button" onClick={handleAdvance}>
              다음 단계
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
