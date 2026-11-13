import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'
import { safeOperatorNextPath } from '../../features/auth/safe-operator-next-path'
import { OperatorClientShell } from '../../components/operator-shell/operator-client-shell'
import {
  OperatorAccessError,
  requireOperatorIdentity,
} from '../../features/operator-auth/current-operator'

import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { KeyRound, ArrowRight, Lock } from 'lucide-react'
import { getCurrentOperatorSetupContext } from '@/features/operator-onboarding/setup-context'

function AccessDenied({ recoveryPath }: Readonly<{ recoveryPath?: string }>) {
  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-muted/20">
      <Card className="max-w-md w-full p-6 space-y-5 border border-border/80 shadow-md bg-card">
        <div className="flex items-center justify-between">
          <div className="p-3 rounded-2xl bg-primary/10 text-primary border border-primary/20">
            <Lock className="size-6" />
          </div>
          <Badge variant="outline" className="text-[10px] font-mono text-state-warn border-state-warn/30">
            관리자 접근 제한
          </Badge>
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            운영사 관리자 접근이 필요합니다
          </h1>
          <p className="text-xs text-muted-foreground leading-relaxed">
            이 화면은 등록된 운영사 관리자만 사용할 수 있습니다. 계정에 추가 인증이 필요한 경우 인증을 완료해 주세요.
          </p>
        </div>

        <div className="pt-2 flex flex-col gap-2.5">
          {recoveryPath ? (
            <Button asChild className="w-full bg-primary hover:bg-primary/90 text-white font-semibold h-10 text-xs">
              <Link href={recoveryPath}>
                <KeyRound className="size-4 mr-2" /> {recoveryPath.startsWith('/auth/admin-verify') ? '등록된 인증 앱으로 인증하기' : '관리자 추가 인증 설정으로 이동'} <ArrowRight className="size-3.5 ml-auto" />
              </Link>
            </Button>
          ) : (
            <Button asChild className="w-full bg-primary hover:bg-primary/90 text-white font-semibold h-10 text-xs">
              <Link href="/admin-login?next=%2Fadmin">
                <Lock className="size-4 mr-2" /> 운영사 로그인으로 이동 <ArrowRight className="size-3.5 ml-auto" />
              </Link>
            </Button>
          )}
          <Button variant="outline" asChild className="w-full text-xs h-9">
            <Link href="/">소희 홈으로 돌아가기</Link>
          </Button>
        </div>
      </Card>
    </main>
  )
}


export default async function OperatorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers()
  const next = safeOperatorNextPath(requestHeaders.get('x-sohee-pathname'))
  const pathname = next.split(/[?#]/u, 1)[0] ?? '/admin'
  let operator: Awaited<ReturnType<typeof requireOperatorIdentity>>

  try {
    operator = await requireOperatorIdentity()
  } catch (error) {
    if (error instanceof OperatorAccessError && error.code === 'AUTH_REQUIRED') {
      redirect(`/admin-login?next=${encodeURIComponent(next)}`)
    }
    if (error instanceof OperatorAccessError && (error.code === 'MFA_REQUIRED' || error.code === 'OPERATOR_DISABLED')) {
      const setup = await getCurrentOperatorSetupContext()
      if (setup?.hasRole && setup.emailConfirmed && (setup.status === 'active' || setup.status === 'invited')) {
        const recoveryPath = setup.status === 'active' && setup.hasVerifiedTotp
          ? `/auth/admin-verify?next=${encodeURIComponent(next)}`
          : '/auth/admin-setup'
        return <AccessDenied recoveryPath={recoveryPath} />
      }
    }
    return <AccessDenied />
  }

  return (
    <OperatorClientShell pathname={pathname} permissions={operator.permissions}>
      {children}
    </OperatorClientShell>
  )
}
