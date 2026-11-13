'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, Check, MessageCircleMore, ShieldCheck } from 'lucide-react'
import { MARKETING_ASSETS } from './v085-assets'
import { MARKETING_COPY } from './v085-content'
import { ProductStory } from './product-story'
import { IndustrySwitcher } from './industry-switcher'
import { ChannelCapabilityTable } from './channel-capability-table'
import { DelegationProof } from './delegation-proof'
import styles from './v085-marketing.module.css'

const fragmentedTasks = [
  '인스타그램 댓글과 메시지 확인',
  '네이버 플레이스 리뷰 확인',
  '카카오톡 문의 답변',
  '당근 소식 작성',
  '이번 주 게시물 고민',
  '문의와 예약 결과 별도 정리',
] as const

const comparisonRows = [
  ['채널마다 들어가 상태 확인', '오늘 화면에서 놓치면 안 되는 일부터 확인'],
  ['댓글과 메시지를 뒤늦게 발견', '중요 고객과 응답 기한을 먼저 확인'],
  ['같은 설명을 다시 작성', '하나의 이야기를 채널별 문법으로 준비'],
  ['게시 뒤 좋아요만 확인', '문의, 예약과 재방문 흐름까지 확인'],
  ['자동화 결과가 불안함', '대상, 버전과 외부 영향을 확인하고 승인'],
  ['실패 뒤 어디서부터 볼지 모름', '보관된 내용과 안전한 복구 방법 확인'],
] as const

function MarketingImage({
  asset,
  className,
  sizes,
}: Readonly<{
  asset: (typeof MARKETING_ASSETS)[keyof typeof MARKETING_ASSETS]
  className?: string
  sizes: string
}>) {
  return (
    <Image
      alt={asset.alt}
      className={className}
      height={asset.height}
      priority={asset.priority}
      sizes={sizes}
      src={asset.src}
      width={asset.width}
    />
  )
}

