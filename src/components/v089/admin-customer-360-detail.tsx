"use client";

import { useState } from "react";
import { Customer360WorkspaceView } from "@/lib/admin/customer-360-read-model";
import { ShieldCheck, CreditCard, CheckCircle2, XCircle, PlusCircle, AlertCircle, Sparkles } from "lucide-react";

interface Customer360DetailProps {
  initialData?: Partial<Customer360WorkspaceView>;
  /** True when the verification read failed, so the status must not be presented as a real value. */
  verificationUnknown?: boolean;
}

export type AdminMembershipTier = 'TRIAL' | 'PENDING_REVIEW' | 'FORMAL' | 'REJECTED';

export function AdminCustomer360Detail({
  initialData,
  verificationUnknown = false,
}: Customer360DetailProps) {
  const workspaceId = initialData?.workspaceId;
  const [verificationStatus, setVerificationStatus] = useState(
    initialData?.businessVerificationStatus ?? 'PENDING'
  );
  const [totalCredits, setTotalCredits] = useState<number | null>(
    typeof initialData?.creditBalance?.total === 'number' ? initialData.creditBalance.total : null
  );
  const [businessInfo, setBusinessInfo] = useState({
    companyName: initialData?.companyName || '',
    businessNumber: initialData?.businessNumber || '',
    representativeName: initialData?.representativeName || '',
  });

  const [inputCompanyName, setInputCompanyName] = useState(
    initialData?.companyName && initialData.companyName !== '심사 대상 매장' ? initialData.companyName : ''
  );
  const [inputBusinessNumber, setInputBusinessNumber] = useState(
    initialData?.businessNumber && initialData.businessNumber !== '0000000000' ? initialData.businessNumber : ''
  );
  const [inputRepresentativeName, setInputRepresentativeName] = useState(
    initialData?.representativeName || ''
  );

  const [isProcessing, setIsProcessing] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 사업자 정보 유효 여부
  const hasValidExistingInfo = Boolean(
    businessInfo.businessNumber &&
    businessInfo.businessNumber !== '0000000000' &&
    businessInfo.businessNumber.replace(/\D/g, '').length === 10 &&
    businessInfo.companyName &&
    businessInfo.companyName !== '심사 대상 매장'
  );

  // 회원 등급 계산
  const statusStr = String(verificationStatus);
  const membershipTier: AdminMembershipTier =
    statusStr === 'VERIFIED'
      ? 'FORMAL'
      : statusStr === 'REJECTED'
      ? 'REJECTED'
      : (statusStr === 'PENDING' || statusStr === 'DOCUMENT_REQUIRED' || statusStr === 'MISMATCH') && hasValidExistingInfo
      ? 'PENDING_REVIEW'
      : 'TRIAL';

  const tierBadgeConfig = {
    FORMAL: {
      label: '정식회원',
      tone: 'border-state-ok/30 bg-state-ok/10 text-state-ok',
    },
    PENDING_REVIEW: {
      label: '심사중',
      tone: 'border-state-warn/30 bg-state-warn/10 text-state-warn',
    },
    REJECTED: {
      label: '심사 반려',
      tone: 'border-state-danger/30 bg-state-danger/10 text-state-danger',
    },
    TRIAL: {
      label: '체험회원',
      tone: 'border-state-wait/30 bg-state-wait/10 text-state-wait',
    },
  }[membershipTier];

  async function handleVerifyStatusChange(newStatus: 'VERIFIED' | 'REJECTED') {
    if (!workspaceId) {
      setErrorMessage('고객사 정보를 확인할 수 없어 처리할 수 없어요.');
      return;
    }

    const payload: Record<string, any> = {
      status: newStatus,
      reason: newStatus === 'VERIFIED' ? '운영자 수동 승인' : '운영자 서류 반려',
    };

    if (newStatus === 'VERIFIED') {
      const cleanInputBNum = inputBusinessNumber.replace(/\D/g, '');

      // 만약 기존 정보가 없거나 불완전하면 입력 폼 값 검증
      if (!hasValidExistingInfo) {
        if (!cleanInputBNum || cleanInputBNum.length !== 10) {
          setErrorMessage('사업자등록번호 10자리를 정확히 입력해 주세요.');
          return;
        }
        if (!inputCompanyName.trim()) {
          setErrorMessage('상호명을 입력해 주세요.');
          return;
        }
        payload.businessNumber = cleanInputBNum;
        payload.companyName = inputCompanyName.trim();
        payload.representativeName = inputRepresentativeName.trim() || undefined;
      } else if (cleanInputBNum && cleanInputBNum.length === 10) {
        // 기존 정보가 있어도 사용자가 입력 폼을 채웠으면 새 정보 반영
        payload.businessNumber = cleanInputBNum;
        if (inputCompanyName.trim()) payload.companyName = inputCompanyName.trim();
        if (inputRepresentativeName.trim()) payload.representativeName = inputRepresentativeName.trim();
      }
    }

    setIsProcessing(true);
    setActionMessage(null);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/admin/workspaces/${workspaceId}/verify-business`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setErrorMessage(data.error || '상태 변경에 실패했습니다.');
        return;
      }

      setVerificationStatus(newStatus);
      if (newStatus === 'VERIFIED' && payload.businessNumber) {
        setBusinessInfo({
          companyName: payload.companyName || businessInfo.companyName,
          businessNumber: payload.businessNumber,
          representativeName: payload.representativeName || businessInfo.representativeName,
        });
      }
      setActionMessage(data.message || (newStatus === 'VERIFIED' ? '사업자 심사를 승인했어요.' : '사업자 심사를 반려했어요.'));
    } catch (err: any) {
      setErrorMessage(err?.message || '네트워크 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleAddCredits(amount: number) {
    if (!window.confirm(`${amount.toLocaleString('ko-KR')} 크레딧을 이 고객사에 지급할까요? 지급 내역은 감사 기록에 남아요.`)) return;
    if (!workspaceId) {
      setErrorMessage('고객사 정보를 확인할 수 없어 처리할 수 없어요.');
      return;
    }
    setIsProcessing(true);
    setActionMessage(null);
    setErrorMessage(null);

    try {
      const idempotencyKey = `admin-adj:${workspaceId}:${crypto.randomUUID()}`;
      const res = await fetch(`/api/admin/workspaces/${workspaceId}/adjust-credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          reason: '운영자 수동 충전 지급',
          idempotencyKey
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setErrorMessage(data.error || '크레딧 지급에 실패했습니다.');
        return;
      }

      if (typeof data.newAuthoritativeBalance === 'number') {
        setTotalCredits(data.newAuthoritativeBalance);
      } else {
        setTotalCredits(prev => (prev === null ? null : prev + amount));
      }
      setActionMessage(data.message || `${amount.toLocaleString('ko-KR')} 크레딧을 지급했어요.`);
    } catch (err: any) {
      setErrorMessage(err?.message || '네트워크 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <section aria-labelledby="c360-ops-title" className="space-y-5 rounded-2xl border bg-card p-5 shadow-xs">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="c360-ops-title" className="text-lg font-extrabold text-foreground">사업자 심사·크레딧 관리</h2>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
              verificationUnknown
                ? 'border-border bg-muted text-muted-foreground'
                : tierBadgeConfig.tone
            }`}>
              <Sparkles className="h-3 w-3" aria-hidden />
              <span>{verificationUnknown ? '심사 상태 확인 불가' : tierBadgeConfig.label}</span>
            </span>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              verificationStatus === 'VERIFIED'
                ? 'border-state-ok/30 bg-state-ok/10 text-state-ok'
                : verificationStatus === 'REJECTED'
                ? 'border-state-danger/30 bg-state-danger/10 text-state-danger'
                : 'border-state-warn/30 bg-state-warn/10 text-state-warn'
            }`}>
              {verificationUnknown ? '심사 상태 미확인' : verificationStatus === 'VERIFIED' ? '사업자 검증 완료' : verificationStatus === 'REJECTED' ? '사업자 심사 반려' : '사업자 심사 대기'}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {businessInfo.companyName || '상호 미등록'} · 사업자번호 {businessInfo.businessNumber || '미등록'} · 대표자 {businessInfo.representativeName || '미입력'}
          </p>
        </div>

        <div aria-live="polite" className="space-y-2">
          {actionMessage && (
            <div className="flex items-center gap-2 rounded-xl border border-state-ok/30 bg-state-ok/10 px-3 py-1.5 text-sm text-state-ok">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
              <span>{actionMessage}</span>
            </div>
          )}
          {errorMessage && (
            <div role="alert" className="flex items-center gap-2 rounded-xl border border-state-danger/30 bg-state-danger/10 px-3 py-1.5 text-sm text-state-danger">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
          <div className="flex items-center justify-between text-sm font-bold text-foreground">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-state-wait" aria-hidden />
              <span>사업자등록 심사 및 승인</span>
            </span>
            <span className="text-xs font-semibold text-muted-foreground">
              {membershipTier === 'FORMAL' ? '정식 전환 완료' : '정식 승인 대기'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">승인하거나 반려하면 처리 내용이 감사 기록에 남아요.</p>

          {/* 사업자 정보가 없거나 보완이 필요한 경우 입력 폼 노출 */}
          {!hasValidExistingInfo && verificationStatus !== 'VERIFIED' && (
            <div className="space-y-2 rounded-lg border border-state-warn/30 bg-state-warn/5 p-3">
              <div className="text-xs font-semibold text-state-warn">
                사업자 정보가 등록되지 않았습니다. 승인 시 함께 입력해 주세요.
              </div>
              <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                <div>
                  <label htmlFor="company-name-input" className="block text-[11px] font-medium text-muted-foreground">
                    상호명 *
                  </label>
                  <input
                    id="company-name-input"
                    type="text"
                    value={inputCompanyName}
                    onChange={(e) => setInputCompanyName(e.target.value)}
                    placeholder="예: 소희카페"
                    className="mt-1 h-8 w-full rounded border border-input bg-card px-2 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-primary"
                  />
                </div>
                <div>
                  <label htmlFor="business-number-input" className="block text-[11px] font-medium text-muted-foreground">
                    사업자등록번호 (10자리) *
                  </label>
                  <input
                    id="business-number-input"
                    type="text"
                    maxLength={12}
                    value={inputBusinessNumber}
                    onChange={(e) => setInputBusinessNumber(e.target.value)}
                    placeholder="숫자 10자리"
                    className="mt-1 h-8 w-full rounded border border-input bg-card px-2 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-primary"
                  />
                </div>
                <div>
                  <label htmlFor="representative-name-input" className="block text-[11px] font-medium text-muted-foreground">
                    대표자명
                  </label>
                  <input
                    id="representative-name-input"
                    type="text"
                    value={inputRepresentativeName}
                    onChange={(e) => setInputRepresentativeName(e.target.value)}
                    placeholder="대표자 이름"
                    className="mt-1 h-8 w-full rounded border border-input bg-card px-2 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-primary"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => handleVerifyStatusChange('VERIFIED')}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl bg-state-ok text-sm font-bold text-state-ok-soft hover:bg-state-ok/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-ok disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              <span>심사 승인 (정식 전환)</span>
            </button>
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => handleVerifyStatusChange('REJECTED')}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl border border-state-danger/40 bg-state-danger-soft text-sm font-bold text-state-danger hover:bg-state-danger-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-danger disabled:opacity-50"
            >
              <XCircle className="h-4 w-4" aria-hidden />
              <span>반려</span>
            </button>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
          <div className="flex items-center justify-between text-sm font-bold text-foreground">
            <span className="flex items-center gap-1.5">
              <CreditCard className="h-4 w-4 text-foreground" aria-hidden />
              <span>크레딧 지급</span>
            </span>
            <span className="text-state-wait">{totalCredits === null ? '잔액을 확인할 수 없어요' : `${totalCredits.toLocaleString('ko-KR')} 크레딧`}</span>
          </div>
          <p className="text-xs text-muted-foreground">지급하면 크레딧 내역에 조정 기록이 남아요.</p>
          <div className="pt-1">
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => handleAddCredits(10000)}
              className="inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-xl bg-state-wait text-sm font-bold text-state-wait-soft hover:bg-state-wait/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-wait disabled:opacity-50"
            >
              <PlusCircle className="h-4 w-4" aria-hidden />
              <span>10,000 크레딧 지급</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
