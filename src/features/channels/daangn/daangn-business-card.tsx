import { ExternalLink } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { officialDaangnBusinessLoginUrl, type DaangnBusinessProfile } from './daangn-connection'

export function DaangnBusinessCard({ profile }: Readonly<{ profile: DaangnBusinessProfile }>) {
  const capability = profile.capability === 'local_connector'
    ? '소희 Chrome 연결기로 소식 게시 가능'
    : profile.capability === 'manual_assist_only' ? '소식 게시 보조만 가능' : '현재 미지원'

  return (
    <Card className="max-w-4xl border border-zinc-200/80 dark:border-zinc-800 shadow-xs">
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl font-bold tracking-tight">당근 비즈프로필</CardTitle>
          <Badge variant="secondary" className="text-xs">
            {profile.reauthState === 'user_login_required' ? '로그인 필요' : '연결 준비'}
          </Badge>
        </div>
        <CardDescription>
          {profile.accountLabel ?? '연결할 비즈프로필을 선택해 주세요.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/60 dark:border-zinc-800 space-y-1">
            <span className="text-zinc-400 font-bold block text-[11px]">지역</span>
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">{profile.region ?? '공식 화면에서 확인 필요'}</span>
          </div>
          <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/60 dark:border-zinc-800 space-y-1">
            <span className="text-zinc-400 font-bold block text-[11px]">소개 준비도</span>
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">{profile.introductionState === 'ready' ? '확인된 정보 있음' : '정보 확인 필요'}</span>
          </div>
          <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/60 dark:border-zinc-800 space-y-1">
            <span className="text-zinc-400 font-bold block text-[11px]">최근 소식</span>
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">{profile.recentNewsCount === null ? '아직 확인하지 못했어요' : `${profile.recentNewsCount}건`}</span>
          </div>
          <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/60 dark:border-zinc-800 space-y-1">
            <span className="text-zinc-400 font-bold block text-[11px]">실행 상태</span>
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">{capability}</span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          정확한 승인 버전과 순서가 있는 이미지는 수동 마무리 묶음으로 준비할 수 있어요. 비밀번호, 인증 번호, 보안 문자는 이 화면에서 읽거나 저장하지 않아요.
        </p>

        <div className="pt-2">
          <Button asChild variant="outline" size="sm" className="min-h-11">
            <a href={officialDaangnBusinessLoginUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5">
              당근 비즈프로필 공식 화면 열기
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