export function V085MarketingHome() {
  return (
    <div className={styles.page}>
      <section aria-labelledby="home-title" className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.heroPrelude}>사장님의 통합 마케팅 운영실</p>
          <h1 id="home-title">{MARKETING_COPY.heroTitle}</h1>
          <p className={styles.heroDescription}>{MARKETING_COPY.heroDescription}</p>
          <p className={styles.heroSupport}>{MARKETING_COPY.heroSupport}</p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryAction} data-cta data-primary-cta href="/diagnosis">
              {MARKETING_COPY.primaryCta} <ArrowRight aria-hidden="true" size={18} />
            </Link>
            <Link className={styles.secondaryAction} data-cta href="/product#operations">
              {MARKETING_COPY.secondaryCta}
            </Link>
            <Link className={styles.textAction} data-cta href="/signup">
              {MARKETING_COPY.signupCta}
            </Link>
          </div>
          <ul aria-label="시작 전 확인" className={styles.trustList}>
            {MARKETING_COPY.trustPoints.map((point) => (
              <li key={point}><Check aria-hidden="true" size={15} />{point}</li>
            ))}
          </ul>
        </div>
        <div className={styles.heroVisual}>
          <MarketingImage asset={MARKETING_ASSETS.hero} sizes="(max-width: 760px) 100vw, 58vw" />
          <div className={styles.heroVisualNote}>
            <span aria-hidden="true">S.</span>
            <p><strong>소희가 하는 일</strong><small>신호를 모으고, 다음 행동과 결과를 연결해요.</small></p>
          </div>
        </div>
      </section>

      <section aria-label="흩어진 업무가 소희 한곳으로 모이는 과정" className={styles.painStrip} tabIndex={0}>
        {['인스타그램 확인', '네이버 리뷰 답변', '당근 소식 작성', '예약 확인', '성과 정리'].map((item) => (
          <span key={item}>{item}</span>
        ))}
        <strong>이제 소희 한곳에서.</strong>
      </section>

      <section aria-labelledby="pain-title" className={styles.storySection}>
        <header className={styles.sectionHeading}>
          <p>사장님의 실제 하루에서 시작합니다</p>
          <h2 id="pain-title">혹시 지금도 이렇게 일하고 있나요?</h2>
          <span>고객을 만나고 매장을 운영하면서, 흩어진 마케팅 화면까지 직접 챙기고 있지는 않나요?</span>
        </header>
        <div className={styles.fragmentedStory}>
          <div className={styles.storyMedia}>
            <MarketingImage asset={MARKETING_ASSETS.fragmentedDay} sizes="(max-width: 760px) 100vw, 58vw" />
          </div>
          <ol className={styles.fragmentedTasks}>
            {fragmentedTasks.map((task, index) => (
              <li key={task}><span>{String(index + 1).padStart(2, '0')}</span>{task}</li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="organized-title" className={styles.organizedSection}>
        <div className={styles.organizedCopy}>
          <p>한 화면에서 상태를 보고, 소희와 다음 일을 결정합니다</p>
          <h2 id="organized-title">콘텐츠를 더 만드는 게 아니라, 고객을 놓치지 않는 운영을 만듭니다.</h2>
          <ul>
            <li><MessageCircleMore aria-hidden="true" />지금 답해야 할 고객부터 모아보기</li>
            <li><Check aria-hidden="true" />정확한 대상과 버전을 확인하고 위임하기</li>
            <li><ShieldCheck aria-hidden="true" />실행 결과와 복구 방법까지 증거로 확인하기</li>
          </ul>
        </div>
        <div className={styles.organizedMedia}>
          <MarketingImage asset={MARKETING_ASSETS.organizedDay} sizes="(max-width: 760px) 100vw, 58vw" />
        </div>
      </section>

      <section aria-labelledby="before-after-title" className={styles.comparisonSection}>
        <header className={styles.sectionHeading}>
          <p>소희가 바꾸는 일하는 방식</p>
          <h2 id="before-after-title">여섯 번의 화면 전환을 한 번의 성장 흐름으로.</h2>
        </header>
        <div className={styles.comparisonWrap} role="region" aria-label="소희 사용 전과 후 비교 표" tabIndex={0}>
          <table aria-label="소희 사용 전과 후">
            <thead><tr><th scope="col">소희 사용 전</th><th scope="col">소희 사용 후</th></tr></thead>
            <tbody>
              {comparisonRows.map(([before, after]) => (
                <tr key={before}><td>{before}</td><td><Check aria-hidden="true" size={17} />{after}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <ProductStory />
      <IndustrySwitcher />
      <ChannelCapabilityTable />
      <DelegationProof />
      <section aria-labelledby="final-cta-title" className={styles.finalSection}>
        <div className={styles.finalMedia}><MarketingImage asset={MARKETING_ASSETS.finalPlan} sizes="(max-width: 760px) 100vw, 56vw" /></div>
        <div className={styles.finalCopy}><p>소희와 시작하는 첫 주</p><h2 id="final-cta-title">오늘 고객을 놓치지 않고, 이번 주 마케팅을 끝내세요.</h2><span>무료 진단으로 내 매장의 고객 질문과 놓치기 쉬운 행동을 먼저 확인한 뒤, 소희와 답변 또는 주간 계획을 이어가세요.</span><div><Link className={styles.primaryAction} href="/diagnosis">내 매장 마케팅 상태 진단하기</Link><Link className={styles.secondaryAction} href="/signup">회원가입하고 소희 시작하기</Link></div></div>
      </section>
      <section aria-labelledby="faq-title" className={styles.faqSection}><header className={styles.sectionHeading}><p>시작 전에 많이 묻는 질문</p><h2 id="faq-title">자동화 범위와 자료 경계를 먼저 확인하세요.</h2></header><div>{[
        ['소희가 모든 채널에 자동으로 게시하나요?', '아니요. 공식 연결, 감독형 실행과 사용자 최종 게시를 구분하고, 정확한 대상과 버전을 확인한 뒤에만 진행합니다.'],
        ['채널 비밀번호를 소희에 입력해야 하나요?', '아니요. 비밀번호, 인증 번호와 보호된 세션 값을 소희가 수집하거나 저장하지 않습니다.'],
        ['무료 진단은 실제 채널을 분석하나요?', '첫 단계는 입력 내용을 바탕으로 만든 예비 진단입니다. 실제 공개 자료를 확인한 경우에만 확인 범위와 근거를 따로 표시합니다.'],
        ['가입하면 모든 채널을 바로 연결해야 하나요?', '아니요. 사업 정보와 첫 문제를 확인한 뒤 고객 답변 또는 첫 주간 계획부터 시작할 수 있습니다.'],
      ].map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div></section>
    </div>
  )
}
