"use client";

import Link from "next/link";
import { useState, useEffect, useTransition } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { clearSupabaseAuthCookies } from "@/lib/supabase/clear-stale-auth-cookies";
import { validateBusinessNumberChecksum, normalizeBusinessNumber } from "@/lib/auth/business-verification";
import styles from "./signup.module.css";
import { Sparkles, CheckCircle2, AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const SIGNUP_DRAFT_KEY = 'sohee.signup.draft.v1';

type SignupDraft = {
  email: string;
  representativeName: string;
  phone: string;
  companyName: string;
  businessNumber: string;
  startDate: string;
  agreements: {
    terms: boolean;
    privacy: boolean;
    aiData: boolean;
    delegation: boolean;
    marketing: boolean;
  };
};

// 비밀번호는 저장하지 않는다. OAuth 복귀 시 복원되는 범위는 이 필드뿐이다.
function readSignupDraft(): Partial<SignupDraft> | null {
  try {
    const raw = window.sessionStorage.getItem(SIGNUP_DRAFT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Partial<SignupDraft>) : null;
  } catch {
    return null;
  }
}

function writeSignupDraft(draft: SignupDraft) {
  try {
    window.sessionStorage.setItem(SIGNUP_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // 저장에 실패해도 가입 흐름은 그대로 진행한다.
  }
}

function clearSignupDraft() {
  try {
    window.sessionStorage.removeItem(SIGNUP_DRAFT_KEY);
  } catch {
    // 무시: 삭제 실패가 가입을 막지 않는다.
  }
}

type SignupFormProps = {
  nextPath?: string;
  authReturnMessage?: string | null;
  preserveDraft?: boolean;
};

export function SignupForm({ nextPath = '/start', authReturnMessage = null, preserveDraft = false }: SignupFormProps = {}) {
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<'AUTH' | 'BUSINESS' | 'AGREEMENT' | 'ACTIVATING' | 'SUCCESS'>('AUTH');
  const [message, setMessage] = useState<string | null>(null);
  const [activationResult, setActivationResult] = useState<{ energyGranted?: number; verificationStatus?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [useEmailFallback, setUseEmailFallback] = useState(false);
  const [returningSignup, setReturningSignup] = useState(false);

  // 계정 정보 (이메일 가입용)
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");

  // 개인 및 사업자 정보
  const [representativeName, setRepresentativeName] = useState("");
  const [phone, setPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [businessNumber, setBusinessNumber] = useState("");
  const [startDate, setStartDate] = useState("");
  const [brnValid, setBrnValid] = useState<boolean | null>(null);
  const [isNtsLive, setIsNtsLive] = useState<boolean>(false);
  const [verificationFeedback, setVerificationFeedback] = useState<string | null>(null);

  // 약관 개별 동의 (ANI-557: Versioned Agreements & Channel Delegation)
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [agreeAiData, setAgreeAiData] = useState(false);
  const [agreeDelegation, setAgreeDelegation] = useState(false);
  const [agreeMarketing, setAgreeMarketing] = useState(false);

  const allAgreed = agreeTerms && agreePrivacy && agreeAiData && agreeDelegation && agreeMarketing;

  // OAuth 복귀 시 비밀번호를 제외한 입력값을 복원한다. (초안 저장 effect보다 먼저 선언해야 한다)
  // 복원이 실제로 렌더에 반영된 뒤에만 저장을 시작한다. ref로 즉시 열면 같은 커밋의 저장 effect가
  // 아직 비어 있는 초기값을 초안 위에 덮어써 복원이 무효가 된다. (StrictMode 이중 실행 시 초안 소실)
  const [draftRestored, setDraftRestored] = useState(!preserveDraft);
  useEffect(() => {
    if (preserveDraft) {
      const draft = readSignupDraft();
      if (draft) {
        if (typeof draft.email === 'string') setEmail(draft.email);
        if (typeof draft.representativeName === 'string') setRepresentativeName(draft.representativeName);
        if (typeof draft.phone === 'string') setPhone(draft.phone);
        if (typeof draft.companyName === 'string') setCompanyName(draft.companyName);
        if (typeof draft.businessNumber === 'string') setBusinessNumber(draft.businessNumber);
        if (typeof draft.startDate === 'string') setStartDate(draft.startDate);
        const agreements = draft.agreements;
        if (agreements && typeof agreements === 'object') {
          setAgreeTerms(Boolean(agreements.terms));
          setAgreePrivacy(Boolean(agreements.privacy));
          setAgreeAiData(Boolean(agreements.aiData));
          setAgreeDelegation(Boolean(agreements.delegation));
          setAgreeMarketing(Boolean(agreements.marketing));
        }
      }
    }
    setDraftRestored(true);
    // 복원은 최초 진입 시 한 번만 수행한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preserveDraft]);

  // 입력이 바뀔 때마다 비밀번호를 제외한 초안을 저장한다.
  useEffect(() => {
    if (!draftRestored) return;
    writeSignupDraft({
      email,
      representativeName,
      phone,
      companyName,
      businessNumber,
      startDate,
      agreements: {
        terms: agreeTerms,
        privacy: agreePrivacy,
        aiData: agreeAiData,
        delegation: agreeDelegation,
        marketing: agreeMarketing,
      },
    });
  }, [draftRestored, email, representativeName, phone, companyName, businessNumber, startDate, agreeTerms, agreePrivacy, agreeAiData, agreeDelegation, agreeMarketing]);

  // 가입이 끝나면 초안을 지운다.
  useEffect(() => {
    if (step === 'SUCCESS') clearSignupDraft();
  }, [step]);

  function handleToggleAllAgreements(checked: boolean) {
    setAgreeTerms(checked);
    setAgreePrivacy(checked);
    setAgreeAiData(checked);
    setAgreeDelegation(checked);
    setAgreeMarketing(checked);
    clearError();
  }

  // 초기 로드 시 기존 세션 및 가입 진행 상태 조회 (ANI-554)
  useEffect(() => {
    async function checkCurrentState() {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        try {
          const res = await fetch('/api/auth/signup-flow');
          if (res.ok) {
            const data = await res.json();
            if (data.isNtsLiveAvailable) {
              setIsNtsLive(true);
            }
            if (data.application) {
              const state = data.application.state;
              if (state === 'COMPLETED') {
                window.location.href = nextPath;
                return;
              } else if (state === 'AGREEMENT_REQUIRED' || state === 'TRIAL_READY') {
                setCompanyName(data.application.company_name || '');
                setRepresentativeName(data.application.representative_name || '');
                setBusinessNumber(data.application.business_number || '');
                setVerificationFeedback('사업자 확인이 완료되었습니다.');
                setStep('AGREEMENT');
                return;
              } else if (state === 'MANUAL_REVIEW') {
                setCompanyName(data.application.company_name || '');
                setRepresentativeName(data.application.representative_name || '');
                setBusinessNumber(data.application.business_number || '');
                setVerificationFeedback('사업자 정보가 접수되었습니다. 약관 동의 후 가입을 완료하시면 운영팀 확인 후 서비스가 활성화됩니다.');
                setStep('AGREEMENT');
                return;
              } else if (state === 'VERIFICATION_PENDING') {
                // [P0] 신청서 상태만으로 완료 처리하지 않는다. 워크스페이스가 실제로 결합된 경우에만 완료 화면을 보여준다.
                if (data.application.workspace_id) {
                  setActivationResult({ energyGranted: 0, verificationStatus: 'PENDING' });
                  setStep('SUCCESS');
                  setTimeout(() => {
                    window.location.href = nextPath;
                  }, 2000);
                } else {
                  setError('가입 마무리가 아직 완료되지 않았습니다. 같은 이메일과 비밀번호로 다시 시도해 주세요.');
                }
                return;
              } else if (state === 'FORM_REQUIRED' && !data.application.business_number) {
                const { error: provisionError } = await (supabase as any).rpc('provision_signup_workspace', {
                  p_user_id: user.id,
                  p_provider: user.app_metadata?.provider || 'email',
                });
                if (provisionError) {
                  setError('워크스페이스를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.');
                  return;
                }
                window.location.href = nextPath;
                return;
              } else if (data.application.company_name || data.application.business_number) {
                setCompanyName(data.application.company_name || '');
                setRepresentativeName(data.application.representative_name || '');
                setBusinessNumber(data.application.business_number || '');
                setReturningSignup(true);
              }
            }
          }
        } catch {
          setError('워크스페이스를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.');
          return;
        }
        setStep('BUSINESS');
      }
    }
    checkCurrentState();
  }, []);

  function clearError() {
    if (error) setError(null);
  }

  function handleBrnChange(val: string) {
    const clean = normalizeBusinessNumber(val);
    let formatted = clean;
    if (clean.length > 5) {
      formatted = `${clean.slice(0, 3)}-${clean.slice(3, 5)}-${clean.slice(5, 10)}`;
    } else if (clean.length > 3) {
      formatted = `${clean.slice(0, 3)}-${clean.slice(3)}`;
    }
    setBusinessNumber(formatted);
    clearError();

    if (clean.length === 10) {
      setBrnValid(validateBusinessNumberChecksum(clean));
    } else {
      setBrnValid(null);
    }
  }

  function handlePhoneChange(val: string) {
    const clean = val.replace(/[^0-9]/g, '');
    let formatted = clean;
    if (clean.length > 7) {
      formatted = `${clean.slice(0, 3)}-${clean.slice(3, 7)}-${clean.slice(7, 11)}`;
    } else if (clean.length > 3) {
      formatted = `${clean.slice(0, 3)}-${clean.slice(3)}`;
    }
    setPhone(formatted);
    clearError();
  }

  // Google OAuth 인증 (단 1개의 공식 소셜 로그인)
  async function handleGoogleLogin() {
    try {
      clearSupabaseAuthCookies();
      const supabase = createBrowserSupabaseClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`
        }
      });
      if (oauthError) setError(oauthError.message);
    } catch (err: any) {
      setError(err?.message || "Google 로그인 중 오류가 발생했습니다.");
    }
  }

  // 소희 이메일 신규 회원가입 체계 (개인정보 + 필수 사업자등록번호 원스톱 등록)
  async function handleEmailSignupSubmit(e: React.FormEvent) {
    e.preventDefault();
    clearError();

    // 1. 비밀번호 일치 검사
    if (password !== passwordConfirmation) {
      setError("비밀번호가 서로 일치하지 않습니다. 다시 확인해 주세요.");
      return;
    }
    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }

    // 2. 사업자등록번호 검증
    const cleanBrn = normalizeBusinessNumber(businessNumber);
    if (cleanBrn.length !== 10 || !validateBusinessNumberChecksum(cleanBrn)) {
      setError("올바른 10자리 사업자등록번호를 입력해 주세요. (국세청 체크섬 확인)");
      return;
    }

    // 3. 필수 개인 및 사업자 정보 확인
    if (!representativeName.trim()) {
      setError("대표자 성명을 입력해 주세요.");
      return;
    }
    if (!companyName.trim()) {
      setError("상호명(매장명)을 입력해 주세요.");
      return;
    }

    // 4. 필수 약관 동의 확인
    if (!agreeTerms || !agreePrivacy || !agreeAiData || !agreeDelegation) {
      setError("소희 서비스 이용을 위해 모든 필수 약관에 동의해 주세요.");
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch('/api/auth/register-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            password,
            representativeName: representativeName.trim(),
            phone: phone.trim(),
            companyName: companyName.trim(),
            businessNumber: cleanBrn,
            startDate: startDate.trim() || undefined,
            agreements: {
              termsOfService: agreeTerms,
              privacyPolicy: agreePrivacy,
              aiDataProcessing: agreeAiData,
              channelDelegation: agreeDelegation,
              marketingConsent: agreeMarketing,
            },
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          setError(data.error || '회원가입에 실패했습니다.');
          return;
        }

        // 가입 완료 후 자동 로그인
        const supabase = createBrowserSupabaseClient();
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });

        if (signInErr) {
          // 자동 로그인이 지연되는 경우 로그인 화면으로 이동
          window.location.href = '/login?registered=true';
          return;
        }

        setStep('SUCCESS');
        setTimeout(() => {
          window.location.href = nextPath;
        }, 1200);
      } catch (err: any) {
        setError(err?.message || '회원가입 처리 중 오류가 발생했습니다. 다시 시도해 주세요.');
      }
    });
  }

  // 기존 사용자 사업자 정보 제출 및 국세청 진위확인 (ANI-555)
  async function submitBusinessInfo(e: React.FormEvent) {
    e.preventDefault();
    const cleanBrn = normalizeBusinessNumber(businessNumber);

    if (cleanBrn.length !== 10 || !validateBusinessNumberChecksum(cleanBrn)) {
      setError("올바른 10자리 사업자등록번호를 입력해 주세요.");
      return;
    }
    if (!companyName.trim() || !representativeName.trim()) {
      setError("상호명과 대표자명을 입력해 주세요.");
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/auth/signup-flow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update_business',
            businessNumber: cleanBrn,
            companyName: companyName.trim(),
            representativeName: representativeName.trim(),
            startDate: startDate.trim() || undefined
          })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          setError(data.error || '사업자 정보 검증에 실패했습니다.');
          return;
        }

        if (data.validation?.status === 'MISMATCH') {
          setError('입력하신 상호명 또는 대표자명이 국세청 등록 정보와 일치하지 않습니다. 사업자등록증의 정보를 정확히 입력해 주세요.');
          return;
        }
        if (data.validation?.status === 'CLOSED_BUSINESS') {
          setError('폐업된 사업자등록번호입니다. 계속사업자 정보를 입력해 주세요.');
          return;
        }

        if (data.validation?.status === 'VERIFIED') {
          setVerificationFeedback(data.validation?.valid_msg || '국세청 정보와 정상 일치합니다.');
        } else {
          setVerificationFeedback('사업자 정보가 안전하게 접수되었습니다. 약관 동의 후 가입을 완료하시면 운영팀 확인 후 서비스가 활성화됩니다.');
        }
        setStep('AGREEMENT');
      } catch (err: any) {
        setError(err?.message || '사업자 정보 저장 중 오류가 발생했습니다.');
      }
    });
  }

  // 약관 개별 동의 및 워크스페이스 활성화 (ANI-557, ANI-556)
  async function submitAgreements(e: React.FormEvent) {
    e.preventDefault();
    if (!agreeTerms || !agreePrivacy || !agreeAiData || !agreeDelegation) {
      setError("소희의 안전한 마케팅 운영을 위해 모든 필수 약관에 동의해 주세요.");
      return;
    }

    setError(null);
    setStep('ACTIVATING');

    startTransition(async () => {
      try {
        const resAgreements = await fetch('/api/auth/signup-flow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'submit_agreements',
            agreements: {
              termsOfService: agreeTerms,
              privacyPolicy: agreePrivacy,
              aiDataProcessing: agreeAiData,
              channelDelegation: agreeDelegation
            }
          })
        });

        if (!resAgreements.ok) {
          const errData = await resAgreements.json();
          throw new Error(errData.error || '약관 동의 처리에 실패했습니다.');
        }

        const resActivate = await fetch('/api/auth/signup-flow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'provision_education' })
        });

        if (!resActivate.ok) {
          const errData = await resActivate.json();
          throw new Error(errData.error || '교육용 워크스페이스 활성화에 실패했습니다.');
        }

        const actData = await resActivate.json();
        setActivationResult(actData);
        setStep('SUCCESS');
        setTimeout(() => {
          window.location.href = nextPath;
        }, 1500);
      } catch (err: any) {
        setError(err?.message || '가입 완료 처리 중 오류가 발생했습니다.');
        setStep('AGREEMENT');
      }
    });
  }

  if (message) {
    return (
      <section className={styles.confirmation} aria-live="polite">
        <div className="flex items-center gap-2 text-state-ok font-bold mb-2">
          <CheckCircle2 className="w-6 h-6" />
          <span>가입 인증 완료</span>
        </div>
        <h2>{message}</h2>
        <Link href="/login" className="inline-block mt-4 text-state-wait hover:underline">
          로그인으로 돌아가기
        </Link>
      </section>
    );
  }

  // Step: ACTIVATING / SUCCESS
  if (step === 'ACTIVATING' || step === 'SUCCESS') {
    return (
      <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
        {step === 'ACTIVATING' ? (
          <>
            <Loader2 className="w-10 h-10 text-state-wait animate-spin" />
            <h3 className="text-lg font-bold text-zinc-900 dark:text-white">사업자 검증 및 워크스페이스 활성화 중...</h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">국세청 사업자 원장 등록 및 맞춤 마케팅 작업공간을 원자적으로 생성하고 있습니다.</p>
          </>
        ) : (
          <>
            <div className="w-12 h-12 rounded-full bg-state-ok/20 text-state-ok flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-zinc-900 dark:text-white">
              소희 회원가입 완료!
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm">
              소희 작업공간으로 이동합니다. 인스타그램·스레드 연결 시 첫 포스팅 무료 제작 혜택이 제공됩니다.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {authReturnMessage ? (
        <Alert variant="info">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>이어서 가입할 수 있어요</AlertTitle>
          <AlertDescription className="text-current">{authReturnMessage}</AlertDescription>
        </Alert>
      ) : null}

      {returningSignup ? (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-4 text-xs text-zinc-600 dark:text-zinc-300">
          진행 중이던 사업자 확인 절차를 이어서 완료할 수 있습니다.
        </div>
      ) : (
        <div className="rounded-xl border border-state-wait/30 bg-state-wait-soft/50 p-3.5 text-xs text-state-wait flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-state-wait shrink-0" />
          <span>신용카드 등록 없이 시작하세요. 가입 후 Instagram·Threads 중 1곳 이상 연결하면 첫 포스팅을 무료로 제작해 드려요.</span>
        </div>
      )}

      {/* STEP 1: AUTH (Google OAuth or Email Signup Form) */}
      {step === 'AUTH' && (
        <div className="space-y-4">
          {/* 구글 소셜 간편가입 (구글만 허용) */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            className="w-full min-h-[46px] flex items-center justify-center gap-3 py-2.5 px-4 rounded-xl bg-white border border-zinc-300 hover:bg-zinc-50 text-zinc-800 font-semibold text-sm shadow-sm transition-all active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-wait/30"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>Google 계정으로 시작하기</span>
          </button>

          <div className="flex items-center gap-3 my-2" aria-hidden="true">
            <div className="flex-1 h-[1px] bg-zinc-200 dark:bg-zinc-800" />
            <span className="text-xs text-zinc-600 dark:text-zinc-400 font-medium">또는 이메일로 가입하기</span>
            <div className="flex-1 h-[1px] bg-zinc-200 dark:bg-zinc-800" />
          </div>

          <form
            aria-label="고객 회원가입"
            className={styles.form}
            onSubmit={handleEmailSignupSubmit}
          >
              {/* 1. 계정 정보 */}
              <div className="space-y-3">
                <div className="text-xs font-bold text-state-wait uppercase tracking-wider">
                  1. 로그인 계정 정보
                </div>
                <label htmlFor="signup-email">
                  이메일 주소
                  <input
                    id="signup-email"
                    autoComplete="email"
                    name="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); clearError(); }}
                    placeholder="ceo@store.com"
                    required
                    type="email"
                    className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-wait/30"
                  />
                </label>
                <label htmlFor="signup-password">
                  비밀번호
                  <input
                    id="signup-password"
                    autoComplete="new-password"
                    minLength={8}
                    name="password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); clearError(); }}
                    placeholder="8자 이상 입력해 주세요"
                    required
                    type="password"
                    className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-wait/30"
                  />
                </label>
                <label htmlFor="signup-password-confirmation">
                  비밀번호 확인
                  <input
                    id="signup-password-confirmation"
                    autoComplete="new-password"
                    minLength={8}
                    name="passwordConfirmation"
                    value={passwordConfirmation}
                    onChange={(e) => { setPasswordConfirmation(e.target.value); clearError(); }}
                    placeholder="비밀번호를 한 번 더 입력해 주세요"
                    required
                    type="password"
                    className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-wait/30"
                  />
                </label>
              </div>

              {/* 2. 대표자 개인정보 */}
              <div className="space-y-3 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                <div className="text-xs font-bold text-state-wait uppercase tracking-wider">
                  2. 대표자 정보
                </div>
                <label htmlFor="signup-representative-name">
                  대표자 성명
                  <input
                    id="signup-representative-name"
                    name="representativeName"
                    value={representativeName}
                    onChange={(e) => { setRepresentativeName(e.target.value); clearError(); }}
                    placeholder="예: 홍길동"
                    required
                    type="text"
                    className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-wait/30"
                  />
                </label>
                <label htmlFor="signup-phone">
                  휴대폰 번호
                  <input
                    id="signup-phone"
                    name="phone"
                    value={phone}
                    onChange={(e) => handlePhoneChange(e.target.value)}
                    placeholder="010-1234-5678"
                    maxLength={13}
                    required
                    type="tel"
                    className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-wait/30"
                  />
                </label>
              </div>

              {/* 3. 사업자 정보 (사업자등록번호 필수) */}
              <div className="space-y-3 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                <div className="text-xs font-bold text-state-wait uppercase tracking-wider flex items-center justify-between">
                  <span>3. 사업자 정보 (필수)</span>
                  <span className="text-[11px] text-zinc-600 dark:text-zinc-400 font-normal">국세청 실시간 체크</span>
                </div>
                <label htmlFor="signup-company-name">
                  상호명 (매장/법인명)
                  <input
                    id="signup-company-name"
                    name="companyName"
                    value={companyName}
                    onChange={(e) => { setCompanyName(e.target.value); clearError(); }}
                    placeholder="예: 소희카페 강남본점"
                    required
                    type="text"
                    className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-wait/30"
                  />
                </label>

                <label htmlFor="signup-business-number">
                  사업자등록번호 (10자리)
                  <input
                    id="signup-business-number"
                    name="businessNumber"
                    value={businessNumber}
                    onChange={(e) => handleBrnChange(e.target.value)}
                    placeholder="123-45-67890"
                    required
                    type="text"
                    maxLength={12}
                    className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-wait/30"
                  />
                  {brnValid === true && (
                    <span className="text-[11px] text-state-ok flex items-center gap-1 mt-1" role="status">
                      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> 유효한 사업자번호 형식입니다.
                    </span>
                  )}
                  {brnValid === false && (
                    <span className="text-[11px] text-state-danger flex items-center gap-1 mt-1" role="alert" aria-live="polite">
                      <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" /> 국세청 체크섬 검증에 실패했습니다.
                    </span>
                  )}
                </label>

                <label htmlFor="start-date">
                  개업일자 (선택)
                  <input
                    id="start-date"
                    name="startDate"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    placeholder="예: 20240101"
                    aria-describedby="start-date-hint"
                    type="text"
                    maxLength={8}
                    className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-wait/30"
                  />
                  <p id="start-date-hint" className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    사업자등록증의 개업연월일 8자리를 입력하시면 빠른 확인이 가능해요.
                  </p>
                </label>
              </div>

              {/* 4. 약관 동의 */}
              <div className="space-y-2.5 pt-2 border-t border-zinc-200 dark:border-zinc-800 text-xs text-zinc-700 dark:text-zinc-300">
                <div className="text-xs font-bold text-state-wait uppercase tracking-wider mb-1">
                  4. 약관 동의
                </div>

                {/* 전체 동의 */}
                <label htmlFor="agree-all" className={styles.allAgreeBox}>
                  <input
                    id="agree-all"
                    type="checkbox"
                    checked={allAgreed}
                    onChange={(e) => handleToggleAllAgreements(e.target.checked)}
                  />
                  <span>모든 약관에 전체 동의합니다</span>
                </label>

                {/* 1. 서비스 이용약관 */}
                <div className="flex items-center gap-2">
                  <label htmlFor="agree-terms" className={`${styles.checkboxLabel} min-h-[44px] flex-1`}>
                    <input
                      id="agree-terms"
                      type="checkbox"
                      checked={agreeTerms}
                      onChange={(e) => { setAgreeTerms(e.target.checked); clearError(); }}
                    />
                    <span>
                      <strong className="text-state-wait">[필수]</strong> 서비스 이용약관 동의 (버전 2026.09-v1)
                    </span>
                  </label>
                  <Link
                    href="/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="서비스 이용약관 원문 새 창에서 열기"
                    className={styles.legalLink}
                  >
                    보기
                  </Link>
                </div>

                {/* 2. 개인정보 처리방침 */}
                <div className="flex items-center gap-2">
                  <label htmlFor="agree-privacy" className={`${styles.checkboxLabel} min-h-[44px] flex-1`}>
                    <input
                      id="agree-privacy"
                      type="checkbox"
                      checked={agreePrivacy}
                      onChange={(e) => { setAgreePrivacy(e.target.checked); clearError(); }}
                    />
                    <span>
                      <strong className="text-state-wait">[필수]</strong> 개인정보 수집 및 이용 동의 (버전 2026.09-v1)
                    </span>
                  </label>
                  <Link
                    href="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="개인정보 수집 및 이용 약관 원문 새 창에서 열기"
                    className={styles.legalLink}
                  >
                    보기
                  </Link>
                </div>

                {/* 3. AI 데이터 처리 위임 */}
                <label htmlFor="agree-ai-data" className={`${styles.checkboxLabel} min-h-[44px]`}>
                  <input
                    id="agree-ai-data"
                    type="checkbox"
                    checked={agreeAiData}
                    onChange={(e) => { setAgreeAiData(e.target.checked); clearError(); }}
                  />
                  <span>
                    <strong className="text-state-wait">[필수]</strong> AI 마케팅 에이전트 지능 학습 및 데이터 처리 위임
                  </span>
                </label>

                {/* 4. SNS 채널 발행 지원 및 약관 동의 */}
                <label htmlFor="agree-delegation" className={`${styles.checkboxLabel} min-h-[44px]`}>
                  <input
                    id="agree-delegation"
                    type="checkbox"
                    checked={agreeDelegation}
                    onChange={(e) => { setAgreeDelegation(e.target.checked); clearError(); }}
                  />
                  <span>
                    <strong className="text-state-wait">[필수]</strong> SNS 마케팅 채널(인스타그램·스레드) 연동 및 발행 지원 동의 — 발행은 사장님 승인 후 진행, 네이버 블로그·당근은 원고 준비까지 지원
                  </span>
                </label>

                {/* 5. 마케팅 성과 알림 (선택) */}
                <label htmlFor="agree-marketing" className={`${styles.checkboxLabel} min-h-[44px] text-zinc-500`}>
                  <input
                    id="agree-marketing"
                    type="checkbox"
                    checked={agreeMarketing}
                    onChange={(e) => setAgreeMarketing(e.target.checked)}
                  />
                  <span>
                    [선택] 일일 마케팅 성과 리포트 및 크레딧 혜택 알림 수신
                  </span>
                </label>
              </div>

              {error && (
                <div className={styles.error} role="alert" aria-live="assertive">
                  {error}
                </div>
              )}

              <button
                disabled={isPending}
                type="submit"
                className="w-full min-h-[48px] py-3 rounded-xl bg-state-wait-soft hover:bg-state-wait text-state-wait font-bold text-sm shadow-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-wait/30 inline-flex items-center justify-center gap-2"
              >
                {isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>소희 회원가입 및 워크스페이스 준비 중...</span>
                  </>
                ) : (
                  <span>소희 회원가입 완료</span>
                )}
              </button>
            </form>
        </div>
      )}

      {/* STEP 2: BUSINESS (기존 Google 로그인 후 미완료된 사업자 진위확인) */}
      {step === 'BUSINESS' && (
        <form onSubmit={submitBusinessInfo} className="space-y-4">
          <div className="flex items-center gap-2 text-xs text-state-wait font-bold" aria-current="step" aria-label="1단계: 사업자등록 정보 진위확인">
            <span className="w-5 h-5 rounded-full bg-state-wait/20 flex items-center justify-center" aria-hidden="true">1</span>
            <span>사업자등록 정보 진위확인 {isNtsLive ? '(국세청 실시간 연동)' : ''}</span>
          </div>

          <div className="space-y-3 p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800">
            <label htmlFor="company-name" className="block text-xs text-zinc-700 dark:text-zinc-300 font-medium">
              상호명 (법인/매장명)
              <input
                id="company-name"
                value={companyName}
                onChange={(e) => { setCompanyName(e.target.value); clearError(); }}
                placeholder="예: 소희카페 강남본점"
                required
                className="mt-1 w-full px-3 py-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-sm text-zinc-900 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-wait/30"
                type="text"
              />
            </label>

            <label htmlFor="representative-name" className="block text-xs text-zinc-700 dark:text-zinc-300 font-medium">
              대표자 성명
              <input
                id="representative-name"
                value={representativeName}
                onChange={(e) => { setRepresentativeName(e.target.value); clearError(); }}
                placeholder="예: 홍길동"
                required
                className="mt-1 w-full px-3 py-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-sm text-zinc-900 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-wait/30"
                type="text"
              />
            </label>

            <label htmlFor="business-number" className="block text-xs text-zinc-700 dark:text-zinc-300 font-medium">
              사업자등록번호 (10자리)
              <input
                id="business-number"
                value={businessNumber}
                onChange={(e) => handleBrnChange(e.target.value)}
                placeholder="123-45-67890"
                required
                className="mt-1 w-full px-3 py-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-sm text-zinc-900 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-wait/30"
                type="text"
                maxLength={12}
              />
              {brnValid === true && (
                <span className="text-[11px] text-state-ok flex items-center gap-1 mt-1" role="status">
                  <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> 유효한 사업자번호 형식입니다.
                </span>
              )}
              {brnValid === false && (
                <span className="text-[11px] text-state-danger flex items-center gap-1 mt-1" role="alert" aria-live="polite">
                  <AlertCircle className="w-3 h-3" aria-hidden="true" /> 국세청 체크섬 검증에 실패했습니다.
                </span>
              )}
            </label>

            <label htmlFor="start-date" className="block text-xs text-zinc-700 dark:text-zinc-300 font-medium">
              개업일자 (입력하면 확인이 빨라져요)
              <input
                id="start-date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                placeholder="예: 20240101"
                aria-describedby="start-date-hint"
                className="mt-1 w-full px-3 py-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-sm text-zinc-900 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-wait/30"
                type="text"
                maxLength={8}
              />
            </label>
            <p id="start-date-hint" className="text-[11px] text-zinc-500 dark:text-zinc-400">
              사업자등록증에 적힌 &apos;개업연월일&apos;이에요. 입력하면 국세청에서 바로 확인돼서 심사가 빨라져요.
            </p>
          </div>

          {error && <div className={styles.error} role="alert" aria-live="assertive">{error}</div>}

          <button
            disabled={isPending}
            type="submit"
            className="w-full min-h-[44px] py-3 rounded-xl bg-state-wait-soft hover:bg-state-wait text-state-wait font-bold text-sm shadow-lg transition flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-wait/30"
          >
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>{isNtsLive ? '국세청 실시간 진위확인 중...' : '사업자등록 정보 확인 중...'}</span>
              </>
            ) : (
              <>
                <span>다음 단계 (약관 동의)</span>
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </>
            )}
          </button>
        </form>
      )}

      {/* STEP 3: AGREEMENT (ANI-557 개별 약관 및 채널 위임 분리 동의) */}
      {step === 'AGREEMENT' && (
        <form onSubmit={submitAgreements} className="space-y-4">
          <div className="flex items-center gap-2 text-xs text-state-wait font-bold" aria-current="step" aria-label="2단계: 법적 약관 및 AI 채널 운영 위임 동의">
            <span className="w-5 h-5 rounded-full bg-state-wait/20 flex items-center justify-center" aria-hidden="true">2</span>
            <span>법적 약관 및 AI 채널 운영 위임 동의</span>
          </div>

          {verificationFeedback && (
            <div className="p-3 rounded-xl bg-state-ok-soft border border-state-ok/30 text-xs text-state-ok flex items-center gap-2" role="status">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-state-ok" aria-hidden="true" />
              <span>{verificationFeedback}</span>
            </div>
          )}

          <div className="space-y-3 p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-700 dark:text-zinc-300">
            {/* 1. 서비스 이용약관 */}
            <div className="flex items-center gap-2">
              <label htmlFor="agree-terms" className="min-h-[44px] flex-1 flex items-center gap-2.5 cursor-pointer py-1">
                <input
                  id="agree-terms"
                  type="checkbox"
                  checked={agreeTerms}
                  onChange={(e) => { setAgreeTerms(e.target.checked); clearError(); }}
                  className="mt-0.5 rounded border-zinc-300 dark:border-zinc-700 text-state-wait focus-visible:ring-2 focus-visible:ring-state-wait/30"
                />
                <span className="leading-snug">
                  <strong className="text-state-wait">[필수]</strong> 서비스 이용약관 동의 (버전 2026.09-v1)
                </span>
              </label>
              <Link
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="서비스 이용약관 원문 새 창에서 열기"
                className={styles.legalLink}
              >
                보기
              </Link>
            </div>

            {/* 2. 개인정보 처리방침 */}
            <div className="flex items-center gap-2">
              <label htmlFor="agree-privacy" className="min-h-[44px] flex-1 flex items-center gap-2.5 cursor-pointer py-1">
                <input
                  id="agree-privacy"
                  type="checkbox"
                  checked={agreePrivacy}
                  onChange={(e) => { setAgreePrivacy(e.target.checked); clearError(); }}
                  className="mt-0.5 rounded border-zinc-300 dark:border-zinc-700 text-state-wait focus-visible:ring-2 focus-visible:ring-state-wait/30"
                />
                <span className="leading-snug">
                  <strong className="text-state-wait">[필수]</strong> 개인정보 수집 및 이용 동의 (버전 2026.09-v1)
                </span>
              </label>
              <Link
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="개인정보 수집 및 이용 약관 원문 새 창에서 열기"
                className={styles.legalLink}
              >
                보기
              </Link>
            </div>

            {/* 3. AI 데이터 처리 위임 */}
            <label htmlFor="agree-ai-data" className="min-h-[44px] flex items-center gap-2.5 cursor-pointer py-1">
              <input
                id="agree-ai-data"
                type="checkbox"
                checked={agreeAiData}
                onChange={(e) => { setAgreeAiData(e.target.checked); clearError(); }}
                className="mt-0.5 rounded border-zinc-300 dark:border-zinc-700 text-state-wait focus-visible:ring-2 focus-visible:ring-state-wait/30"
              />
              <span className="leading-snug">
                <strong className="text-state-wait">[필수]</strong> AI 마케팅 에이전트 지능 학습 및 데이터 처리 위임 동의
              </span>
            </label>

            {/* 4. SNS 채널 발행 지원 및 약관 동의 */}
            <label htmlFor="agree-delegation" className="min-h-[44px] flex items-center gap-2.5 cursor-pointer py-1">
              <input
                id="agree-delegation"
                type="checkbox"
                checked={agreeDelegation}
                onChange={(e) => { setAgreeDelegation(e.target.checked); clearError(); }}
                className="mt-0.5 rounded border-zinc-300 dark:border-zinc-700 text-state-wait focus-visible:ring-2 focus-visible:ring-state-wait/30"
              />
              <span className="leading-snug">
                <strong className="text-state-wait">[필수]</strong> <strong>SNS 마케팅 채널(인스타그램·스레드) 연동 및 발행 지원 동의 — 발행은 사장님 승인 후 진행, 네이버 블로그·당근은 원고 준비까지 지원</strong>
              </span>
            </label>

            <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800">
              {/* 5. 마케팅 성과 브리핑 (선택) */}
              <label htmlFor="agree-marketing" className="min-h-[44px] flex items-center gap-2.5 cursor-pointer text-zinc-500 py-1">
                <input
                  id="agree-marketing"
                  type="checkbox"
                  checked={agreeMarketing}
                  onChange={(e) => setAgreeMarketing(e.target.checked)}
                  className="mt-0.5 rounded border-zinc-300 dark:border-zinc-700 text-state-wait focus-visible:ring-2 focus-visible:ring-state-wait/30"
                />
                <span className="leading-snug">
                  [선택] 일일 마케팅 성과 리포트 및 크레딧 혜택 알림 수신
                </span>
              </label>
            </div>
          </div>

          {error && <div className={styles.error} role="alert" aria-live="assertive">{error}</div>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep('BUSINESS')}
              className="min-h-[44px] py-3 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-medium text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-wait/30 inline-flex items-center justify-center"
            >
              이전으로
            </button>
            <button
              disabled={isPending || !agreeTerms || !agreePrivacy || !agreeAiData || !agreeDelegation}
              type="submit"
              className="flex-1 min-h-[44px] py-3 rounded-xl bg-state-wait-soft hover:bg-state-wait disabled:opacity-50 text-state-wait font-bold text-sm shadow-lg transition flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-wait/30"
            >
              <Sparkles className="w-4 h-4" aria-hidden="true" />
              <span>소희 시작하기</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
