'use client'

import Image from 'next/image'
import { useState } from 'react'
import { MARKETING_ASSETS } from './v085-assets'
import { INDUSTRIES, type IndustrySlug } from './v085-content'
import styles from './v085-marketing.module.css'

const assetByIndustry = { beauty: MARKETING_ASSETS.beauty, food: MARKETING_ASSETS.food, education: MARKETING_ASSETS.education, 'local-service': MARKETING_ASSETS.localService } as const

export function IndustrySwitcher() {
  const [selectedSlug, setSelectedSlug] = useState<IndustrySlug>('beauty')
  const selected = INDUSTRIES.find((industry) => industry.slug === selectedSlug) ?? INDUSTRIES[0]
  const asset = assetByIndustry[selected.slug]

  function choose(slug: IndustrySlug) {
    setSelectedSlug(slug)
    const url = new URL(window.location.href)
    url.searchParams.set('industry', slug)
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }

  return <section aria-labelledby="industry-title" className={styles.industrySection} id="industries">
    <header className={styles.sectionHeading}><p>내 업종에서는 어떻게 달라질까요?</p><h2 id="industry-title">같은 기능이 아니라, 업종마다 다른 고객 행동을 연결합니다.</h2></header>
    <div aria-label="업종 선택" className={styles.industryTabs} role="tablist">{INDUSTRIES.map((industry) => <button aria-controls="industry-panel" aria-selected={selected.slug === industry.slug} key={industry.slug} onClick={() => choose(industry.slug)} role="tab" type="button">{industry.label}</button>)}</div>
    <article aria-live="polite" className={styles.industryPanel} id="industry-panel" role="tabpanel"><div className={styles.industryMedia}><Image alt={asset.alt} height={asset.height} sizes="(max-width: 760px) 100vw, 58vw" src={asset.src} width={asset.width} /></div><div className={styles.industryCopy}><p>{selected.label}</p><h3>{selected.headline}</h3><dl><div><dt>고객 질문</dt><dd>{selected.customerQuestion}</dd></div><div><dt>놓치기 쉬운 순간</dt><dd>{selected.missedAction}</dd></div><div><dt>소희의 다음 행동</dt><dd>{selected.soheeAction}</dd></div><div><dt>이어지는 결과</dt><dd>{selected.outcome}</dd></div></dl></div></article>
  </section>
}
