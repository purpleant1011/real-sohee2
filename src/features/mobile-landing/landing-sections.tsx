'use client'

import { useState, type ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, Check, ShieldCheck } from 'lucide-react'
import { MARKETING_ASSETS } from '@/features/marketing/v085-assets'
import {
  CHANNEL_CAPABILITIES,
  INDUSTRIES,
  MARKETING_COPY,
  PLAN_COMPARISON,
  PRODUCT_STEPS,
} from '@/features/marketing/v085-content'

type Asset = (typeof MARKETING_ASSETS)[keyof typeof MARKETING_ASSETS]

function Photo({ asset, className, priority = false }: { asset: Asset; className?: string; priority?: boolean }) {
  return (
    <Image
      alt={asset.alt}
      src={asset.src}
      width={asset.width}
      height={asset.height}
      sizes="(max-width: 672px) calc(100vw - 32px), 672px"
      priority={priority}
      className={className ?? 'h-auto w-full rounded-2xl'}
    />
  )
}

function SectionHead({ eyebrow, title, id }: { eyebrow: string; title: string; id: string }) {
  return (
    <header className="space-y-1.5">
      <p className="text-xs font-semibold tracking-wide text-primary">{eyebrow}</p>
      <h2 id={id} className="text-xl font-semibold leading-snug tracking-tight">{title}</h2>
    </header>
  )
}

function Block({ id, children }: { id: string; children: ReactNode }) {
  return <section aria-labelledby={id} className="space-y-4">{children}</section>
}

const PAIN_CHIPS = ['인스타그램 확인', '네이버 리뷰 답변', '당근 소식 작성', '예약 확인', '성과 정리'] as const

const FRAGMENTED = [
  '인스타그램 댓글과 메시지 확인',
  '네이버 플레이스 리뷰 확인',
  '카카오톡 문의 답변',
  '당근 소식 작성',
  '이번 주 게시물 고민',
  '문의와 예약 결과 별도 정리',
] as const

const BEFORE_AFTER = [
  ['채널마다 들어가 상태 확인', '오늘 놓치면 안 되는 일부터 확인'],
  ['댓글과 메시지를 뒤늦게 발견', '중요 고객과 응답 기한을 먼저 확인'],
  ['같은 설명을 다시 작성', '하나의 이야기를 채널별로 준비'],
  ['게시 뒤 좋아요만 확인', '문의·예약·재방문 흐름까지 확인'],
  ['자동화 결과가 불안함', '대상과 버전을 확인하고 승인'],
] as const

const STEP_IMAGES: Record<string, Asset | undefined> = {
  signal: MARKETING_ASSETS.customerSignal,
  booking: MARKETING_ASSETS.replyBooking,
  content: MARKETING_ASSETS.questionToContent,
  growth: MARKETING_ASSETS.growthBriefing,
}

const INDUSTRY_IMAGES: Record<string, Asset> = {
  beauty: MARKETING_ASSETS.beauty,
  food: MARKETING_ASSETS.food,
  education: MARKETING_ASSETS.education,
  'local-service': MARKETING_ASSETS.localService,
}

const FAQ = [
  ['소희가 모든 채널에 자동으로 올리나요?', '아니요. 공식 연결, 감독형 실행, 사장님 최종 게시를 구분하고 정확한 대상과 버전을 확인한 뒤에만 진행해요.'],
  ['채널 비밀번호를 소희에 입력해야 하나요?', '아니요. 비밀번호와 인증 번호, 보호된 세션 값을 소희가 수집하거나 저장하지 않아요.'],
  ['가입하면 모든 채널을 바로 연결해야 하나요?', '아니요. 가게 정보와 첫 고민을 알려주시면 고객 답변이나 첫 주간 계획부터 시작할 수 있어요.'],
  ['무료 진단은 실제 채널을 분석하나요?', '첫 단계는 입력하신 내용을 바탕으로 한 예비 진단이에요. 실제 공개 자료를 확인했을 때만 확인 범위와 근거를 따로 표시해요.'],
] as const

export function LandingHero() {
  return (
    <section aria-label="소희 소개" className="space-y-4">
      <div className="space-y-3">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          사장님의 통합 마케팅 운영실
        </p>
        <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight">
          사장님은 가게에.<br />마케팅은 소희에게.
        </h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          {MARKETING_COPY.heroDescription}
        </p>
      </div>
      <Photo asset={MARKETING_ASSETS.hero} priority className="h-auto w-full rounded-3xl border border-border shadow-sm" />
      <ul aria-label="시작 전 확인" className="grid grid-cols-2 gap-2">
        {MARKETING_COPY.trustPoints.map(point => (
          <li key={point} className="flex items-start gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs leading-snug">
            <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-primary" />
            {point}
          </li>
        ))}
      </ul>
      <Link
        href="/diagnosis"
        className="flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-primary/40 bg-primary/5 px-4 text-sm font-semibold text-primary"
      >
        내 매장 무료 진단하기 <ArrowRight aria-hidden="true" className="size-4" />
      </Link>
    </section>
  )
}

