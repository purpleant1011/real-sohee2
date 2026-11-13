'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'
import { safeOperatorNextPath } from '@/features/auth/safe-operator-next-path'
import { startTotpChallenge, verifyTotp, type AdminMfaBrowserClient } from '@/features/operator-onboarding/mfa-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

type Navigation = Readonly<{ replace: (href: string) => void; refresh: () => void }>

type Props = Readonly<{
  next: string
  mfaClient?: AdminMfaBrowserClient
  navigation?: Navigation
}>

export default function AdminVerifyClient({ next, mfaClient, navigation }: Props) {
  const router = useRouter()
  const client = useMemo(() => mfaClient ?? createBrowserSupabaseClient(), [mfaClient])
  const target = safeOperatorNextPath(next)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !/^\d{6}$/u.test(code)) return
    setBusy(true)
    setMessage(null)
    try {
      const { data: factors, error: factorsError } = await client.auth.mfa.listFactors()
      if (factorsError) throw new Error('factors unavailable')
      const factor = factors?.totp?.find((item) => item.status === 'verified')
        ?? factors?.all?.find((item) => item.factor_type === 'totp' && item.status === 'verified')
      if (!factor?.id) throw new Error('verified factor unavailable')

      const challenge = await startTotpChallenge(client, factor.id)
      await verifyTotp(client, factor.id, challenge.id, code)
      const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel()
      if (assurance.error || assurance.data?.currentLevel !== 'aal2') throw new Error('assurance unavailable')
      setCode('')
      const destination = safeOperatorNextPath(target)
      const destinationRouter = navigation ?? router
      destinationRouter.replace(destination)
      destinationRouter.refresh()
    } catch {
      setCode('')
      setMessage('인증을 완료하지 못했습니다. 잠시 후 새 인증 코드로 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-md shadow-lg border-border">
        <CardHeader>
          <CardTitle>관리자 추가 인증</CardTitle>
          <CardDescription>등록된 인증 앱에 표시된 6자리 코드를 입력해 주세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4" aria-label="관리자 추가 인증">
            <div className="space-y-2">
              <label htmlFor="admin-verify-code">인증 앱의 6자리 코드</label>
              <Input
                id="admin-verify-code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/gu, '').slice(0, 6))}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
              {busy ? '인증 확인 중…' : '인증하고 관리자 페이지로 이동'}
            </Button>
            {message ? <p role="alert" className="text-sm text-destructive">{message}</p> : null}
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
