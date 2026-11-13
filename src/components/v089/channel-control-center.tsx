"use client";

import { useState, useEffect } from "react";
import { OFFICIAL_CHANNELS, ChannelId } from "@/lib/channels/channel-registry";
import { ExternalActionReceipt } from "@/lib/channels/external-evidence-verifier";
import { CheckCircle2, AlertCircle, RefreshCw, Send, Shield, ExternalLink, Sparkles, Link2, X, Unlink, ArrowLeft, ArrowRight, ChevronRight, ChevronDown, Sliders, Lock, Unlock } from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { normalizeChannelInput } from "@/features/channels/channel-handle-normalizer";
import { ProductionReadinessCard, CapabilityReadinessRow, ScopeDriftAlert, WebhookHealthBadge } from "@/components/v088/same-truth";

export type ChannelStatusMap = Record<ChannelId, {
  status: 'CONNECTED' | 'AUTHORIZED' | 'DISCONNECTED' | 'PENDING' | 'REAUTH_REQUIRED';
  accountLabel?: string;
  lastVerifiedAt?: string;
  webhookStatus?: string;
  lastWebhookAt?: string | null;
}>;

interface ChannelControlCenterProps {
  initialConnections?: Partial<ChannelStatusMap>;
}

export function ChannelControlCenter({ initialConnections = {} }: ChannelControlCenterProps) {
  const [publishingChannel, setPublishingChannel] = useState<ChannelId | null>(null);
  const [receipts, setReceipts] = useState<Record<ChannelId, ExternalActionReceipt | null>>({
    INSTAGRAM: null,
    THREADS: null,
    NAVER_BLOG: null,
    DAANGN: null
  });
  const [errorMessages, setErrorMessages] = useState<Record<ChannelId, string | null>>({
    INSTAGRAM: null,
    THREADS: null,
    NAVER_BLOG: null,
    DAANGN: null
  });
  const [naverBridgeNotification, setNaverBridgeNotification] = useState<{
    open: boolean;
    title: string;
    url: string;
  } | null>(null);

  const [activeModalChannel, setActiveModalChannel] = useState<ChannelId | null>(null);
  const [naverBlogIdInput, setNaverBlogIdInput] = useState('');
  const [isSavingNaver, setIsSavingNaver] = useState(false);
  const [celebrationNotification, setCelebrationNotification] = useState<{
    open: boolean;
    channelId: ChannelId;
    accountLabel: string;
  } | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [showTechnicalDiagnostics, setShowTechnicalDiagnostics] = useState(false);

  const [connections, setConnections] = useState<ChannelStatusMap>({
    INSTAGRAM: initialConnections.INSTAGRAM || { status: 'DISCONNECTED' },
    THREADS: initialConnections.THREADS || { status: 'DISCONNECTED' },
    NAVER_BLOG: initialConnections.NAVER_BLOG || { status: 'DISCONNECTED' },
    DAANGN: initialConnections.DAANGN || { status: 'PENDING' },
  });

  // Canonical Webhook Truth (ANI-1021: Zero False-Green)
  const rawWebhookStatus = (connections.INSTAGRAM?.webhookStatus || connections.THREADS?.webhookStatus || '').toLowerCase();
  const metaLastWebhookAt = connections.INSTAGRAM?.lastWebhookAt || connections.THREADS?.lastWebhookAt || null;

  let metaWebhookStatus: 'HEALTHY' | 'DEGRADED' | 'FAILED' | 'PENDING' = 'PENDING';
  if ((rawWebhookStatus === 'healthy' || rawWebhookStatus === 'ready') && metaLastWebhookAt) {
    const lagHours = (Date.now() - new Date(metaLastWebhookAt).getTime()) / (1000 * 3600);
    metaWebhookStatus = lagHours > 24 ? 'DEGRADED' : 'HEALTHY';
  } else if (rawWebhookStatus === 'error') {
    metaWebhookStatus = 'FAILED';
  } else {
    metaWebhookStatus = 'PENDING';
  }

  // Handle URL callback parameters on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const connectResult = params.get('connect');
      const rawChannel = params.get('channel');
      const account = params.get('account');
      const errCode = params.get('connect_error');

      if (connectResult === 'authorized' && rawChannel) {
        const chId = rawChannel.toUpperCase() as ChannelId;
        if (OFFICIAL_CHANNELS[chId]) {
          setConnections(prev => ({
            ...prev,
            [chId]: {
              status: 'AUTHORIZED',
              accountLabel: account || prev[chId]?.accountLabel || '@connected',
            }
          }));
          setCelebrationNotification({
            open: true,
            channelId: chId,
            accountLabel: account || '@connected',
          });
        }
        window.history.replaceState({}, '', window.location.pathname);
      } else if (connectResult === 'connected' && rawChannel) {
        const chId = rawChannel.toUpperCase() as ChannelId;
        if (OFFICIAL_CHANNELS[chId]) {
          setConnections(prev => ({
            ...prev,
            [chId]: {
              status: 'CONNECTED',
              accountLabel: account || prev[chId]?.accountLabel,
            }
          }));
        }
        window.history.replaceState({}, '', window.location.pathname);
      } else if ((connectResult === 'unavailable' || connectResult === 'invalid') && rawChannel) {
        const chId = rawChannel.toUpperCase() as ChannelId;
        if (OFFICIAL_CHANNELS[chId]) {
          setErrorMessages(prev => ({
            ...prev,
            [chId]: `채널 연동 중 오류가 발생했습니다 (${errCode || connectResult}). 다시 시도해 주세요.`
          }));
        }
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  }, []);

  // Load server-owned connections on mount
  useEffect(() => {
    async function loadConnections() {
      try {
        const res = await fetch('/api/channels/credentials');
        if (res.ok) {
          const data = await res.json();
          if (data.connections && Array.isArray(data.connections)) {
            const nextMap: Partial<ChannelStatusMap> = {};
            for (const c of data.connections) {
              const chId = c.channel.toUpperCase() as ChannelId;
              if (OFFICIAL_CHANNELS[chId]) {
                const rawStatus = (c.status || '').toUpperCase();
                let status: 'CONNECTED' | 'AUTHORIZED' | 'DISCONNECTED' | 'PENDING' | 'REAUTH_REQUIRED' = 'DISCONNECTED';
                if (rawStatus === 'CONNECTED' || rawStatus === 'VERIFIED') status = 'CONNECTED';
                else if (rawStatus === 'AUTHORIZED' || rawStatus === 'CONFIGURED') status = 'AUTHORIZED';
                else if (rawStatus === 'REAUTH_REQUIRED' || rawStatus === 'REVERIFY_REQUIRED') status = 'REAUTH_REQUIRED';
                else if (rawStatus === 'PENDING') status = 'PENDING';

                nextMap[chId] = {
                  status,
                  accountLabel: c.account_label || undefined,
                  lastVerifiedAt: c.updated_at || undefined,
                  webhookStatus: c.webhook_status || undefined,
                  lastWebhookAt: c.last_webhook_at || null,
                };
              }
            }
            setConnections(prev => ({ ...prev, ...nextMap }));
          }
        }
      } catch {
        // Safe ignore
      }
    }
    loadConnections();
  }, []);

  async function handleTestPublish(channelId: ChannelId) {
    setPublishingChannel(channelId);
    setErrorMessages(prev => ({ ...prev, [channelId]: null }));
    try {
      const res = await fetch('/api/channels/test-publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId })
      });
      const data = await res.json();
      
      if (!res.ok && res.status !== 202) {
        setErrorMessages(prev => ({ ...prev, [channelId]: data.message || '실발행 검증에 실패했습니다.' }));
        return;
      }

      if (data.receipt) {
        setReceipts(prev => ({ ...prev, [channelId]: data.receipt }));
        if (data.receipt.status === 'VERIFIED') {
          setConnections(prev => ({
            ...prev,
            [channelId]: {
              ...prev[channelId],
              status: 'CONNECTED',
              lastVerifiedAt: new Date().toISOString(),
            }
          }));
          if (celebrationNotification?.channelId === channelId) {
            setCelebrationNotification(null);
          }
        }
      }

      // 네이버 스마트에디터 실발행 브릿지 동작
      if (data.method === 'SMART_EDITOR_BRIDGE' && data.editorUrl) {
        if (data.copyPayload && typeof navigator !== 'undefined' && navigator.clipboard) {
          try {
            await navigator.clipboard.writeText(data.copyPayload);
          } catch (e) {
            console.warn('Clipboard write failed:', e);
          }
        }
        window.open(data.editorUrl, '_blank');
        setNaverBridgeNotification({
          open: true,
          title: data.title || '소희 맞춤 칼럼',
          url: data.editorUrl
        });
      }
    } catch (err: any) {
      setErrorMessages(prev => ({ ...prev, [channelId]: err?.message || '통신 오류가 발생했습니다.' }));
    } finally {
      setPublishingChannel(null);
    }
  }

  async function handleDisconnect(channelId: ChannelId) {
    if (!confirm(`${OFFICIAL_CHANNELS[channelId].displayName} 채널 연동을 정말 해제하시겠습니까?`)) {
      return;
    }
    try {
      const res = await fetch('/api/channels/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId,
          action: 'disconnect'
        })
      });
      if (res.ok) {
        setConnections(prev => ({
          ...prev,
          [channelId]: {
            status: 'DISCONNECTED',
            accountLabel: undefined
          }
        }));
        setReceipts(prev => ({ ...prev, [channelId]: null }));
      }
    } catch {
      alert('연동 해제 중 오류가 발생했습니다.');
    }
  }

  async function handleSaveNaverBlog() {
    if (!naverBlogIdInput.trim()) return;
    setIsSavingNaver(true);
    try {
      const res = await fetch('/api/channels/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: 'NAVER_BLOG',
          accountLabel: naverBlogIdInput.trim()
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setConnections(prev => ({
          ...prev,
          NAVER_BLOG: {
            status: 'AUTHORIZED',
            accountLabel: data.accountLabel
          }
        }));
        setActiveModalChannel(null);
        setNaverBlogIdInput('');
      } else {
        alert(data.error || '저장에 실패했습니다.');
      }
    } catch (err: any) {
      alert(err.message || '오류가 발생했습니다.');
    } finally {
      setIsSavingNaver(false);
    }
  }

  const connectedCount = Object.values(connections).filter(
    c => c.status === 'CONNECTED' || c.status === 'AUTHORIZED'
  ).length;

  async function handleUnlockAndGoNext() {
    setIsUnlocking(true);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('sohee_onboarded', 'true');
        document.cookie = 'sohee_onboarded=true; path=/; max-age=31536000';
      } catch {}
    }

    try {
      const primaryAccount =
        connections.INSTAGRAM.accountLabel ||
        connections.THREADS.accountLabel ||
        connections.NAVER_BLOG.accountLabel ||
        '나의 소희 마케팅';

      if (typeof window !== 'undefined') {
        localStorage.setItem('sohee_business_name', primaryAccount);
      }

      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: members } = await supabase
          .from('workspace_members')
          .select('workspace_id')
          .eq('user_id', user.id)
          .limit(1);

        const wsId = members?.[0]?.workspace_id;
        if (wsId) {
          await (supabase as any).from('business_profiles').upsert({
            workspace_id: wsId,
            business_name: primaryAccount,
            updated_at: new Date().toISOString()
          }, { onConflict: 'workspace_id' });

          await (supabase as any).from('workspaces').update({
            name: primaryAccount
          }).eq('id', wsId);
        }
      }
    } catch (e) {
      console.warn('Unlock profile update non-fatal error:', e);
    }

    window.location.replace('/app');
  }

  function handleStartMetaOAuth(channelId: 'INSTAGRAM' | 'THREADS') {
    const provider = channelId.toLowerCase();
    const returnPath = typeof window !== 'undefined' ? window.location.pathname : '/app/channels';
    window.location.href = `/api/channels/${provider}/connect?returnPath=${encodeURIComponent(returnPath)}`;
  }

  return (
    <div className="space-y-6">
      {/* 🧭 네비게이션 상단 바 (이전 화면으로 돌아가기 & 상단 다음 단계 액션) */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-zinc-200/80 dark:border-zinc-800/80">
        <button
          type="button"
          onClick={() => {
            if (typeof window !== 'undefined') {
              if (window.history.length > 1) {
                window.history.back();
              } else {
                window.location.href = '/start';
              }
            }
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-zinc-50 bg-zinc-100 dark:bg-zinc-800/80 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>이전 화면으로 돌아가기</span>
        </button>

        <div className="flex items-center gap-2">
          {connectedCount > 0 ? (
            <button
              type="button"
              disabled={isUnlocking}
              onClick={handleUnlockAndGoNext}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black text-primary-foreground bg-gradient-to-r from-primary to-state-wait hover:from-primary hover:to-state-wait shadow-md shadow-state-wait/20 transition cursor-pointer disabled:opacity-50"
            >
              <span>다음 단계: 잠금 해제 & 대시보드 가동 🚀</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <span className="text-xs text-zinc-400 font-medium">
              최소 1개 채널 연동 시 메뉴 해금 가능
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-zinc-950 dark:text-zinc-50 tracking-tight flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-state-wait" />
            <span>나의 소희 4대 채널 컨트롤 센터</span>
          </h2>
          <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 mt-0.5">
            소희가 사장님 대신 자율적으로 활동할 SNS, 블로그 채널의 공식 계정 로그인을 연결하고, 1회 인증 포스팅으로 실게시 검증을 완료하세요.
          </p>
        </div>
      </div>

      {/* 🌟 1. 4대 공식 채널 연동 카드 그리드 (Simple Friendly Checklist) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {(Object.keys(OFFICIAL_CHANNELS) as ChannelId[]).map(channelId => {
          const info = connections[channelId];
          return (
            <ChannelCard
              key={channelId}
              channelId={channelId}
              status={info.status}
              accountName={info.accountLabel}
              onTestPublish={handleTestPublish}
              onStartOAuth={handleStartMetaOAuth}
              onOpenNaverModal={() => {
                setActiveModalChannel('NAVER_BLOG');
                setNaverBlogIdInput(info.accountLabel || '');
              }}
              onDisconnect={handleDisconnect}
              isPublishing={publishingChannel === channelId}
              receipt={receipts[channelId]}
              errorMessage={errorMessages[channelId]}
            />
          );
        })}
      </div>

      {/* 🚀 다음 단계 & 잠금 메뉴 해금 배너 (1개 이상 연동 시 최우선 표시) */}
      {connectedCount > 0 && (
        <div className="p-5 sm:p-6 rounded-3xl bg-gradient-to-r from-primary via-state-wait to-state-ok border-2 border-state-wait/40 text-primary-foreground shadow-2xl space-y-3 animate-in fade-in slide-in-from-top-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-state-wait/30 border border-state-wait/40 flex items-center justify-center text-2xl shadow-inner shrink-0">
                🔓
              </div>
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-state-ok/20 text-state-ok border border-state-ok/30">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{connectedCount}개 채널이 연결되어 있어요</span>
                </div>
                <h3 className="text-base sm:text-lg font-black tracking-tight">
                  채널을 연결했어요. 게시 검증은 아직 남아 있어요.
                </h3>
                <p className="text-xs text-zinc-300 leading-relaxed">
                  실제 게시가 확인되면 그때 검증 완료로 표시해 드려요. 지금은 연결된 계정으로 글을 준비할 수 있어요.
                </p>
              </div>
            </div>
            <div className="shrink-0">
              <button
                type="button"
                disabled={isUnlocking}
                onClick={handleUnlockAndGoNext}
                className="w-full sm:w-auto px-6 py-3.5 rounded-2xl bg-white text-zinc-950 hover:bg-zinc-100 font-black text-xs sm:text-sm shadow-xl shadow-white/10 transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isUnlocking ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                    <span>잠금 해제 처리 중...</span>
                  </>
                ) : (
                  <>
                    <span>다음 단계: 잠금 해제 & 마케팅 가동 🚀</span>
                    <ArrowRight className="w-4 h-4 text-primary" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {celebrationNotification?.open && (
        <div className="p-6 rounded-3xl bg-gradient-to-r from-state-wait/10 via-primary/10 to-state-ok/10 border-2 border-state-wait/30 text-zinc-950 dark:text-zinc-50 shadow-xl space-y-4 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-state-wait text-state-wait-soft flex items-center justify-center text-2xl shadow-lg shadow-state-wait/30 shrink-0">
                🎉
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-black tracking-tight flex items-center gap-2">
                  <span>{OFFICIAL_CHANNELS[celebrationNotification.channelId].displayName} 공식 계정 연결 완료!</span>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-state-ok/20 text-state-ok border border-state-ok/30">
                    {celebrationNotification.accountLabel}
                  </span>
                </h3>
                <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-300 mt-1 leading-relaxed">
                  소희가 사장님의 계정에 공식적으로 연결되었습니다. 이제 <strong>[1회 인증 포스팅 검증하기]</strong>를 눌러 실제 피드에 테스트 게시물이 성공적으로 발행되는지 즉시 확인해 보세요!
                </p>
              </div>
            </div>
            <button
              onClick={() => setCelebrationNotification(null)}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              disabled={publishingChannel === celebrationNotification.channelId}
              onClick={() => handleTestPublish(celebrationNotification.channelId)}
              className="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-state-wait to-primary hover:from-state-wait hover:to-primary text-primary-foreground font-black text-xs sm:text-sm shadow-lg shadow-state-wait/30 transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {publishingChannel === celebrationNotification.channelId ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>실시간 피드 발행 검증 중...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>지금 바로 1회 실발행 테스트 포스팅 완료하기 🚀</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setCelebrationNotification(null)}
              className="px-4 py-2.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-bold transition cursor-pointer"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* 🌟 2. 고급 기술 진단 및 개발자 검증 상태 토글 (Progressive Disclosure) */}
      <section aria-label="고급 기술 진단">
        <button
          type="button"
          onClick={() => setShowTechnicalDiagnostics(!showTechnicalDiagnostics)}
          className="w-full flex items-center justify-between p-4 rounded-2xl bg-card border border-border hover:bg-muted text-foreground transition-all cursor-pointer min-h-12 shadow-xs"
        >
          <div className="flex items-center gap-3">
            <Sliders className="w-5 h-5 text-primary" />
            <div className="text-left">
              <span className="text-sm font-bold block">
                고급 기술 진단 & 개발자 검증 상태 보기 (Meta App, Webhook, Capability)
              </span>
              <span className="text-xs text-muted-foreground">
                Meta App Review 모드, 실시간 Webhook 파이프라인 수신 상태 및 8대 역량 세부 상태
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-bold text-primary">
            <span>{showTechnicalDiagnostics ? '접기' : '펼치기'}</span>
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showTechnicalDiagnostics ? 'rotate-180' : ''}`} />
          </div>
        </button>
      </section>

      {showTechnicalDiagnostics && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* 🛡️ 7차 정본 Meta 플랫폼 Production 연동 준비 상태 */}
          <ProductionReadinessCard
            appId="1568352131460103"
            appMode="development"
            accessLevel="standard"
            reviewStatus="unsubmitted"
            audience="TEST_ROLE_ONLY"
            isProductionReady={false}
            lastVerifiedAt="2026-09-07"
          />

          {/* 📡 Meta Webhook 실시간 수신 진실 배지 (ANI-1021: Zero False-Green) */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-2xl bg-zinc-50/80 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800">
            <div className="space-y-0.5">
              <div className="text-xs font-black text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${metaWebhookStatus === 'HEALTHY' ? 'bg-state-ok animate-pulse' : 'bg-state-warn'}`} />
                <span>Meta 실시간 알림 수신 상태 감시</span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                소희 사원이 인스타그램 및 스레드에서 발생하는 언급, 댓글, 메시지 소식을 실시간으로 확인하는 수신 상태입니다.
              </p>
            </div>
            <WebhookHealthBadge
              status={metaWebhookStatus}
              lastReceivedAt={metaLastWebhookAt}
            />
          </div>

          {/* ⚠️ 7차 정본 스코프 드리프트 경고 (필수 권한 누락 감지 시 1-클릭 재인증 안내) */}
          {connections.THREADS?.status === 'REAUTH_REQUIRED' && (
            <ScopeDriftAlert
              channel="threads"
              requiredScopes={['threads_basic', 'threads_content_publish', 'threads_read_replies', 'threads_manage_replies']}
              grantedScopes={['threads_basic', 'threads_content_publish']}
              missingScopes={['threads_read_replies', 'threads_manage_replies']}
            />
          )}
          {connections.INSTAGRAM?.status === 'REAUTH_REQUIRED' && (
            <ScopeDriftAlert
              channel="instagram"
              requiredScopes={['instagram_basic', 'instagram_content_publish', 'instagram_manage_comments', 'instagram_manage_messages']}
              grantedScopes={['instagram_basic', 'instagram_content_publish']}
              missingScopes={['instagram_manage_comments', 'instagram_manage_messages']}
            />
          )}

          {/* ⚡ 7차 정본 8대 역량 준비도 (Capability Registry) */}
          <div className="space-y-3 pt-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <div>
                <h3 className="text-sm font-extrabold text-zinc-950 dark:text-zinc-50 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary" />
                  <span>소희 8대 채널 자율 업무 준비 상태</span>
                </h3>
                <p className="text-xs text-zinc-500">
                  연결부터 실제 게시 검증까지 엄격한 검증 단계를 거쳐 자동 운영 여부를 관리합니다.
                </p>
              </div>
              <span className="text-[11px] font-mono text-zinc-400">8대 역량 모니터링 중</span>
            </div>
            <div className="space-y-2">
              {[
                { name: '인스타그램 피드 발행', channel: 'INSTAGRAM', state: connections.INSTAGRAM?.status === 'CONNECTED' ? 'PROVEN' : connections.INSTAGRAM?.status === 'AUTHORIZED' ? 'AUTHORIZED' : 'DISCONNECTED', proofStatus: '게시물 발행' },
                { name: '인스타그램 릴스 발행', channel: 'INSTAGRAM', state: connections.INSTAGRAM?.status === 'CONNECTED' ? 'PROVEN' : 'DISCONNECTED', proofStatus: '릴스 영상 발행' },
                { name: '인스타그램 댓글/DM 수신', channel: 'INSTAGRAM', state: connections.INSTAGRAM?.status === 'CONNECTED' ? 'LISTENING' : 'DISCONNECTED', proofStatus: '실시간 소식 수신' },
                { name: '인스타그램 답글 발행', channel: 'INSTAGRAM', state: connections.INSTAGRAM?.status === 'CONNECTED' ? 'EXECUTABLE' : 'DISCONNECTED', proofStatus: '위험도 평가 후 자동 응답' },
                { name: '스레드 포스트 발행', channel: 'THREADS', state: connections.THREADS?.status === 'CONNECTED' ? 'PROVEN' : connections.THREADS?.status === 'AUTHORIZED' ? 'AUTHORIZED' : 'DISCONNECTED', proofStatus: '스레드 텍스트 발행' },
                { name: '스레드 답글 발행', channel: 'THREADS', state: connections.THREADS?.status === 'CONNECTED' ? 'EXECUTABLE' : 'DISCONNECTED', proofStatus: '스레드 답글 준비 및 발행' },
                { name: '네이버 블로그 포스팅', channel: 'NAVER_BLOG', state: connections.NAVER_BLOG?.status === 'CONNECTED' ? 'PROVEN' : connections.NAVER_BLOG?.status === 'AUTHORIZED' ? 'AUTHORIZED' : 'DISCONNECTED', proofStatus: '스마트에디터 ONE 자동 연결' },
                { name: '당근마켓 동네소식 발행', channel: 'DAANGN', state: 'PENDING', proofStatus: '실시간 알림 승인 대기', failureCode: 'MANUAL_SETUP_PENDING' },
              ].map((cap) => (
                <CapabilityReadinessRow
                  key={cap.name}
                  name={cap.name}
                  channel={cap.channel}
                  state={cap.state}
                  proofStatus={cap.proofStatus}
                  failureCode={cap.channel === 'INSTAGRAM' && cap.state === 'DISCONNECTED' ? 'META_APP_DEVELOPMENT_MODE' : (cap as any).failureCode}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {naverBridgeNotification?.open && (
        <div className="p-5 rounded-3xl bg-state-ok/10 border-2 border-state-ok/30 text-zinc-900 dark:text-zinc-100 flex items-start justify-between gap-4 animate-in fade-in duration-200">
          <div className="space-y-1 text-xs">
            <div className="flex items-center gap-2 font-black text-state-ok text-sm">
              <CheckCircle2 className="w-5 h-5" />
              <span>네이버 스마트에디터 글쓰기 창이 열렸습니다!</span>
            </div>
            <p className="text-zinc-600 dark:text-zinc-300 leading-relaxed">
              소희가 작성한 <strong>[{naverBridgeNotification.title}]</strong> 원고 전문과 추천 해시태그가 사장님의 클립보드에 복사되었습니다.
              새 창으로 열린 네이버 글쓰기 화면에서 <strong>[붙여넣기(Cmd/Ctrl+V)]</strong> 후 <strong>[발행]</strong> 버튼을 누르시면 실제 블로그에 등록됩니다!
            </p>
            <div className="pt-2">
              <a
                href={naverBridgeNotification.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-state-ok text-state-ok-soft font-bold text-[11px] shadow-sm hover:bg-state-ok/90 transition"
              >
                <span>네이버 글쓰기 창 다시 열기</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
          <button
            onClick={() => setNaverBridgeNotification(null)}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {activeModalChannel === 'NAVER_BLOG' && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-[#151518] rounded-3xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-5 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-black text-base text-zinc-950 dark:text-zinc-50">
                <span className="w-6 h-6 rounded-lg bg-state-ok text-state-ok-soft flex items-center justify-center font-black text-xs">N</span>
                <span>네이버 블로그 안전 연결</span>
              </div>
              <button
                onClick={() => setActiveModalChannel(null)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 rounded-2xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-600 dark:text-zinc-400 space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-zinc-800 dark:text-zinc-200">
                <Shield className="w-4 h-4 text-state-ok" />
                <span>비밀번호를 입력받지 않는 안전한 연결 도구</span>
              </div>
              <p className="text-[11px] leading-relaxed">
                네이버의 공식 블로그 글쓰기 연결 기능은 2020년 5월 종료되었습니다. 소희는 사장님의 비밀번호를 절대 수집하지 않으며, 스마트에디터 ONE 원클릭 바로가기로 안전하게 글을 발행합니다.
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-zinc-700 dark:text-zinc-300 block mb-1">
                  네이버 아이디 (블로그 ID) *
                </label>
                <input
                  type="text"
                  value={naverBlogIdInput}
                  onChange={(e) => setNaverBlogIdInput(e.target.value)}
                  placeholder="예: my_naver_blog_id"
                  className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-3.5 py-2.5 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-state-ok/50"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setActiveModalChannel(null)}
                className="flex-1 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 text-xs font-bold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                disabled={isSavingNaver || !naverBlogIdInput.trim()}
                onClick={handleSaveNaverBlog}
                className="flex-1 py-2.5 rounded-xl bg-state-ok hover:bg-state-ok/90 text-state-ok-soft text-xs font-bold shadow-md transition disabled:opacity-50 cursor-pointer"
              >
                {isSavingNaver ? '저장 중...' : '연동 완료 및 글쓰기 연결'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🧭 하단 네비게이션 액션 바 */}
      <div className="mt-8 pt-6 border-t border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => {
            if (typeof window !== 'undefined') {
              if (window.history.length > 1) {
                window.history.back();
              } else {
                window.location.href = '/start';
              }
            }
          }}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 font-bold text-xs sm:text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>이전 화면으로 돌아가기</span>
        </button>

        {connectedCount > 0 ? (
          <button
            type="button"
            disabled={isUnlocking}
            onClick={handleUnlockAndGoNext}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-2xl bg-gradient-to-r from-primary via-state-wait to-state-ok hover:opacity-95 text-primary-foreground font-black text-xs sm:text-sm shadow-xl shadow-state-wait/25 transition-all hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-50"
          >
            {isUnlocking ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>메뉴 잠금 해제 중...</span>
              </>
            ) : (
              <>
                <span>다음 단계: 잠겨진 메뉴 전체 해금하기 🚀</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => { window.location.href = '/start'; }}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-bold text-xs sm:text-sm hover:opacity-90 transition cursor-pointer"
          >
            <span>온보딩 화면으로 이동</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function formatAccountLabel(raw?: string): string {
  if (!raw) return '';
  if (raw.startsWith('http')) {
    try {
      const u = new URL(raw);
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length > 0) {
        const handle = parts[0].replace('@', '');
        return `@${handle}`;
      }
    } catch {
      // default handle on error
    }
  }
  return raw.startsWith('@') ? raw : `@${raw}`;
}

function getAccountProfileUrl(raw: string, channelId: ChannelId): string {
  if (channelId === 'INSTAGRAM' || channelId === 'THREADS') {
    const norm = normalizeChannelInput(channelId === 'INSTAGRAM' ? 'instagram' : 'threads', raw);
    if (norm.isValid) return norm.canonicalUrl;
  }
  if (raw.startsWith('http')) return raw;
  const clean = raw.replace('@', '');
  if (channelId === 'INSTAGRAM') return `https://www.instagram.com/${clean}/`;
  if (channelId === 'THREADS') return `https://www.threads.com/@${clean}`;
  if (channelId === 'NAVER_BLOG') return `https://blog.naver.com/${clean}`;
  return '#';
}

function ChannelCard({
  channelId,
  status,
  accountName,
  onTestPublish,
  onStartOAuth,
  onOpenNaverModal,
  onDisconnect,
  isPublishing,
  receipt,
  errorMessage
}: {
  channelId: ChannelId;
  status: 'CONNECTED' | 'AUTHORIZED' | 'DISCONNECTED' | 'PENDING' | 'REAUTH_REQUIRED';
  accountName?: string;
  onTestPublish: (channelId: ChannelId) => Promise<void>;
  onStartOAuth: (channelId: 'INSTAGRAM' | 'THREADS') => void;
  onOpenNaverModal: () => void;
  onDisconnect: (channelId: ChannelId) => void;
  isPublishing: boolean;
  receipt?: ExternalActionReceipt | null;
  errorMessage?: string | null;
}) {
  const channel = OFFICIAL_CHANNELS[channelId];

  return (
    <div className="p-5 rounded-3xl bg-white dark:bg-[#111113] border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs flex flex-col justify-between space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-sm shrink-0 bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200">
            {channelId === 'INSTAGRAM' && <span className="bg-gradient-to-tr from-state-warn via-state-danger to-primary text-transparent bg-clip-text font-black">IG</span>}
            {channelId === 'THREADS' && <span className="font-black">TH</span>}
            {channelId === 'NAVER_BLOG' && <span className="text-state-ok font-black">NB</span>}
            {channelId === 'DAANGN' && <span>🥕</span>}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-black text-zinc-900 dark:text-zinc-100">{channel.displayName}</h3>
              {status === 'CONNECTED' && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-state-ok/10 text-state-ok border border-state-ok/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-state-ok animate-pulse" />
                  <span>연결됨 · 게시 검증 전</span>
                </span>
              )}
              {status === 'AUTHORIZED' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-state-wait/10 text-state-wait border border-state-wait/20">
                  <Shield className="w-3 h-3 text-state-wait" />
                  <span>권한 승인됨 · 1회 검증 필요</span>
                </span>
              )}
              {status === 'REAUTH_REQUIRED' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-state-warn/10 text-state-warn border border-state-warn/20">
                  <AlertCircle className="w-3 h-3" />
                  <span>재인증 필요</span>
                </span>
              )}
              {status === 'DISCONNECTED' && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-500/10 text-zinc-500 border border-zinc-500/20">
                  미연결
                </span>
              )}
              {status === 'PENDING' && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-state-warn/10 text-state-warn border border-state-warn/20">
                  준비 중
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 line-clamp-1">{channel.description}</p>
          </div>
        </div>

        {accountName && (
          <div className="flex items-center gap-1.5">
            <a
              href={getAccountProfileUrl(accountName, channelId)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200 hover:text-state-wait dark:hover:text-state-wait border border-zinc-200/50 dark:border-zinc-700/50 transition"
              title="공식 채널 프로필 방문"
            >
              <span>{formatAccountLabel(accountName)}</span>
              <ExternalLink className="w-3 h-3 opacity-60" />
            </a>
            <button
              type="button"
              onClick={() => onDisconnect(channelId)}
              title="연결 해제"
              className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-state-danger transition cursor-pointer"
            >
              <Unlink className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="space-y-2 pt-2 border-t border-zinc-100 dark:border-zinc-800/60">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-state-wait" />
            <span>{status === 'CONNECTED' ? '실제 게시 확인 완료' : '공식 권한 위임'}</span>
          </span>

          <div className="flex items-center gap-2">
            {channelId === 'DAANGN' ? (
              <span className="px-3 py-1.5 rounded-xl bg-state-warn/10 text-state-warn border border-state-warn/20 font-bold text-xs">
                자동화 검증 준비 중 (수동 보조)
              </span>
            ) : channelId === 'NAVER_BLOG' ? (
              status === 'CONNECTED' || status === 'AUTHORIZED' ? (
                <button
                  type="button"
                  disabled={isPublishing}
                  onClick={() => onTestPublish(channelId)}
                  className="px-3.5 py-1.5 rounded-xl bg-state-ok hover:bg-state-ok/90 text-state-ok-soft font-bold text-xs shadow-md transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {isPublishing ? (
                    <>
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      <span>글쓰기 창 여는 중...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3 h-3" />
                      <span>스마트에디터 테스트 발행</span>
                    </>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onOpenNaverModal}
                  className="px-3.5 py-1.5 rounded-xl bg-state-ok hover:bg-state-ok/90 text-state-ok-soft font-bold text-xs transition flex items-center gap-1 cursor-pointer"
                >
                  <Link2 className="w-3 h-3" />
                  <span>네이버 블로그 연결</span>
                </button>
              )
            ) : status === 'AUTHORIZED' ? (
              <button
                type="button"
                disabled={isPublishing}
                onClick={() => onTestPublish(channelId)}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-state-wait via-primary to-primary hover:from-state-wait hover:to-primary text-primary-foreground font-black text-xs shadow-md shadow-state-wait/25 transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isPublishing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>실제 피드 발행 중...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>1회 인증 포스팅 검증 🚀</span>
                  </>
                )}
              </button>
            ) : status === 'CONNECTED' ? (
              <button
                type="button"
                disabled={isPublishing}
                onClick={() => onTestPublish(channelId)}
                className="px-3.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 font-bold text-xs transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isPublishing ? (
                  <>
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>재검증 중...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3 h-3" />
                    <span>테스트 포스팅 재검증</span>
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onStartOAuth(channelId as 'INSTAGRAM' | 'THREADS')}
                className="px-3.5 py-1.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-white text-white dark:text-zinc-900 font-bold text-xs transition flex items-center gap-1 cursor-pointer shadow-sm"
              >
                <Link2 className="w-3 h-3" />
                <span>{channel.displayName} 공식 연결</span>
              </button>
            )}
          </div>
        </div>

        {errorMessage && (
          <div className="p-3 rounded-2xl bg-state-danger/10 border border-state-danger/30 text-xs text-state-danger flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-state-danger shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {receipt && (
          <div className={`p-3.5 rounded-2xl text-xs space-y-2 animate-in fade-in duration-200 ${
            receipt.status === 'VERIFIED'
              ? 'bg-state-ok/10 border border-state-ok/30 text-state-ok'
              : 'bg-state-wait/10 border border-state-wait/30 text-state-wait'
          }`}>
            <div className="flex items-center justify-between font-bold">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-state-ok" />
                <span>
                  {receipt.status === 'VERIFIED'
                    ? '실제 외부 게시물 발행 완료 (확인됨)'
                    : '발행 요청됨 · 확인 중'}
                </span>
              </span>
              <span className="font-mono text-[10px] text-zinc-400">{receipt.verificationMethod}</span>
            </div>
            {receipt.externalUrl && (
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-state-ok/20">
                <span className="text-[11px] text-zinc-600 dark:text-zinc-300 truncate">
                  {receipt.externalUrl}
                </span>
                <a
                  href={receipt.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 inline-flex items-center gap-1 px-3 py-1 rounded-xl bg-state-ok hover:bg-state-ok/90 text-state-ok-soft font-bold text-[11px] shadow-sm transition"
                >
                  <span>게시물 확인하기</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
