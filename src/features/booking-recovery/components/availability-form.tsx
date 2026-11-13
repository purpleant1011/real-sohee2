'use client';

import React, { useState } from 'react';
import type { CatalogService, AvailabilitySlotInput } from '../availability';

interface AvailabilityFormProps {
  services: CatalogService[];
  workspaceTimezone?: string;
  onSubmit: (input: AvailabilitySlotInput) => Promise<void>;
  isSubmitting?: boolean;
}

/**
 * Converts a datetime-local input value ("YYYY-MM-DDTHH:mm") into an ISO-8601 string
 * calibrated against the target workspace timezone (default 'Asia/Seoul'),
 * avoiding browser local OS timezone distortions.
 */
function localDateTimeToTzIso(localDateTimeStr: string, timeZone: string): string {
  // Pattern: YYYY-MM-DDTHH:mm
  const match = localDateTimeStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error('올바른 날짜/시간 형식이 아닙니다 (YYYY-MM-DDTHH:mm).');
  }

  // For Asia/Seoul (KST), standard offset is +09:00.
  // Validate timezone with Intl.
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
  } catch {
    throw new Error(`지원하지 않는 매장 시간대입니다: ${timeZone}`);
  }

  // Construct ISO string with offset for Seoul (+09:00) or calculate accurately
  if (timeZone === 'Asia/Seoul') {
    return `${localDateTimeStr}:00+09:00`;
  }

  // Generic offset calculation for any IANA timezone
  const approxDate = new Date(`${localDateTimeStr}:00Z`);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  });
  const parts = formatter.formatToParts(approxDate);
  const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value; // e.g. "GMT+09:00"
  const offset = tzPart ? tzPart.replace('GMT', '') || '+00:00' : '+09:00';

  return `${localDateTimeStr}:00${offset}`;
}

