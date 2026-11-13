import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Section, TrialSummaryModel } from './summary-model'

const NONE = '아직 없어요'
const LOAD_FAILED = '불러오지 못했어요. 잠시 뒤 다시 확인해 주세요.'

const nextPlan = [
  { title: '보관한 글 중 먼저 올릴 글 고르기', description: '채널 연결이 끝나면 보관해 둔 글부터 차례로 올려요.' },
  { title: '반응을 보고 문구 다듬기', description: '확인된 반응만 모아 다음 글에 반영해요.' },
  { title: '계절 소식과 이벤트 글 준비', description: '다가오는 시기에 맞춰 소식 글을 미리 만들어 둬요.' },
]

function Block<T>({ title, section, children, empty = NONE }: {
  title: string
  section: Section<T>
  children: (data: T) => React.ReactNode
  empty?: string
}) {
  return <Card className="min-w-0 gap-3 py-5">
    <CardHeader className="px-5"><CardTitle><h2 className="text-base">{title}</h2></CardTitle></CardHeader>
    <CardContent className="px-5 text-sm">
      {section.state === 'error' && <p role="alert" className="text-destructive">{LOAD_FAILED}</p>}
      {section.state === 'empty' && <p className="text-muted-foreground">{empty}</p>}
      {section.state === 'ready' && children(section.data)}
    </CardContent>
  </Card>
}

export function TrialSummaryView({ model }: { model: TrialSummaryModel }) {
  const left = model.daysLeft === null ? '확인 전' : model.daysLeft === 0 ? '오늘 끝나요' : `${model.daysLeft}일 남았어요`
  return <main className="mx-auto w-full max-w-2xl min-w-0 space-y-5 px-4 py-6" aria-labelledby="trial-summary-title">
    <header className="space-y-1">
      <h1 id="trial-summary-title" className="text-xl font-semibold">체험 기간 동안 한 일</h1>
      <p className="text-sm text-muted-foreground">체험 종료까지: <span data-testid="days-left">{left}</span></p>
    </header>

    <Block title="만든 글" section={model.posts}>
      {(d) => <p><strong className="text-lg">{d.count}건</strong>을 만들었어요.</p>}
    </Block>

    <Block title="보관 현황" section={model.vault}>
      {(d) => <div className="space-y-1">
        <p>보관한 글 <strong>{d.stored}건</strong>{d.needsReapproval > 0 && <>, 다시 확인할 글 <strong>{d.needsReapproval}건</strong></>}</p>
        <p className="text-muted-foreground">채널 심사를 기다리는 글도 포함돼 있어요. 보관한 글은 아직 외부에 올라가지 않았어요.</p>
      </div>}
    </Block>

    <Block title="실제로 올린 글" section={model.links}>
      {(links) => <ul className="space-y-2">{links.map((l) => <li key={l.url}>
        <a className="break-all text-violet-700 underline underline-offset-2" href={l.url} target="_blank" rel="noopener noreferrer">{l.channelLabel}에서 보기<span className="sr-only"> (새 창)</span></a>
      </li>)}</ul>}
    </Block>

    <Block title="아낀 시간" section={model.savedTime}>
      {(d) => <div className="space-y-1">
        <p><Badge variant="secondary" className="mr-2">추정</Badge><strong>약 {d.minutes}분</strong></p>
        <p className="text-muted-foreground">계산: 글 {d.posts}건 × 글 1건당 {d.perPost}분 = {d.minutes}분</p>
        <p className="text-muted-foreground">{d.basis}</p>
      </div>}
    </Block>

    <section aria-labelledby="next-plan" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="next-plan" className="text-base font-semibold">다음 30일 계획</h2>
        <Badge variant="secondary">예시</Badge>
      </div>
      <p className="text-sm text-muted-foreground">정해진 일정이 아니라 참고용 예시예요.</p>
      <div className="grid gap-3">{nextPlan.map((p) => <Card key={p.title} className="min-w-0 gap-1 py-4">
        <CardHeader className="px-5"><CardTitle><h3 className="text-sm">{p.title}</h3></CardTitle></CardHeader>
        <CardContent className="px-5 text-sm text-muted-foreground">{p.description}</CardContent>
      </Card>)}</div>
    </section>

    <Card className="min-w-0 gap-3 py-5">
      <CardHeader className="px-5"><CardTitle><h2 className="text-base">체험이 끝난 뒤 보관한 글</h2></CardTitle></CardHeader>
      <CardContent className="px-5 text-sm" data-testid="end-policy">{model.policy.text}</CardContent>
    </Card>

    {model.numbers && <section aria-labelledby="numbers-title" data-testid="numbers-section" className="space-y-2 rounded-2xl border p-5 text-sm">
      <h2 id="numbers-title" className="text-base font-semibold">이용 안내</h2>
      <dl className="space-y-1">
        <div className="flex justify-between gap-3"><dt>체험 기간</dt><dd>{model.numbers.trialDays}일</dd></div>
        <div className="flex justify-between gap-3"><dt>월 이용료</dt><dd>{model.numbers.monthlyPriceWon?.toLocaleString('ko-KR')}원</dd></div>
        <div className="flex justify-between gap-3"><dt>포함 크레딧</dt><dd>{model.numbers.includedCredits?.toLocaleString('ko-KR')}</dd></div>
      </dl>
    </section>}

    <Button asChild variant="outline"><Link href="/app/vault">보관함 보러 가기</Link></Button>
  </main>
}
