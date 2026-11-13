'use client'

import { useState } from 'react'
import Link from 'next/link'
import { StateView, StickyActionBar } from '@/components/mobile-ui'
import { Button } from '@/components/ui/button'
import {
  landingSignupHref,
  resolveLandingExamples,
  type LandingViewSnapshot,
} from './landing-model'
import { LandingFaq, LandingFinal, LandingHero, LandingIndustries, LandingPain, LandingPlans, LandingStory, LandingTrust } from './landing-sections'
import { OperatorInformation } from '@/features/marketing/operator-information-view'

const EXAMPLES_COPY = {
  loading: { title: '업종별 예시를 확인하는 중이에요' },
  partial: { title: '보여드릴 예시를 준비 중이에요', description: '예시가 없어도 바로 시작할 수 있어요.' },
  error: {},
  stale: {},
  ready: {},
} as const

/**
 * M01 모바일 랜딩. 1화면 가치 → 업종별 예시 → 첫 CTA.
 * 화면은 라우터/데이터 조회를 모르고 스냅샷만 받는다. 첫 CTA와 약관 링크는 정적이라
 * 예시 영역이 어떤 상태여도 항상 보인다.
 */
export function MobileLandingView({ snapshot, signedIn = false }: { snapshot: LandingViewSnapshot; signedIn?: boolean }) {
  const kind = resolveLandingExamples(snapshot)
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <div className="mx-auto w-full max-w-2xl space-y-10 overflow-x-clip px-4 text-foreground">
      <div className="flex items-center justify-between pt-1">
        <span className="flex items-center gap-2 text-base font-semibold"><span aria-hidden="true" className="grid size-8 place-items-center rounded-lg bg-primary text-xs font-extrabold text-primary-foreground">S.</span>소희</span>
        <Link href={signedIn ? '/app' : '/login'} className="inline-flex min-h-11 min-w-11 items-center justify-end px-2 text-sm font-medium text-muted-foreground underline underline-offset-2">
          {signedIn ? '내 작업' : '로그인'}
        </Link>
      </div>

      <LandingHero />
      <LandingPain />
      <LandingStory />

      <section aria-labelledby="landing-scope" className="space-y-2 rounded-2xl border border-border bg-card p-4">
        <h2 id="landing-scope" className="text-base font-semibold">지금 소희가 해드리는 일</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground">
          <li>가게 정보와 사진으로 홍보 글 초안 만들기</li>
          <li>승인하신 글을 보관해 두기</li>
          <li>채널을 연결하고 확인된 뒤에 게시 준비하기</li>
        </ul>
        <p className="text-sm leading-relaxed text-muted-foreground">
          채널 연결 전에는 외부에 아무것도 올리지 않아요. 게시는 채널 연결과 사장님 승인이 끝난
          뒤에만 진행돼요.
        </p>
      </section>

      <section aria-labelledby="landing-examples" className="space-y-3">
        <div className="space-y-1">
          <h2 id="landing-examples" className="text-lg font-semibold tracking-tight">업종별 예시</h2>
          <p className="text-sm text-muted-foreground">
            실제 가게 사례나 성과가 아니라, 이런 일을 맡길 수 있다는 예시예요. 맡기고 싶은 일을 골라 보세요.
          </p>
        </div>
        <StateView
          kind={kind}
          skeleton="list"
          checkedAt={snapshot.checkedAt}
          {...EXAMPLES_COPY[kind]}
        >
          <ul className="space-y-3">
            {(snapshot.examples ?? []).map(example => (
              <li key={example.key}>
                <button
                  type="button"
                  aria-pressed={selected === example.key}
                  onClick={() => setSelected(selected === example.key ? null : example.key)}
                  className="block min-h-11 w-full space-y-1 rounded-2xl border border-border bg-card p-4 text-left aria-pressed:border-primary aria-pressed:bg-primary/5"
                >
                  <span className="block text-xs font-medium text-muted-foreground">{example.industry} · 예시</span>
                  <span className="block text-base font-medium">{example.task}</span>
                  <span className="block text-sm text-muted-foreground">소희가 준비: {example.draft}</span>
                </button>
              </li>
            ))}
          </ul>
        </StateView>
      </section>

      <LandingIndustries />
      <LandingTrust />
      <LandingPlans />
      <LandingFaq />
      <LandingFinal signedIn={signedIn} />

      <div className="border-t border-border/40 pb-6 pt-2 text-center">
        <OperatorInformation />
      </div>

      <StickyActionBar
        className="-mx-4"
        hint={signedIn ? undefined : (
          <>
            가입 화면에서{' '}
            <Link href="/terms" className="inline-flex min-h-11 min-w-11 items-center justify-center underline underline-offset-2">
              이용약관
            </Link>
            {' · '}
            <Link href="/privacy" className="inline-flex min-h-11 min-w-11 items-center justify-center underline underline-offset-2">
              개인정보 처리방침
            </Link>
            을 확인할 수 있어요
          </>
        )}
      >
        <Button asChild size="lg">
          {signedIn
            ? <Link href="/app">내 작업 열기</Link>
            : <Link href={landingSignupHref(selected, snapshot.examples)}>무료로 우리 가게 시작하기</Link>}
        </Button>
      </StickyActionBar>
    </div>
  )
}
