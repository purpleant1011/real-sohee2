import Link from 'next/link'
import { ArrowRight, AtSign, Check, Sparkles, Store, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'

const JOURNEY = [
  {
    icon: UserPlus,
    title: '계정 만들기',
    description: '이메일 또는 Google로 3분이면 끝나요.',
  },
  {
    icon: Store,
    title: '우리 가게 알려주기',
    description: '상호·주소·업종 등 매장 기본 정보를 직접 입력해요.',
  },
  {
    icon: AtSign,
    title: '인스타·스레드 연결',
    description: '한 곳만 연결해도 시작할 수 있어요. 나중에 해도 돼요.',
  },
  {
    icon: Sparkles,
    title: '첫 글 확인하고 발행',
    description: '소희가 쓴 초안을 사장님이 보고 승인하면 올라가요.',
  },
] as const

/**
 * 비로그인 방문자가 /start 에 닿았을 때 보는 진입 화면.
 * 로그인 벽 대신 "무엇을 하게 되는지"를 먼저 보여주고 가입으로 바로 연결한다.
 */
export function StartEntry() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 py-10 sm:py-16">
      <header className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <Sparkles className="size-4" aria-hidden /> 소희와 함께 시작하기
        </div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          10분 안에 첫 게시물까지,
          <br className="sm:hidden" /> 소희가 같이 할게요
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
          가게 정보를 알려주고 계정을 연결하면, 소희가 사장님 말투로 첫 게시물을 만들어 미리 보여드려요.
          마음에 들면 그대로 발행하면 됩니다.
        </p>
      </header>

      <section aria-labelledby="start-journey-title" className="mt-8 space-y-3">
        <h2 id="start-journey-title" className="text-sm font-bold text-foreground">
          이렇게 진행돼요
        </h2>
        <ol aria-label="가입 후 진행 순서" className="space-y-2.5">
          {JOURNEY.map((item, index) => {
            const Icon = item.icon
            return (
              <li
                key={item.title}
                className="flex items-start gap-3 rounded-xl border bg-card p-4 shadow-xs"
              >
                <span
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"
                  aria-hidden
                >
                  <Icon className="size-4" />
                </span>
                <div className="space-y-0.5">
                  <p className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                    <span className="text-xs font-bold text-primary">{index + 1}단계</span>
                    <span aria-hidden>·</span>
                    <span>{item.title}</span>
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{item.description}</p>
                </div>
              </li>
            )
          })}
        </ol>
      </section>

      <div className="mt-8 flex flex-col gap-3">
        <Button asChild className="h-12 min-h-[48px] w-full text-base font-bold shadow-sm">
          <Link href="/signup?next=%2Fstart">
            무료로 시작하기 <ArrowRight aria-hidden />
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-11 min-h-[44px] w-full font-semibold">
          <Link href="/login?next=%2Fstart">이미 계정이 있어요 · 로그인</Link>
        </Button>
      </div>

      <ul className="mt-6 space-y-1.5 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <Check className="size-3.5 text-state-ok" aria-hidden /> 신용카드 등록 없이 시작
        </li>
        <li className="flex items-center gap-1.5">
          <Check className="size-3.5 text-state-ok" aria-hidden /> 인스타·스레드 중 1곳 연결 시 첫 포스팅 무료 제작 지원
        </li>
        <li className="flex items-center gap-1.5">
          <Check className="size-3.5 text-state-ok" aria-hidden /> 소희는 사장님이 승인한 글만 올려요
        </li>
      </ul>
    </main>
  )
}
