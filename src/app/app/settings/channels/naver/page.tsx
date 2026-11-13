import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ExternalLink, PenLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { SettingsSectionHeader } from '@/components/v088/system/settings-section-header'

export default async function NaverChannelSettingsPage() {
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace) redirect('/app/onboarding')

  return (
    <div className="space-y-6 max-w-4xl">
      <SettingsSectionHeader
        title="네이버 블로그 수동 게시 안내"
        description="소희는 네이버에 자동으로 올리지 않아요. 원고와 사진을 준비해 드리면 네이버 글쓰기에서 직접 게시해요."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">네이버 블로그 게시 3단계</CardTitle>
          <CardDescription>
            네이버 정책에 맞추어 사장님이 직접 검토하고 안전하게 게시하는 방식이에요.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="space-y-3 text-sm">
            <li className="flex items-start gap-3 rounded-lg border p-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                1
              </span>
              <div className="space-y-0.5">
                <p className="font-semibold text-foreground">1단계: 원고·사진 준비</p>
                <p className="text-muted-foreground">소희와 대화하며 블로그에 맞는 맞춤형 원고와 사진을 준비해요.</p>
              </div>
            </li>
            <li className="flex items-start gap-3 rounded-lg border p-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                2
              </span>
              <div className="space-y-0.5">
                <p className="font-semibold text-foreground">2단계: 복사/저장</p>
                <p className="text-muted-foreground">완성된 원고 본문을 복사하고, 필요한 사진을 기기에 저장해요.</p>
              </div>
            </li>
            <li className="flex items-start gap-3 rounded-lg border p-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                3
              </span>
              <div className="space-y-0.5">
                <p className="font-semibold text-foreground">3단계: 네이버 글쓰기에서 직접 붙여넣고 게시 후 글 주소 기록</p>
                <p className="text-muted-foreground">
                  네이버 스마트에디터에 제목과 본문을 붙여넣고 사진을 첨부한 뒤 발행을 완료하고, 소희에게 글 주소를 알려주세요.
                </p>
              </div>
            </li>
          </ol>

          <div className="flex flex-wrap gap-3 pt-2">
            <Button asChild>
              <a
                href="https://blog.naver.com/GoBlogWrite.naver"
                target="_blank"
                rel="noopener noreferrer"
              >
                네이버 글쓰기 열기
                <ExternalLink className="size-4 ml-1.5" aria-hidden />
              </a>
            </Button>
            <Button asChild variant="outline">
              <Link href="/app/content">
                콘텐츠 만들기
                <PenLine className="size-4 ml-1.5" aria-hidden />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
