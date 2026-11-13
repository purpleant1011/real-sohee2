'use client'
/* eslint-disable @next/next/no-img-element -- Supabase returns an ephemeral data URL for the TOTP QR. */

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { createBrowserSupabaseClient } from "@/lib/supabase/client"
import type { ActionResult } from "@/lib/errors/result"
import type { OperatorSetupContext } from "./setup-context"
import { enrollTotp, getAdminMfaStep, mapMfaError, startTotpChallenge, verifyTotp, type AdminMfaBrowserClient, type TotpEnrollment } from "./mfa-client"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Progress } from "@/components/ui/progress"
import { ShieldCheck, Lock, Smartphone, CheckCircle2, AlertCircle, ArrowRight, Copy, Check, RotateCcw, KeyRound } from "lucide-react"

type PasswordAction = (formData: FormData) => Promise<ActionResult<{ code: "password_recorded" }>>
type MfaAction = () => Promise<ActionResult<{ code: "mfa_activated" }>>
type AdminSetupNavigation = Readonly<{ refresh: () => void; replace: (href: string) => void }>

export default function AdminSetupClient({
  context,
  passwordAction,
  activationAction,
  mfaClient,
  navigation: injectedNavigation,
}: Readonly<{
  context: OperatorSetupContext
  passwordAction: PasswordAction
  activationAction: MfaAction
  mfaClient?: AdminMfaBrowserClient
  navigation?: AdminSetupNavigation
}>) {
  const appRouter = useRouter()
  const navigation = injectedNavigation ?? appRouter
  const client = useMemo(() => mfaClient ?? createBrowserSupabaseClient(), [mfaClient])
  const [step, setStep] = useState(getAdminMfaStep(context))
  const [password, setPassword] = useState("")
  const [passwordConfirmation, setPasswordConfirmation] = useState("")
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null)
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null)
  const [factorId, setFactorId] = useState("")
  const [challengeId, setChallengeId] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => () => {
    setEnrollment(null)
    setFactorId("")
    setChallengeId("")
    setCode("")
  }, [])

  const stepProgress = {
    password: 25,
    enroll: 50,
    challenge: 75,
    activate: 90,
    complete: 100,
  }[step] || 25

  async function submitPassword(formData: FormData) {
    setBusy(true)
    setMessage(null)
    const result = await passwordAction(formData)
    setBusy(false)
    if ("error" in result) {
      setMessage({ kind: "alert", text: result.error?.message ?? "비밀번호 설정을 완료하지 못했습니다. 다시 시도해 주세요." })
      return
    }
    setPassword("")
    setPasswordConfirmation("")
    setMessage({ kind: "status", text: "비밀번호 설정이 완료되었습니다. 2단계 인증(MFA) 등록을 시작해 주세요." })
    setStep("enroll")
    navigation.refresh()
  }

  async function beginEnrollment() {
    setBusy(true)
    setMessage(null)
    try {
      const result = await enrollTotp(client)
      setEnrollment(result)
      setFactorId(result.id)
      setStep("challenge")
      const challenge = await startTotpChallenge(client, result.id)
      setChallengeId(challenge.id)
    } catch (error) {
      const safe = mapMfaError(error)
      setMessage({ kind: "alert", text: safe.message })
    } finally {
      setBusy(false)
    }
  }

  async function handleResetAndReEnroll() {
    setBusy(true)
    setMessage(null)
    try {
      if (client.auth.mfa.listFactors && client.auth.mfa.unenroll) {
        const factors = await client.auth.mfa.listFactors()
        const all = factors.data?.all || []
        const totp = factors.data?.totp || []
        for (const factor of all) {
          if (factor.id) await client.auth.mfa.unenroll({ factorId: factor.id }).catch(() => {})
        }
        for (const factor of totp) {
          if (factor.id) await client.auth.mfa.unenroll({ factorId: factor.id }).catch(() => {})
        }
      }
      setEnrollment(null)
      setFactorId("")
      setChallengeId("")
      setCode("")
      const result = await enrollTotp(client)
      setEnrollment(result)
      setFactorId(result.id)
      setStep("challenge")
      const challenge = await startTotpChallenge(client, result.id)
      setChallengeId(challenge.id)
      setMessage({ kind: "status", text: "새로운 TOTP 키가 발급되었습니다. 인증 앱에 등록해 주세요." })
    } catch (error) {
      setMessage({ kind: "alert", text: mapMfaError(error).message })
    } finally {
      setBusy(false)
    }
  }

  async function beginExistingChallenge() {
    setBusy(true)
    setMessage(null)
    try {
      let currentFactorId = factorId
      if (!currentFactorId) {
        const factors = await client.auth.mfa.listFactors()
        const existing = factors.data?.totp?.[0]
        if (!existing?.id) throw new Error("factor unavailable")
        currentFactorId = existing.id
      }
      const challenge = await startTotpChallenge(client, currentFactorId)
      setFactorId(currentFactorId)
      setChallengeId(challenge.id)
      setStep("challenge")
      setMessage({ kind: "status", text: "기존 등록된 OTP 앱의 6자리 인증 코드를 입력해 주세요." })
    } catch (error) {
      setMessage({ kind: "alert", text: mapMfaError(error).message })
    } finally {
      setBusy(false)
    }
  }

  async function submitCode() {
    setBusy(true)
    setMessage(null)
    try {
      let currentFactorId = factorId
      let currentChallengeId = challengeId
      if (!currentFactorId) {
        const factors = await client.auth.mfa.listFactors()
        const existing = factors.data?.totp?.[0]
        if (!existing?.id) throw new Error("factor unavailable")
        currentFactorId = existing.id
      }
      if (!currentChallengeId) currentChallengeId = (await startTotpChallenge(client, currentFactorId)).id
      await verifyTotp(client, currentFactorId, currentChallengeId, code)
      const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel()
      if (assurance.error || assurance.data?.currentLevel !== "aal2") throw new Error("assurance unavailable")
      setEnrollment(null); setFactorId(""); setChallengeId(""); setCode("")
      if (context.status === "active") {
        navigation.replace("/admin")
        return
      }
      setMessage({ kind: "status", text: "MFA 인증이 완료되었습니다. 관리자 활성화를 진행해 주세요." })
      setStep("activate")
      navigation.refresh()
    } catch (error) {
      setMessage({ kind: "alert", text: mapMfaError(error).message })
    } finally {
      setBusy(false)
    }
  }

  async function activate() {
    setBusy(true)
    setMessage(null)
    const result = await activationAction()
    setBusy(false)
    if ("error" in result) {
      setMessage({ kind: "alert", text: result.error?.message ?? "관리자 활성화를 완료하지 못했습니다. 다시 시도해 주세요." })
      return
    }
    navigation.replace("/admin")
  }

  function copySecretToClipboard(secret: string) {
    if (!secret) return
    void navigator.clipboard.writeText(secret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-md shadow-lg border-border">
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-between">
            <Badge variant="purple" className="text-xs">운영사 관리자 보안</Badge>
            <span className="text-xs text-muted-foreground font-medium">{stepProgress}% 완료</span>
          </div>
          <Progress value={stepProgress} max={100} className="h-1.5" />
          <CardTitle className="text-xl font-bold pt-2 flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" />
            {step === "password" && "1단계: 관리자 비밀번호 설정"}
            {step === "enroll" && "2단계: 2차 인증(MFA) 등록"}
            {step === "challenge" && "3단계: 인증 앱 6자리 코드 확인"}
            {step === "activate" && "4단계: 관리자 계정 최종 활성화"}
            {step === "complete" && "관리자 보안 설정 완료"}
          </CardTitle>
          <CardDescription>
            소희 관리자 V0.2는 금융 수준의 AAL2 보안을 위해 OTP 인증 앱(Google OTP, Microsoft Authenticator) 등록이 필수입니다.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {message && (
            <Alert variant={message.kind === "alert" ? "destructive" : "success"}>
              {message.kind === "alert" ? <AlertCircle className="size-4" /> : <CheckCircle2 className="size-4" />}
              <AlertTitle>{message.kind === "alert" ? "오류 발생" : "알림"}</AlertTitle>
              <AlertDescription>{message.text}</AlertDescription>
            </Alert>
          )}

          {step === "password" && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const formData = new FormData(e.currentTarget)
                void submitPassword(formData)
              }}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground flex items-center gap-1.5" htmlFor="password">
                  <Lock className="size-3.5 text-muted-foreground" /> 새 비밀번호 (최소 8자 이상)
                </label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="새 비밀번호 입력"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground" htmlFor="passwordConfirmation">
                  비밀번호 확인
                </label>
                <Input
                  id="passwordConfirmation"
                  name="passwordConfirmation"
                  type="password"
                  minLength={8}
                  autoComplete="new-password"
                  value={passwordConfirmation}
                  onChange={(e) => setPasswordConfirmation(e.target.value)}
                  placeholder="비밀번호 다시 입력"
                  required
                />
              </div>
              <Button type="submit" disabled={busy} className="w-full mt-2">
                {busy ? "처리 중..." : "비밀번호 설정 및 다음"}
              </Button>
            </form>
          )}

          {step === "enroll" && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border/80 bg-muted/40 p-4 space-y-2 text-sm text-muted-foreground">
                <p className="font-semibold text-foreground flex items-center gap-1.5">
                  <Smartphone className="size-4 text-primary" /> 지원되는 모바일 인증 앱
                </p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>Google Authenticator (구글 OTP)</li>
                  <li>Microsoft Authenticator</li>
                  <li>Apple 키체인 / 1Password</li>
                </ul>
              </div>
              <Button type="button" onClick={beginEnrollment} disabled={busy} className="w-full">
                {busy ? "QR 코드 생성 중..." : "TOTP QR 코드 생성하기"}
              </Button>

              <div className="flex flex-col gap-1.5 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={beginExistingChallenge}
                  disabled={busy}
                  className="w-full text-xs"
                >
                  기존 등록된 OTP 코드로 바로 인증하기
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleResetAndReEnroll}
                  disabled={busy}
                  className="w-full text-xs text-muted-foreground hover:text-foreground"
                >
                  <RotateCcw className="size-3.5 mr-1" /> OTP 초기화 후 새로 발급받기
                </Button>
              </div>
            </div>
          )}

          {step === "challenge" && (
            <div className="space-y-4">
              {enrollment && (
                <div className="flex flex-col items-center justify-center p-4 border rounded-xl bg-card space-y-3">
                  {enrollment.qrCode && (
                    <img
                      className="size-48 rounded-lg shadow-sm border border-border bg-white p-2"
                      src={enrollment.qrCode}
                      alt="인증 앱으로 스캔할 TOTP QR 코드"
                    />
                  )}
                  <p className="text-xs text-center text-muted-foreground">
                    스마트폰 인증 앱의 카메라로 위 QR 코드를 스캔하세요.
                  </p>

                  {enrollment.secret && (
                    <div className="w-full pt-2 border-t space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                        <span className="flex items-center gap-1">
                          <KeyRound className="size-3 text-primary" /> 직접 입력용 비밀키 (Secret)
                        </span>
                        <button
                          type="button"
                          onClick={() => copySecretToClipboard(enrollment.secret!)}
                          className="flex items-center gap-1 text-primary hover:underline font-mono"
                        >
                          {copied ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
                          {copied ? "복사됨" : "복사"}
                        </button>
                      </div>
                      <div className="p-2 rounded bg-muted/60 font-mono text-center text-xs tracking-wider font-semibold select-all text-foreground border">
                        {enrollment.secret}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!enrollment && !challengeId && (
                <Button type="button" onClick={beginExistingChallenge} disabled={busy} variant="outline" className="w-full">
                  기존 등록된 OTP 코드로 인증하기
                </Button>
              )}

              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  void submitCode()
                }}
              >
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground" htmlFor="totp-code">
                    인증 앱에 표시된 6자리 코드
                  </label>
                  <Input
                    id="totp-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="예: 123456"
                    className="text-center font-mono text-lg tracking-widest"
                    required
                  />
                </div>
                <Button type="submit" disabled={busy || code.length < 6} className="w-full">
                  {busy ? "인증 확인 중..." : "6자리 코드 확인 및 인증"}
                </Button>
              </form>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={handleResetAndReEnroll}
                  disabled={busy}
                  className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 underline underline-offset-4"
                >
                  <RotateCcw className="size-3" /> OTP QR 코드가 안 보이거나 재설정하려면 여기를 누르세요
                </button>
              </div>
            </div>
          )}

          {step === "activate" && (
            <div className="space-y-4 text-center">
              <div className="rounded-full bg-emerald-500/10 text-emerald-600 size-12 flex items-center justify-center mx-auto">
                <CheckCircle2 className="size-6" />
              </div>
              <div className="space-y-1">
                <h3 className="font-semibold text-foreground">AAL2 보안 검증 성공</h3>
                <p className="text-xs text-muted-foreground">
                  이제 관리자 권한을 최종 활성화하고 Control Plane에 안전하게 진입합니다.
                </p>
              </div>
              <Button type="button" onClick={activate} disabled={busy} className="w-full">
                {busy ? "활성화 진행 중..." : "관리자 계정 활성화 완료"}
              </Button>
            </div>
          )}

          {step === "complete" && (
            <div className="space-y-4 text-center">
              <div className="rounded-full bg-primary/10 text-primary size-12 flex items-center justify-center mx-auto">
                <ShieldCheck className="size-6" />
              </div>
              <div className="space-y-1">
                <h3 className="font-semibold text-foreground">모든 설정이 완료되었습니다</h3>
                <p className="text-xs text-muted-foreground">소희 관리자 대시보드로 이동합니다.</p>
              </div>
              <Button onClick={() => navigation.replace("/admin")} className="w-full flex items-center justify-center gap-1.5">
                관리자 대시보드로 이동 <ArrowRight className="size-4" />
              </Button>
            </div>
          )}
        </CardContent>

        <CardFooter className="border-t pt-4 text-[11px] text-muted-foreground text-center flex justify-center">
          보안 문제 발생 시 슈퍼 관리자에게 문의하세요.
        </CardFooter>
      </Card>
    </main>
  )
}
