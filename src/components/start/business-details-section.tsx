'use client'

import { useId, useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, Info, ShieldAlert } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { normalizeBusinessNumber, validateBusinessNumberChecksum } from '@/lib/auth/business-verification'
import type { BusinessDetailsInput } from '@/features/quick-start/business-details'

type Props = {
  value: BusinessDetailsInput
  onChange: (patch: Partial<BusinessDetailsInput>) => void
  /** 값이 하나라도 채워져 있으면 처음부터 펼친다(재방문 시). */
  defaultOpen?: boolean
}

const formatBusinessNumber = (raw: string) => {
  const digits = normalizeBusinessNumber(raw).slice(0, 10)
  if (digits.length <= 3) return digits
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`
}

const formatPhone = (raw: string) => {
  const digits = raw.replace(/[^0-9]/g, '').slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  if (digits.length <= 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
}

/**
 * '우리 가게' 단계의 사업자·운영 정보 직접 입력.
 *
 * 네이버 플레이스 링크가 없는 사장님을 위한 통로다. 모든 항목이 선택이며,
 * 여기 입력은 **자가 입력(미검증)** 이므로 인증 상태로 승격되지 않는다.
 */
export function BusinessDetailsSection({ value, onChange, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()

  const brnDigits = normalizeBusinessNumber(value.businessNumber)
  const brnStatus =
    brnDigits.length === 0 ? 'empty' : brnDigits.length < 10 ? 'incomplete' : validateBusinessNumberChecksum(brnDigits) ? 'valid' : 'invalid'

  return (
    <section aria-labelledby={`${panelId}-title`} className="rounded-xl border border-border/70 bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-2 rounded-xl px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span id={`${panelId}-title`} className="text-sm font-bold text-foreground">
            사업자·운영 정보 직접 입력 <span className="font-normal text-muted-foreground">(선택)</span>
          </span>
          <span className="text-xs leading-relaxed text-muted-foreground">
            네이버 지도 링크가 없어도 괜찮아요. 직접 적어주시면 소희가 영업시간·주차 안내까지 정확히 써요.
          </span>
        </span>
        <ChevronDown
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open && (
        <div id={panelId} className="space-y-5 border-t border-border/70 px-4 py-4">
          <p className="flex items-start gap-1.5 rounded-lg bg-state-warn-soft px-3 py-2 text-xs leading-relaxed text-state-warn">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>사업자 인증과는 별개예요. 인증은 나중에 사업자등록증으로 따로 하실 수 있고, 여기 적은 내용은 아직 확인되지 않은 정보예요.</span>
          </p>

          <fieldset className="space-y-3">
            <legend className="text-xs font-bold uppercase tracking-wide text-muted-foreground">사업자 정보</legend>

            <div className="space-y-1.5">
              <Label htmlFor={`${panelId}-brn`} className="font-bold">사업자등록번호</Label>
              <Input
                id={`${panelId}-brn`}
                inputMode="numeric"
                value={formatBusinessNumber(value.businessNumber)}
                onChange={(event) => onChange({ businessNumber: normalizeBusinessNumber(event.target.value) })}
                placeholder="123-45-67890"
                maxLength={12}
                className="h-11"
                aria-describedby={`${panelId}-brn-hint`}
                aria-invalid={brnStatus === 'invalid'}
              />
              <p id={`${panelId}-brn-hint`} className="text-xs">
                {brnStatus === 'valid' && (
                  <span className="flex items-center gap-1 text-state-ok">
                    <CheckCircle2 className="size-3.5" aria-hidden /> 형식이 올바른 번호예요.
                  </span>
                )}
                {brnStatus === 'invalid' && (
                  <span className="flex items-center gap-1 text-destructive">
                    <AlertCircle className="size-3.5" aria-hidden /> 번호를 다시 확인해 주세요. (형식 검증 실패)
                  </span>
                )}
                {(brnStatus === 'empty' || brnStatus === 'incomplete') && (
                  <span className="text-muted-foreground">사업자등록증에 적힌 10자리 숫자를 입력해 주세요.</span>
                )}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${panelId}-rep`} className="font-bold">대표자명</Label>
                <Input
                  id={`${panelId}-rep`}
                  value={value.representativeName}
                  onChange={(event) => onChange({ representativeName: event.target.value })}
                  placeholder="예: 홍길동"
                  maxLength={60}
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${panelId}-start`} className="font-bold">개업일자</Label>
                <Input
                  id={`${panelId}-start`}
                  inputMode="numeric"
                  value={value.businessStartDate}
                  onChange={(event) => onChange({ businessStartDate: event.target.value.replace(/[^0-9]/g, '').slice(0, 8) })}
                  placeholder="예: 20240101"
                  maxLength={8}
                  className="h-11"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${panelId}-type`} className="font-bold">
                  업태 <span className="font-normal text-muted-foreground">(선택)</span>
                </Label>
                <Input
                  id={`${panelId}-type`}
                  value={value.businessType}
                  onChange={(event) => onChange({ businessType: event.target.value })}
                  placeholder="예: 서비스업"
                  maxLength={60}
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${panelId}-item`} className="font-bold">
                  종목 <span className="font-normal text-muted-foreground">(선택)</span>
                </Label>
                <Input
                  id={`${panelId}-item`}
                  value={value.businessItem}
                  onChange={(event) => onChange({ businessItem: event.target.value })}
                  placeholder="예: 미용, 카페, 요식업 등"
                  maxLength={60}
                  className="h-11"
                />
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-xs font-bold uppercase tracking-wide text-muted-foreground">운영 정보</legend>
            <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>여기 적어주신 내용은 소희가 글을 쓸 때 사실로 사용해요. 비워두면 그 내용은 글에 넣지 않아요.</span>
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${panelId}-phone`} className="font-bold">가게 전화번호</Label>
                <Input
                  id={`${panelId}-phone`}
                  type="tel"
                  value={formatPhone(value.phone)}
                  onChange={(event) => onChange({ phone: formatPhone(event.target.value) })}
                  placeholder="010-1234-5678"
                  maxLength={13}
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${panelId}-price`} className="font-bold">가격대</Label>
                <Input
                  id={`${panelId}-price`}
                  value={value.priceRange}
                  onChange={(event) => onChange({ priceRange: event.target.value })}
                  placeholder="예: 1인 3~5만원"
                  maxLength={60}
                  className="h-11"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${panelId}-hours`} className="font-bold">영업시간</Label>
              <Input
                id={`${panelId}-hours`}
                value={value.businessHours}
                onChange={(event) => onChange({ businessHours: event.target.value })}
                placeholder="예: 평일 10:00~19:00, 토요일 10:00~15:00"
                maxLength={120}
                className="h-11"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${panelId}-closed`} className="font-bold">휴무일</Label>
                <Input
                  id={`${panelId}-closed`}
                  value={value.closedDays}
                  onChange={(event) => onChange({ closedDays: event.target.value })}
                  placeholder="예: 매주 월요일"
                  maxLength={60}
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${panelId}-parking`} className="font-bold">주차 안내</Label>
                <Input
                  id={`${panelId}-parking`}
                  value={value.parkingInfo}
                  onChange={(event) => onChange({ parkingInfo: event.target.value })}
                  placeholder="예: 매장 앞 2대, 건물 주차장"
                  maxLength={120}
                  className="h-11"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${panelId}-reserve`} className="font-bold">예약 방법</Label>
              <Input
                id={`${panelId}-reserve`}
                value={value.reservationMethod}
                onChange={(event) => onChange({ reservationMethod: event.target.value })}
                placeholder="예: 네이버 예약, 전화 예약"
                maxLength={120}
                className="h-11"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${panelId}-site`} className="font-bold">웹사이트 / 블로그</Label>
              <Input
                id={`${panelId}-site`}
                type="url"
                inputMode="url"
                value={value.websiteUrl}
                onChange={(event) => onChange({ websiteUrl: event.target.value })}
                placeholder="예: https://blog.naver.com/mystore"
                maxLength={300}
                className="h-11"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${panelId}-place`} className="font-bold">네이버 플레이스 주소</Label>
              <Input
                id={`${panelId}-place`}
                type="url"
                inputMode="url"
                value={value.naverPlaceUrl}
                onChange={(event) => onChange({ naverPlaceUrl: event.target.value })}
                placeholder="예: https://naver.me/5xgJJEBa"
                maxLength={300}
                className="h-11"
              />
              <p className="text-xs text-muted-foreground">있으면 적어주세요. 소희가 리뷰·평점을 참고할 수 있어요.</p>
            </div>
          </fieldset>
        </div>
      )}
    </section>
  )
}

/** 접이식 섹션에서 쓰는 값이 하나라도 있는지. 재방문 시 기본 펼침 여부를 정한다. */
export function hasAnyDetailValue(value: BusinessDetailsInput): boolean {
  return Object.entries(value).some(
    ([key, entry]) => key !== 'intakeSource' && typeof entry === 'string' && entry.length > 0,
  )
}

/** 위저드가 저장 요청에 실을지 판단한다. 전부 비어 있으면 보내지 않는다. */
export function shouldSubmitDetails(value: BusinessDetailsInput): boolean {
  return hasAnyDetailValue(value)
}