export function LandingPain() {
  return (
    <>
      <div
        role="region"
        aria-label="흩어진 업무가 소희 한곳으로 모이는 과정"
        tabIndex={0}
        className="-mx-4 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none]"
      >
        {PAIN_CHIPS.map(item => (
          <span key={item} className="shrink-0 rounded-full border border-border bg-card px-3 py-2 text-xs text-muted-foreground line-through decoration-primary/60">
            {item}
          </span>
        ))}
        <strong className="shrink-0 rounded-full bg-primary px-3 py-2 text-xs text-primary-foreground">이제 소희 한곳에서.</strong>
      </div>

      <Block id="m-pain-title">
        <SectionHead id="m-pain-title" eyebrow="사장님의 실제 하루에서 시작해요" title="혹시 지금도 이렇게 일하고 계신가요?" />
        <Photo asset={MARKETING_ASSETS.fragmentedDay} />
        <ol className="grid gap-2">
          {FRAGMENTED.map((task, index) => (
            <li key={task} className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-sm">
              <span aria-hidden="true" className="text-xs font-bold text-primary">{String(index + 1).padStart(2, '0')}</span>
              {task}
            </li>
          ))}
        </ol>
      </Block>

      <Block id="m-organized-title">
        <SectionHead id="m-organized-title" eyebrow="한 화면에서 상태를 보고 다음 일을 정해요" title="콘텐츠를 더 만드는 게 아니라, 고객을 놓치지 않는 운영을 만들어요." />
        <Photo asset={MARKETING_ASSETS.organizedDay} />
      </Block>

      <Block id="m-compare-title">
        <SectionHead id="m-compare-title" eyebrow="소희가 바꾸는 일하는 방식" title="여러 번의 화면 전환을 한 번의 성장 흐름으로." />
        <ul className="space-y-2">
          {BEFORE_AFTER.map(([before, after]) => (
            <li key={before} className="overflow-hidden rounded-2xl border border-border bg-card text-sm">
              <p className="px-4 py-2.5 text-muted-foreground">{before}</p>
              <p className="flex items-start gap-2 border-t border-border bg-primary/5 px-4 py-2.5 font-medium">
                <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
                {after}
              </p>
            </li>
          ))}
        </ul>
      </Block>
    </>
  )
}

export function LandingStory() {
  return (
    <Block id="m-story-title">
      <SectionHead id="m-story-title" eyebrow="소희와 일하는 하루" title="문의 하나가 예약과 다음 콘텐츠가 되기까지." />
      <ol className="space-y-4">
        {PRODUCT_STEPS.map((step, index) => {
          const image = STEP_IMAGES[step.id]
          return (
            <li key={step.id} className="space-y-2 rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="grid size-6 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{index + 1}</span>
                <h3 className="text-base font-semibold">{step.title}</h3>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">{step.description}</p>
              {image ? <Photo asset={image} className="h-auto w-full rounded-xl" /> : null}
            </li>
          )
        })}
      </ol>
    </Block>
  )
}

export function LandingIndustries() {
  const [slug, setSlug] = useState<string>(INDUSTRIES[0].slug)
  const current = INDUSTRIES.find(item => item.slug === slug) ?? INDUSTRIES[0]
  return (
    <Block id="m-industry-title">
      <SectionHead id="m-industry-title" eyebrow="업종별 경험" title="우리 가게 업종에서는 이렇게 달라져요." />
      <div role="tablist" aria-label="업종 선택" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
        {INDUSTRIES.map(item => (
          <button
            key={item.slug}
            type="button"
            role="tab"
            id={`m-industry-tab-${item.slug}`}
            aria-selected={item.slug === slug}
            aria-controls="m-industry-panel"
            onClick={() => setSlug(item.slug)}
            className="min-h-11 shrink-0 rounded-full border border-border bg-card px-4 text-sm font-medium aria-selected:border-primary aria-selected:bg-primary aria-selected:text-primary-foreground"
          >
            {item.label}
          </button>
        ))}
      </div>
      <div id="m-industry-panel" role="tabpanel" aria-labelledby={`m-industry-tab-${current.slug}`} className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <Photo asset={INDUSTRY_IMAGES[current.slug]} className="h-auto w-full rounded-xl" />
        <h3 className="text-base font-semibold">{current.headline}</h3>
        <p className="rounded-xl bg-muted px-3 py-2 text-sm">“{current.customerQuestion}”</p>
        <p className="text-sm text-muted-foreground"><strong className="text-foreground">놓치기 쉬운 순간 · </strong>{current.missedAction}</p>
        <p className="text-sm text-muted-foreground"><strong className="text-foreground">소희가 하는 일 · </strong>{current.soheeAction}</p>
        <ul className="flex flex-wrap gap-1.5">
          {current.recommendedTopics.map(topic => (
            <li key={topic} className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">{topic}</li>
          ))}
        </ul>
      </div>
    </Block>
  )
}