export function AvailabilityForm({
  services,
  workspaceTimezone = 'Asia/Seoul',
  onSubmit,
  isSubmitting = false,
}: AvailabilityFormProps) {
  const [selectedServiceId, setSelectedServiceId] = useState<string>(
    services[0]?.id ?? ''
  );
  const [startsAt, setStartsAt] = useState<string>('');
  const [endsAt, setEndsAt] = useState<string>('');
  const [depositInputStr, setDepositInputStr] = useState<string>('0');
  const [acknowledged, setAcknowledged] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isInFlight, setIsInFlight] = useState<boolean>(false);

  const selectedService = services.find((s) => s.id === selectedServiceId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isInFlight || isSubmitting) return; // In-flight guard against rapid double clicks
    setErrorMsg(null);

    if (!selectedServiceId) {
      setErrorMsg('서비스를 선택해 주세요.');
      return;
    }

    if (!startsAt || !endsAt) {
      setErrorMsg('예약 시작 및 종료 일시를 입력해 주세요.');
      return;
    }

    // Strict deposit validation (no silent Math.max or parseInt truncation)
    const trimmedDeposit = depositInputStr.trim();
    if (!/^\d+$/.test(trimmedDeposit)) {
      setErrorMsg('예약금은 0원 이상의 정수 금액으로 정확히 입력해 주세요 (소수점/음수 불가).');
      return;
    }

    const depositKrw = Number(trimmedDeposit);
    if (!Number.isSafeInteger(depositKrw) || depositKrw < 0) {
      setErrorMsg('올바른 예약금 금액을 입력해 주세요.');
      return;
    }

    if (selectedService?.price !== null && selectedService?.price !== undefined) {
      if (depositKrw > selectedService.price) {
        setErrorMsg(`예약금은 서비스 금액(${selectedService.price.toLocaleString()}원)을 초과할 수 없습니다.`);
        return;
      }
    }

    // ANI-1609 (A안): a service without a catalog duration can never pass the server guard.
    // Never fall back to the slot length — ask the owner to set the duration first.
    if (
      selectedService?.durationMinutes === null ||
      selectedService?.durationMinutes === undefined ||
      !Number.isSafeInteger(selectedService.durationMinutes) ||
      selectedService.durationMinutes <= 0
    ) {
      setErrorMsg(
        '이 서비스는 소요시간이 설정되지 않아 예약 시간을 등록할 수 없습니다. 매장 정보에서 서비스 소요시간을 먼저 설정해 주세요.'
      );
      return;
    }

    {
      const startMs = Date.parse(localDateTimeToTzIso(startsAt, workspaceTimezone));
      const endMs = Date.parse(localDateTimeToTzIso(endsAt, workspaceTimezone));
      const slotDurationMinutes = Math.floor((endMs - startMs) / (60 * 1000));
      if (slotDurationMinutes < selectedService.durationMinutes) {
        setErrorMsg(
          `선택한 슬롯 시간(${slotDurationMinutes}분)이 서비스 소요시간(${selectedService.durationMinutes}분)보다 짧습니다.`
        );
        return;
      }
    }

    let startIso: string;
    let endIso: string;
    try {
      startIso = localDateTimeToTzIso(startsAt, workspaceTimezone);
      endIso = localDateTimeToTzIso(endsAt, workspaceTimezone);
    } catch (err: any) {
      setErrorMsg(err.message);
      return;
    }

    const startMs = Date.parse(startIso);
    const endMs = Date.parse(endIso);

    if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) {
      setErrorMsg('종료 일시는 시작 일시보다 뒤여야 합니다.');
      return;
    }

    if (!acknowledged) {
      setErrorMsg('실제 매장 예약표(장부)를 확인했음을 체크해 주세요.');
      return;
    }

    setIsInFlight(true);
    try {
      await onSubmit({
        serviceId: selectedServiceId,
        startsAt: startIso,
        endsAt: endIso,
        depositKrw,
        timezone: workspaceTimezone,
        acknowledgedLedger: true,
      });
    } catch (err: any) {
      setErrorMsg(err.message || '가용 시간 등록에 실패했습니다.');
    } finally {
      setIsInFlight(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm"
      aria-label="가용 시간 확인 폼"
    >
      <div>
        <label
          htmlFor="service-select"
          className="block text-sm font-medium text-foreground"
        >
          예약 서비스 선택
        </label>
        <select
          id="service-select"
          value={selectedServiceId}
          onChange={(e) => setSelectedServiceId(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
        >
          {services.map((service) => (
            <option key={service.id} value={service.id}>
              {service.name} (
              {service.price !== null
                ? `${service.price.toLocaleString()}원`
                : '가격 미정'}
              )
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-foreground">
            서비스 정가 (등록된 서비스 정보 기준)
          </label>
          <span className="rounded bg-state-warn-soft px-2 py-0.5 text-xs font-medium text-state-warn border border-[var(--state-warn-line)]">
            외부 장부 미연동 · 사장님 수동 확인 필수
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm font-medium text-foreground">
          <span>
            {selectedService?.price !== null && selectedService?.price !== undefined
              ? `${selectedService.price.toLocaleString()}원`
              : '가격 미정 (등록된 서비스 정보 확인 필요)'}
          </span>
          <span className="text-xs text-muted-foreground">
            {selectedService?.durationMinutes
              ? `기준 소요시간: ${selectedService.durationMinutes}분`
              : '소요시간 미설정'}
          </span>
        </div>
      </div>

      <div>
        <label
          htmlFor="deposit-input"
          className="block text-sm font-medium text-foreground"
        >
          예약금 (원, 명시적 0원 가능)
        </label>
        <input
          id="deposit-input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={depositInputStr}
          onChange={(e) => setDepositInputStr(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
          placeholder="0"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="starts-at-input"
            className="block text-sm font-medium text-foreground"
          >
            시작 일시 ({workspaceTimezone === 'Asia/Seoul' ? '한국 시간' : workspaceTimezone})
          </label>
          <input
            id="starts-at-input"
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
          />
        </div>
        <div>
          <label
            htmlFor="ends-at-input"
            className="block text-sm font-medium text-foreground"
          >
            종료 일시 ({workspaceTimezone === 'Asia/Seoul' ? '한국 시간' : workspaceTimezone})
          </label>
          <input
            id="ends-at-input"
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <input
          id="acknowledge-checkbox"
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="h-4 w-4 rounded border-border text-primary focus:ring-ring"
        />
        <label
          htmlFor="acknowledge-checkbox"
          className="text-xs text-muted-foreground"
        >
          사장님이 실제 매장 예약표(장부)를 확인했습니다 (15분간 유효한 예약 가능 시간 생성)
        </label>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-lg bg-state-danger-soft p-2.5 text-xs text-state-danger"
        >
          {errorMsg}
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting || isInFlight || !acknowledged}
        className="w-full rounded-lg bg-foreground py-2.5 text-sm font-medium text-background transition hover:bg-foreground/90 disabled:opacity-50"
      >
        {isSubmitting || isInFlight ? '확인 중...' : '예약 가능 시간 확인 및 제안 준비'}
      </button>
    </form>
  );
}
