'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Shield, ShieldAlert, KeyRound, Sparkles, ArrowRight, Bot, Lock, CheckCircle2, Clock, ExternalLink } from 'lucide-react'
import { loginWithReviewCredentials } from './actions'

export function AdminPreviewClient() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  function handleCredentialSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrorMsg(null)
    const formData = new FormData(e.currentTarget)

    startTransition(async () => {
      const res = await loginWithReviewCredentials(formData)
      if (!res.success) {
        setErrorMsg(res.error || '로그인에 실패했습니다.')
        return
      }
      router.push(res.redirectUrl || '/admin')
      router.refresh()
    })
  }

  return (
    <div className="w-full max-w-lg mx-auto">
      <Card className="border border-primary/30 shadow-2xl bg-card/95 backdrop-blur-sm overflow-hidden">
        {/* 상단 보라색 그라데이션 배너 */}
        <div className="h-2 w-full bg-gradient-to-r from-primary via-state-wait to-primary" />
        
        <CardHeader className="space-y-3 pb-4">
          <div className="flex items-center justify-between">
            <Badge className="bg-primary/15 text-primary hover:bg-primary/90 border-primary/30 flex items-center gap-1.5 px-3 py-1 text-xs">
              <Sparkles className="size-3.5 text-primary" />
              AI 검수 & 평가 전용 세션
            </Badge>
            <Badge variant="outline" className="text-[11px] font-mono flex items-center gap-1 text-state-ok border-state-ok/30">
              <Clock className="size-3" /> 1H 유효
            </Badge>
          </div>

          <div className="space-y-1">
            <CardTitle className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <Bot className="size-6 text-primary" />
              소희 관리자 검수 전용 로그인
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground leading-relaxed">
              사전 승인된 검수자 계정(ID/PW)으로 인증하여 관리자 센터의 기능과 진실성을 점검할 수 있는 전용 엔드포인트입니다.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {errorMsg && (
            <Alert variant="destructive" className="border-state-danger/30 bg-state-danger/10">
              <ShieldAlert className="size-4" />
              <AlertTitle className="text-xs font-semibold">검수 인증 오류</AlertTitle>
              <AlertDescription className="text-xs">{errorMsg}</AlertDescription>
            </Alert>
          )}

          {/* 주요 혜택 안내 */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3.5 space-y-2 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground flex items-center gap-1.5 text-xs text-primary">
              <CheckCircle2 className="size-4 text-primary" /> 검수 세션 보안 정책
            </p>
            <ul className="list-disc list-inside space-y-1 text-[11px] pl-1">
              <li><strong>인증된 계정 필수</strong>: 등록된 관리자/검수자 ID 및 패스워드 인증 필수</li>
              <li><strong>1시간 단기 세션 (Fail-Closed)</strong>: 보안을 위해 1시간 동안만 유효하며 만료 시 자동 종료</li>
              <li><strong>감사 로그(Audit) 기록</strong>: 검수 세션의 모든 조회 활동은 보안 감사 로그에 안전하게 기록</li>
            </ul>
          </div>

          <form onSubmit={handleCredentialSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5" htmlFor="email">
                <KeyRound className="size-3.5 text-muted-foreground" /> 관리자 이메일 (ID)
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                placeholder="operator@example.com"
                className="h-10 text-base md:text-sm"
                autoComplete="email"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5" htmlFor="password">
                <Lock className="size-3.5 text-muted-foreground" /> 비밀번호 (Password)
              </label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                placeholder="비밀번호를 입력하세요"
                className="h-10 text-base md:text-sm"
                autoComplete="current-password"
              />
            </div>

            <Button
              type="submit"
              disabled={isPending}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold h-10 text-sm shadow-md"
            >
              {isPending ? '검수 세션 생성 중...' : '검수 모드로 로그인'}
              <ArrowRight className="size-4 ml-1.5" />
            </Button>
          </form>
        </CardContent>

        <CardFooter className="flex flex-col gap-2.5 pt-2 pb-5 border-t border-border/60 text-xs text-muted-foreground">
          <div className="flex items-center justify-between w-full text-[11px]">
            <Link href="/admin-login" className="hover:text-primary flex items-center gap-1 transition-colors">
              <Shield className="size-3" /> 정식 관리자 로그인(MFA)
            </Link>
            <Link href="/" className="hover:text-primary flex items-center gap-1 transition-colors">
              소희 홈으로 <ExternalLink className="size-3" />
            </Link>
          </div>
          <p className="text-[10px] text-center text-muted-foreground/80">
            * 이 링크는 AI 심사 및 기능 검토를 위해 24시간 동안 임시 제공되는 전용 페이지입니다.
          </p>
        </CardFooter>
      </Card>
    </div>
  )
}
