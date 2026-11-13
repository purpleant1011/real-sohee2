import Link from 'next/link'
import { FileText, LockKeyhole } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Area = 'home' | 'content' | 'vault' | 'customers' | 'results'

const copy: Record<Area, { title: string; description: string; action: string; href: string }> = {
  home: { title: '아직 게시물이 없어요', description: '사장님의 첫 소식을 준비해 보세요.', action: '첫 소식 준비하기', href: '/app/content' },
  content: { title: '아직 만든 게시물이 없어요', description: '위에 소식을 한 줄 적어 주시면 소희가 글과 사진의 예상 화면을 준비해요. 채널이 아직 연결되지 않았다면 채널 설정에서 연결해 주세요.', action: '첫 글 준비하기', href: '/app/content?compose=first' },
  vault: { title: '보관한 콘텐츠가 아직 없어요', description: '콘텐츠를 만든 뒤 확인하고 보관할 수 있어요. 다른 기간도 살펴보세요.', action: '콘텐츠 만들기', href: '/app/content' },
  customers: { title: '아직 연결된 고객 문의가 없어요', description: '첫 소식을 준비해 고객에게 사장님의 서비스를 알려보세요.', action: '첫 소식 준비하기', href: '/app/content' },
  results: { title: '아직 확인된 성과가 없어요', description: '첫 글을 준비하고 발행 결과를 확인해 보세요. 확인되지 않은 수치는 표시하지 않아요.', action: '첫 콘텐츠 준비하기', href: '/app/content' },
}

export function EmptyState({ area }: { area: Area }) {
  const { title, description, action, href } = copy[area]
  return <Card data-testid={`empty-${area}`} className="min-w-0 border-dashed shadow-none">
    <CardHeader className="items-center text-center"><FileText className="size-8 text-muted-foreground" aria-hidden="true" /><CardTitle><h3 className="text-lg">{title}</h3></CardTitle></CardHeader>
    <CardContent className="flex flex-col items-center gap-4 text-center">
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      <Button asChild><Link href={href}>{action}</Link></Button>
    </CardContent>
  </Card>
}

const firstWeek = [
  { title: '월 이벤트 글 준비', description: '이번 달에 전하고 싶은 소식을 글로 정리해 보세요.' },
  { title: '후기 요청 문구', description: '고객에게 직접 보내기 전 사용할 문구를 생각해 보세요.' },
  { title: '지역 소식 글', description: '우리 동네 이웃에게 서비스 소식을 소개해 보세요.' },
]

export function FirstWeekPlan() {
  return <section aria-label="소희의 첫 주 계획" className="space-y-3">
    <h2 className="text-xl font-semibold">소희의 첫 주 계획</h2>
    <p className="text-sm text-muted-foreground">사업 정보를 확인하기 전 참고할 수 있는 아이디어예요. 실제로 작성되거나 발행된 글은 아니에요.</p>
    <div className="grid gap-3 sm:grid-cols-3">{firstWeek.map((item) =>
      <Card key={item.title} className="min-w-0 gap-3 py-5"><CardHeader className="px-5"><Badge variant="secondary" className="w-fit">예시</Badge><CardTitle><h3 className="text-base leading-snug">{item.title}</h3></CardTitle></CardHeader><CardContent className="px-5 text-sm text-muted-foreground">{item.description}</CardContent></Card>,
    )}</div>
  </section>
}

const liveRoadmapItems = [
  { title: '댓글·DM 자동 응대 (L2 자율)', status: '가동 중', isLive: true, href: '/app/engagement', desc: '칭찬·인사 댓글 자동 소통 및 3대 톤앤매너' },
  { title: 'SNS 예약 확정 CRM', status: '가동 중', isLive: true, href: '/app/customers', desc: '인스타 DM 문의 간편 예약 장부 등록' },
  { title: '네이버 블로그 원고 준비', status: '가동 중', isLive: true, href: '/app/content', desc: '블로그 맞춤 원고 및 이미지 준비' },
  { title: '당근마켓 비즈프로필 소식', status: '준비 중', isLive: false, href: null, desc: '당근 동네소식 원고 작성 지원 준비 중' },
]

export function ComingSoonRoadmap() {
  return <section aria-label="소희 주요 기능 및 로드맵" className="space-y-3">
    <h2 className="text-xl font-semibold">소희 주요 기능 및 로드맵</h2>
    <ul className="grid gap-3 sm:grid-cols-2">
      {liveRoadmapItems.map(({ title, status, isLive, href, desc }) => (
        <li
          key={title}
          className={`min-w-0 rounded-xl border p-4 transition-all ${
            isLive
              ? 'border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/20 text-foreground'
              : 'border-border bg-muted/40 text-muted-foreground'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${isLive ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400'}`} />
              <span className="font-bold text-foreground text-sm">{title}</span>
            </div>
            <Badge variant={isLive ? 'default' : 'outline'} className={isLive ? 'bg-emerald-700 text-white font-bold text-xs' : ''}>
              {status}
            </Badge>
          </div>
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{desc}</p>
          {href ? (
            <div className="mt-2.5 pt-2 border-t border-border/40">
              <Link href={href} className="text-xs font-bold text-primary hover:underline inline-flex items-center gap-1">
                <span>기능 바로가기</span>
                <span>👉</span>
              </Link>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  </section>
}