export function LandingTrust() {
  return (
    <>
      <Block id="m-channel-title">
        <SectionHead id="m-channel-title" eyebrow="연결 채널" title="채널마다 가능한 범위를 솔직하게 알려드려요." />
        <ul className="space-y-2">
          {CHANNEL_CAPABILITIES.map(channel => (
            <li key={channel.id} className="space-y-1 rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold">{channel.name}</h3>
                <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{channel.mode}</span>
              </div>
              <p className="text-sm text-muted-foreground">{channel.soheeWork}</p>
              <p className="text-xs text-muted-foreground">사장님 확인 · {channel.ownerFinish}</p>
            </li>
          ))}
        </ul>
      </Block>

      <Block id="m-proof-title">
        <SectionHead id="m-proof-title" eyebrow="위임해도 안전한 이유" title="정확한 대상과 버전, 결과까지 확인해요." />
        <Photo asset={MARKETING_ASSETS.delegationReceipt} />
        <ul className="space-y-2 text-sm">
          {['사장님이 승인한 내용만 다음 단계로 넘어가요', '실행 결과와 복구 방법을 기록으로 확인해요', '채널 비밀번호는 소희가 저장하지 않아요'].map(text => (
            <li key={text} className="flex items-start gap-2"><ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />{text}</li>
          ))}
        </ul>
      </Block>
    </>
  )
}

export function LandingPlans() {
  return (
    <Block id="m-plan-title">
      <SectionHead id="m-plan-title" eyebrow="요금" title="작게 시작해서 필요한 만큼 키워요." />
      <ul className="-mx-4 flex snap-x scroll-pl-4 gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {PLAN_COMPARISON.map(plan => (
          <li key={plan.id} className="w-60 shrink-0 snap-start space-y-1.5 rounded-2xl border border-border bg-card p-4 text-sm">
            <h3 className="text-base font-semibold">{plan.name}</h3>
            <p className="text-lg font-bold text-primary">{plan.price}</p>
            <p className="text-muted-foreground">채널 · {plan.channels}</p>
            <p className="text-muted-foreground">고객 응대 · {plan.customer}</p>
            <p className="text-muted-foreground">콘텐츠 · {plan.content}</p>
            <p className="text-muted-foreground">리포트 · {plan.report}</p>
          </li>
        ))}
      </ul>
      <Link href="/pricing" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-2">요금 자세히 보기</Link>
    </Block>
  )
}

export function LandingFaq() {
  return (
    <Block id="m-faq-title">
      <SectionHead id="m-faq-title" eyebrow="시작 전에 많이 묻는 질문" title="자동화 범위와 자료 경계를 먼저 확인하세요." />
      <div className="space-y-2">
        {FAQ.map(([question, answer]) => (
          <details key={question} className="group rounded-2xl border border-border bg-card px-4">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
              {question}
              <span aria-hidden="true" className="text-primary transition-transform group-open:rotate-45">+</span>
            </summary>
            <p className="pb-3 text-sm leading-relaxed text-muted-foreground">{answer}</p>
          </details>
        ))}
      </div>
    </Block>
  )
}

const FOOTER_LINKS = [
  ['/product', '제품 소개'],
  ['/channels', '연결 채널'],
  ['/pricing', '요금 안내'],
  ['/data-deletion', '사용자 데이터 삭제'],
  ['/refund', '환불 안내'],
  ['/payment-info', '결제 안내'],
  ['/business-info', '사업자 정보'],
] as const

export function LandingFinal({ signedIn }: { signedIn: boolean }) {
  return (
    <>
      <section aria-labelledby="m-final-title" className="space-y-3 rounded-3xl bg-primary/5 p-4">
        <Photo asset={MARKETING_ASSETS.finalPlan} />
        <p className="text-xs font-semibold text-primary">소희와 시작하는 첫 주</p>
        <h2 id="m-final-title" className="text-xl font-semibold leading-snug tracking-tight">오늘 고객을 놓치지 않고, 이번 주 마케팅을 끝내세요.</h2>
        <div className="flex flex-col gap-2">
          <Link href="/diagnosis" className="flex min-h-12 items-center justify-center rounded-xl border border-primary/40 text-sm font-semibold text-primary">내 매장 마케팅 상태 진단하기</Link>
          {signedIn ? null : (
            <Link href="/signup?next=/start" className="flex min-h-12 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground">회원가입하고 소희 시작하기</Link>
          )}
        </div>
      </section>
      <footer className="space-y-3 pb-2 text-center">
        <p className="text-sm font-semibold">소희</p>
        <p className="text-xs text-muted-foreground">여러 채널의 고객 반응을 답변, 예약, 콘텐츠와 다음 성장으로 연결합니다.</p>
        <nav aria-label="정책 및 안내" className="flex flex-wrap justify-center gap-x-1">
          {FOOTER_LINKS.map(([href, label]) => (
            <Link key={href} href={href} className="inline-flex min-h-11 items-center px-2 text-xs text-muted-foreground underline underline-offset-2">{label}</Link>
          ))}
        </nav>
      </footer>
    </>
  )
}
