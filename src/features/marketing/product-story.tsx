'use client'

import Image from 'next/image'
import { useState } from 'react'
import { MARKETING_ASSETS } from './v085-assets'
import { PRODUCT_STEPS } from './v085-content'
import styles from './v085-marketing.module.css'

const detailByStep = {
  signal: ['중요 고객', '응답 기한', '원문 근거'],
  intent: ['예약 가능성', '가격 질문', '사람 확인 조건'],
  drafts: ['빠르고 짧게', '따뜻하고 친절하게', '상담으로 이어지게'],
  revise: ['사장님 말투', '서비스 정보', '확인할 표현'],
  booking: ['상담 질문', '가능 시간', '고객 확인'],
  content: ['반복 질문', '채널별 형식', '승인할 버전'],
  growth: ['문의 기여', '예약 기여', '다음 실험'],
} as const

const assetByStep = {
  signal: MARKETING_ASSETS.customerSignal,
  intent: MARKETING_ASSETS.customerSignal,
  drafts: MARKETING_ASSETS.replyBooking,
  revise: MARKETING_ASSETS.replyBooking,
  booking: MARKETING_ASSETS.replyBooking,
  content: MARKETING_ASSETS.questionToContent,
  growth: MARKETING_ASSETS.growthBriefing,
} as const

export function ProductStory() {
  const [selectedId, setSelectedId] = useState<(typeof PRODUCT_STEPS)[number]['id']>('signal')
  const selected = PRODUCT_STEPS.find((step) => step.id === selectedId) ?? PRODUCT_STEPS[0]
  const asset = assetByStep[selected.id]

  return <section aria-labelledby="product-story-title" className={styles.productStory} id="operations">
    <header className={styles.sectionHeading}><p>고객 반응이 다음 성장 행동이 되는 과정</p><h2 id="product-story-title">소희가 실제로 일하는 일곱 장면을 둘러보세요.</h2><span>지금 선택한 고객과 콘텐츠 문맥에서 소희에게 말하면 다음 상태로 이어집니다.</span></header>
    <div className={styles.productStoryLayout}>
      <ol aria-label="소희 제품 흐름" className={styles.productSteps}>{PRODUCT_STEPS.map((step, index) => <li key={step.id}><button aria-pressed={selected.id === step.id} onClick={() => setSelectedId(step.id)} type="button"><span>{String(index + 1).padStart(2, '0')}</span><strong>{step.title}</strong><small>{step.action}</small></button></li>)}</ol>
      <article aria-live="polite" className={styles.productStage}><div className={styles.productStageMedia}><Image alt={asset.alt} height={asset.height} sizes="(max-width: 760px) 100vw, 54vw" src={asset.src} width={asset.width} /></div><div className={styles.productStageCopy}><p>{selected.action}</p><h3>{selected.title}</h3><span>{selected.description}</span><ul>{detailByStep[selected.id].map((item) => <li key={item}>{item}</li>)}</ul></div></article>
    </div>
  </section>
}
