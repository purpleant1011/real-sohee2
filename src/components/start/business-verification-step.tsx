'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Clock, FileText, Loader2, Lock, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { validateBusinessRegistrationNumber } from '@/features/business-verification/state-machine'

interface VerificationInfo {
  status: string
  companyName: string
  businessNumber: string
  representativeName: string
  startDate: string
  rejectionReason: string | null
}

const EMPTY: VerificationInfo = {
  status: 'NOT_STARTED',
  companyName: '',
  businessNumber: '',
  representativeName: '',
  startDate: '',
  rejectionReason: null,
}

const digits = (value: string) => value.replace(/[^0-9]/g, '')

function formatBusinessNumber(value: string) {
  const d = digits(value).slice(0, 10)
  if (d.length <= 3) return d
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`
}

export function BusinessVerificationStep({ onSubmitted }: { onSubmitted: () => void }) {
  const [loading, setLoading] = useState(true)
  const [info, setInfo] = useState<VerificationInfo>(EMPTY)
  const [businessNumber, setBusinessNumber] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [representativeName, setRepresentativeName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const notified = useRef(false)

  const notifySubmitted = useCallback(() => {
    if (notified.current) return
    notified.current = true
    onSubmitted()
  }, [onSubmitted])

  const load = useCallback(async () => {
    const res = await fetch('/api/auth/business-verification')
    const data = await res.json()
    const v = data?.verification
    if (!v) return
    const next: VerificationInfo = {
      status: v.status ?? 'NOT_STARTED',
      companyName: v.companyName ?? '',
      businessNumber: v.businessNumber ?? '',
      representativeName: v.representativeName ?? '',
      startDate: v.startDate ?? '',
      rejectionReason: v.rejectionReason ?? null,
    }
    setInfo(next)
    setBusinessNumber(formatBusinessNumber(next.businessNumber))
    setCompanyName(next.companyName)
    setRepresentativeName(next.representativeName)
    setStartDate(next.startDate)
    if (next.status === 'VERIFIED') notifySubmitted()
  }, [notifySubmitted])

  useEffect(() => {
    load()
      .catch(() => setError('인증 상태를 불러오지 못했어요. 새로고침해 주세요.'))
      .finally(() => setLoading(false))
  }, [load])

  const numberValid = validateBusinessRegistrationNumber(businessNumber).isValid
  const canSubmit =
    numberValid &&
    companyName.trim().length >= 2 &&
    representativeName.trim().length >= 2 &&
    digits(startDate).length === 8 &&
    Boolean(file) &&
    !busy

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const body = new FormData()
      body.set('file', file)
      const upload = await fetch('/api/auth/business-verification/document', { method: 'POST', body })
      const uploaded = await upload.json()
      if (!upload.ok || !uploaded.documentPath) throw new Error(uploaded.error ?? '파일을 올리지 못했어요.')

      const res = await fetch('/api/auth/business-verification', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          businessNumber: digits(businessNumber),
          companyName: companyName.trim(),
          representativeName: representativeName.trim(),
          startDate: digits(startDate),
          documentPath: uploaded.documentPath,
        }),
      })
      const data = await res.json()
      const status = data?.verification?.status
      if (status === 'VERIFIED' || status === 'PENDING') {
        setInfo((prev) => ({ ...prev, status }))
        notifySubmitted()
        return
      }
      throw new Error(data?.verification?.message ?? data?.error ?? '입력한 정보를 다시 확인해 주세요.')
    } catch (err: any) {
      setError(err?.message ?? '인증 요청에 실패했어요.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16" role="status" aria-live="polite">
        <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
        <span className="sr-only">인증 상태를 확인하는 중</span>
      </div>
    )
  }

  if (info.status === 'PENDING') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="size-5 text-state-warn" aria-hidden /> 신청이 접수됐어요
          </CardTitle>
          <CardDescription>승인 전에는 체험회원으로 시작할 수 있어요. 승인되면 모든 기능이 열려요.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-2 rounded-xl bg-muted p-4 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-muted-foreground">상호</dt><dd className="font-medium">{info.companyName || '-'}</dd></div>
            <div><dt className="text-xs text-muted-foreground">사업자등록번호</dt><dd className="font-medium">{formatBusinessNumber(info.businessNumber) || '-'}</dd></div>
            <div><dt className="text-xs text-muted-foreground">대표자명</dt><dd className="font-medium">{info.representativeName || '-'}</dd></div>
          </dl>
          <div className="flex flex-col gap-2">
            <Button className="h-11 min-h-[44px] w-full" onClick={onSubmitted}>
              다음으로
            </Button>
            <Button variant="outline" className="h-11 min-h-[44px] w-full" onClick={() => load().catch(() => setError('상태를 새로 불러오지 못했어요.'))}>
              상태 새로고침
            </Button>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShieldCheck className="size-5 text-primary" aria-hidden />
          <h2>사업자 인증</h2>
        </CardTitle>
        <CardDescription>정확한 정보를 입력하면 국세청에서 바로 확인해요.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-5">
          {info.status === 'REJECTED' && (
            <div role="alert" className="flex gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div>
                <p className="font-medium">사업자 정보를 다시 확인해 주세요</p>
                <p>{info.rejectionReason ?? '입력한 정보가 국세청 등록 정보와 달라요. 수정해서 다시 올려주세요.'}</p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="biz-number">사업자등록번호</Label>
            <div className="relative">
              <Input
                id="biz-number"
                inputMode="numeric"
                placeholder="000-00-00000"
                value={businessNumber}
                onChange={(e) => setBusinessNumber(formatBusinessNumber(e.target.value))}
                aria-invalid={businessNumber.length > 0 && !numberValid}
              />
              {numberValid && <CheckCircle2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-state-ok" aria-label="형식이 맞아요" />}
            </div>
            {businessNumber.length > 0 && !numberValid && <p className="text-xs text-muted-foreground">숫자 10자리를 정확히 입력해 주세요.</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="biz-company">상호</Label>
              <Input id="biz-company" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="사업자등록증에 적힌 상호" maxLength={60} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="biz-rep">대표자명</Label>
              <Input id="biz-rep" value={representativeName} onChange={(e) => setRepresentativeName(e.target.value)} placeholder="예: 김소희" maxLength={30} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="biz-start">
              개업일자 <span className="font-normal text-muted-foreground">(사업자등록증에 적힌 날짜, 예: 20240101)</span>
            </Label>
            <Input
              id="biz-start"
              inputMode="numeric"
              placeholder="예: 20240101"
              value={startDate}
              onChange={(e) => setStartDate(digits(e.target.value).slice(0, 8))}
              maxLength={8}
              aria-describedby="biz-start-hint"
            />
            <p id="biz-start-hint" className="text-xs text-muted-foreground">
              사업자등록증에 적힌 &apos;개업연월일&apos;이에요. 입력하면 국세청에서 바로 확인돼서 심사가 빨라져요.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="biz-document">사업자등록증 첨부</Label>
            <div className="flex items-center gap-3 rounded-xl border border-dashed p-4">
              <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1 text-sm">
                {file ? <p className="truncate font-medium">{file.name}</p> : <p className="text-muted-foreground">PDF 또는 사진(JPG, PNG), 최대 8MB</p>}
              </div>
              <input
                id="biz-document"
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                className="text-sm file:mr-3 file:rounded-lg file:border file:bg-background file:px-3 file:py-2 file:text-sm"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="size-3.5" aria-hidden /> 사업자등록증은 인증 목적으로만 안전하게 보관돼요
            </p>
          </div>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="h-11 min-h-[44px] w-full" disabled={!canSubmit}>
            {busy && <Loader2 className="animate-spin" aria-hidden />} 인증 요청하기
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
