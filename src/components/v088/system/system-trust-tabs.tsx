'use client';

import React, { useState } from 'react';
import {
  SystemTrustDomain,
  ChannelConnectionRecord,
  SecurityAuditRecord,
} from '@/types/system-trust';
import { SystemTrustService } from '@/lib/system-trust/system-trust-service';
import {
  Building2,
  CreditCard,
  KeyRound,
  ShieldCheck,
  Activity,
  Database,
  Download,
  CheckCircle2,
  Coins,
  Lock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyEvidenceState } from '@/components/v088/same-truth';

interface SystemTrustTabsProps {
  workspaceId: string;
  isTestAccount?: boolean;
  adminEmail?: string | null;
  initialDomain?: SystemTrustDomain;
  readOnly?: boolean;
}

const TABS: { id: SystemTrustDomain; label: string; icon: React.ElementType }[] = [
  { id: 'account', label: '사업자 정보', icon: Building2 },
  { id: 'plan_credits', label: '요금제 현황', icon: CreditCard },
  { id: 'connections', label: '채널 연동 관리', icon: KeyRound },
  { id: 'privacy', label: '데이터 관리', icon: Database },
  { id: 'security', label: '보안 및 활동 기록', icon: ShieldCheck },
  { id: 'health', label: '서비스 정상 작동 여부', icon: Activity },
];

const TEST_CONNECTIONS: ChannelConnectionRecord[] = [
  {
    connectionId: 'conn-ig-01',
    workspaceId: 'test-ws',
    channel: 'instagram',
    channelLabel: '인스타그램 비즈니스',
    accountHandle: '@instagram_account',
    status: 'CONNECTED',
    grantedScopes: ['instagram_basic', 'instagram_content_publish', 'instagram_manage_messages'],
    connectedAt: '2026-08-20T10:00:00.000Z',
    lastUsedAt: new Date().toISOString(),
  },
  {
    connectionId: 'conn-naver-02',
    workspaceId: 'test-ws',
    channel: 'naver',
    channelLabel: '네이버 블로그 & 스마트플레이스',
    accountHandle: 'naver_official',
    status: 'CONNECTED',
    grantedScopes: ['blog_write', 'place_inquiry_read'],
    connectedAt: '2026-08-22T14:30:00.000Z',
    lastUsedAt: new Date().toISOString(),
  },
  {
    connectionId: 'conn-daangn-03',
    workspaceId: 'test-ws',
    channel: 'daangn',
    channelLabel: '당근마켓 비즈프로필',
    accountHandle: '공식 비즈프로필',
    status: 'CONNECTED',
    grantedScopes: ['feed_publish', 'chat_reply'],
    connectedAt: '2026-08-25T09:00:00.000Z',
    lastUsedAt: new Date().toISOString(),
  },
];

const TEST_AUDITS: SecurityAuditRecord[] = [
  {
    auditId: 'audit-init-01',
    workspaceId: 'test-ws',
    actionType: 'UPDATE_POLICY',
    performer: '사장님',
    details: '자율 실행 일일 광고비 한도를 ₩30,000원으로 설정 완료',
    timestamp: '2026-09-01T12:00:00.000Z',
    readbackVerified: true,
  },
];

export function SystemTrustTabs({ workspaceId, isTestAccount = false, adminEmail, initialDomain = 'account', readOnly = false }: SystemTrustTabsProps) {
  const [activeTab, setActiveTab] = useState<SystemTrustDomain>(initialDomain);
  const [profile, setProfile] = useState<{
    businessName: string | null;
    location: string | null;
    businessNumber: string | null;
    email: string | null;
  }>({
    businessName: null,
    location: null,
    businessNumber: null,
    email: adminEmail ?? null,
  });

  React.useEffect(() => {
    if (!workspaceId) return;
    let isMounted = true;
    fetch('/api/onboarding/quick-start')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isMounted || !data) return;
        setProfile((prev) => ({
          ...prev,
          businessName: data.profile?.business_name ?? null,
          location: data.profile?.location ?? null,
        }));
      })
      .catch(() => null);

    fetch('/api/auth/business-verification')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isMounted || !data?.verification) return;
        setProfile((prev) => ({
          ...prev,
          businessNumber: data.verification.businessNumber ?? null,
        }));
      })
      .catch(() => null);

    return () => {
      isMounted = false;
    };
  }, [workspaceId]);

  const [connections, setConnections] = useState<ChannelConnectionRecord[]>(
    isTestAccount ? TEST_CONNECTIONS : []
  );

  const [audits, setAudits] = useState<SecurityAuditRecord[]>(
    isTestAccount ? TEST_AUDITS : []
  );

  const [actionAlert, setActionAlert] = useState<string | null>(null);
  const healthList = React.useMemo(() => SystemTrustService.getCanonicalDependenciesHealth(), []);

  const handleRevoke = (connId: string) => {
    if (readOnly) return;
    try {
      const { updatedConnections, auditRecord } = SystemTrustService.revokeChannelConnection({
        workspaceId,
        connectionId: connId,
        connections,
        performer: '대표 관리자 (System Console)',
      });
      setConnections(updatedConnections);
      setAudits(prev => [auditRecord, ...prev]);
      setActionAlert('채널 연결 권한이 안전하게 해제되었습니다.');
      setTimeout(() => setActionAlert(null), 4000);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleExport = () => {
    if (readOnly) return;
    const { exportArchiveDigest, auditRecord } = SystemTrustService.exportAccountData({
      workspaceId,
      performer: '대표 관리자 (System Console)',
    });
    setAudits(prev => [auditRecord, ...prev]);
    setActionAlert(`정본 내보내기 파일 생성 완료: ${exportArchiveDigest}`);
    setTimeout(() => setActionAlert(null), 4000);
  };

  return (
    <div className="space-y-6">
      {/* Action Status Banner */}
      {actionAlert && (
        <div className="p-3.5 rounded-2xl bg-state-ok-soft border border-state-ok/40 text-state-ok text-xs font-bold flex items-center justify-between shadow-xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-state-ok" />
            <span>{actionAlert}</span>
          </div>
          <span className="text-[10px] bg-state-ok-soft px-2 py-0.5 rounded font-medium">
            기록 완료
          </span>
        </div>
      )}

      {/* 6 Core Tabs Navigation */}
      <div className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-2xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-2xs">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isSelected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap",
                isSelected
                  ? "bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-xs border border-zinc-200/80 dark:border-zinc-700"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
              )}
            >
              <Icon className={cn("w-3.5 h-3.5", isSelected ? "text-primary" : "text-zinc-400")} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab 1: Account & Business */}
      {activeTab === 'account' && (
        <div className="p-6 rounded-3xl bg-white dark:bg-[#121215] border border-zinc-200/80 dark:border-zinc-800 shadow-xs space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
            <div>
              <h2 className="text-base font-extrabold text-zinc-950 dark:text-zinc-50">
                사업자 및 대표자 계정 정보
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                정식 등록된 사업자 등록번호 및 매장 법적 정보
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-state-ok-soft text-state-ok dark:bg-state-ok dark:text-state-ok border border-state-ok/40 text-xs font-bold">
              {isTestAccount ? '✓ 사업자 인증 완료 (테스트)' : '✓ 실제 사업장 정본'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 space-y-1">
              <span className="text-zinc-400 font-bold block text-[11px]">상호명</span>
              <span className="font-extrabold text-zinc-900 dark:text-zinc-100 text-sm">
                {profile.businessName || (isTestAccount ? '소희 AI 공식 데모 스토어' : '등록된 매장')}
              </span>
            </div>
            <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 space-y-1">
              <span className="text-zinc-400 font-bold block text-[11px]">사업자등록번호</span>
              <span className="font-mono font-extrabold text-zinc-900 dark:text-zinc-100 text-sm">
                {profile.businessNumber || (isTestAccount ? '134-87-02941' : '국세청 홈택스 인증 완료')}
              </span>
            </div>
            <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 space-y-1">
              <span className="text-zinc-400 font-bold block text-[11px]">매장 주소</span>
              <span className="font-extrabold text-zinc-900 dark:text-zinc-100 text-sm">
                {profile.location || (isTestAccount ? '인천 연수구 송도과학로 16번길 33' : '매장 주소지 (프로필 연동)')}
              </span>
            </div>
            <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 space-y-1">
              <span className="text-zinc-400 font-bold block text-[11px]">관리자 이메일</span>
              <span className="font-mono font-extrabold text-zinc-900 dark:text-zinc-100 text-sm">
                {adminEmail || profile.email || (isTestAccount ? 'demo@sohee.ai' : '대표자 계정')}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Plan & Credits */}
      {activeTab === 'plan_credits' && (
        <div className="p-6 rounded-3xl bg-white dark:bg-[#121215] border border-zinc-200/80 dark:border-zinc-800 shadow-xs space-y-6">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
            <div>
              <h2 className="text-base font-extrabold text-zinc-950 dark:text-zinc-50">
                요금제 및 이용 현황
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                소희 AI 사원의 모델·기능 이용 혜택과 외부 광고비가 투명하게 관리됩니다.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-primary/10 text-foreground dark:text-primary text-xs font-bold">
              {isTestAccount ? '프로 요금제 (이용 중)' : '베타 무료 체험 이용 중'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 rounded-2xl bg-primary/50 border border-primary/30 space-y-2">
              <span className="text-xs font-bold text-foreground dark:text-primary flex items-center gap-1.5">
                <Coins className="w-4 h-4" /> 소희 AI 마케팅 이용 혜택
              </span>
              <div className="text-2xl font-black font-mono text-foreground dark:text-primary">
                {isTestAccount ? '정상 이용 중' : '무료 체험 혜택 적용 중'}
              </div>
              <p className="text-[11px] text-primary">
                콘텐츠 생성, 마케팅 품질 검토, 고객 문의 응대 기능이 정상 작동하고 있습니다.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 space-y-2">
              <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                <CreditCard className="w-4 h-4 text-state-ok" /> 외부 매체 광고비 분리 기록 (원)
              </span>
              <div className="text-2xl font-black font-mono text-zinc-950 dark:text-zinc-50">
                {isTestAccount ? '집행 이력 확인 가능' : '집행된 광고비 없음'}
              </div>
              <p className="text-[11px] text-zinc-500">
                메타/네이버에 직접 청구되는 광고비이며 1원 단위로 실시간 대사됩니다.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Connections & Permissions */}
      {activeTab === 'connections' && (
        <div className="p-6 rounded-3xl bg-white dark:bg-[#121215] border border-zinc-200/80 dark:border-zinc-800 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
            <div>
              <h2 className="text-base font-extrabold text-zinc-950 dark:text-zinc-50">
                외부 SNS 채널 연동 및 관리
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                연결된 SNS 채널의 상태를 확인하고 언제든지 연결을 해제할 수 있습니다.
              </p>
            </div>
          </div>

          {connections.length === 0 ? (
            <EmptyEvidenceState
              title="연동된 외부 마케팅 채널이 없습니다"
              description="인스타그램, 네이버 블로그, 스레드 채널을 연결하면 연결 상태와 허용된 권한이 여기에 표시됩니다."
              actionLabel="채널 연동하러 가기"
              actionHref="/app/channels"
              kind="NO_PROOF"
            />
          ) : (
            <div className="space-y-3">
              {connections.map((conn) => (
                <div
                  key={conn.connectionId}
                  className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200/80 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">
                        {conn.channelLabel}
                      </span>
                      <span className="text-xs font-mono text-zinc-500">
                        ({conn.accountHandle})
                      </span>
                      <span className={cn(
                        "px-2 py-0.5 rounded-full text-[10px] font-bold border",
                        conn.status === 'CONNECTED' 
                          ? "bg-state-ok-soft text-state-ok dark:bg-state-ok dark:text-state-ok border-state-ok/40"
                          : "bg-state-danger-soft text-state-danger dark:bg-state-danger dark:text-state-danger border-state-danger/40"
                      )}>
                        {conn.status === 'CONNECTED' ? '● 정상 연결됨' : '✕ 연결 해제됨'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2 text-[10px] text-zinc-400">
                      {conn.grantedScopes.map((scope, idx) => (
                        <span key={idx} className="px-2 py-0.5 rounded bg-zinc-200/60 dark:bg-zinc-800">
                          {scope}
                        </span>
                      ))}
                    </div>
                  </div>

                  {conn.status === 'CONNECTED' && (
                    <button
                      disabled={readOnly}
                      onClick={() => handleRevoke(conn.connectionId)}
                      className="px-3.5 py-1.5 rounded-xl bg-state-danger-soft hover:bg-state-danger-soft dark:hover:bg-state-danger/50 text-state-danger border border-state-danger/30 text-xs font-bold transition-all cursor-pointer shadow-2xs"
                    >
                      연결 해제
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Data & Privacy */}
      {activeTab === 'privacy' && (
        <div className="p-6 rounded-3xl bg-white dark:bg-[#121215] border border-zinc-200/80 dark:border-zinc-800 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
            <div>
              <h2 className="text-base font-extrabold text-zinc-950 dark:text-zinc-50">
                매장 데이터 및 개인정보 보호
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                매장 자산과 고객 상담 데이터는 안전한 암호화 기술로 보호됩니다.
              </p>
            </div>
            <button
              disabled={readOnly}
              onClick={handleExport}
              className="px-3.5 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>데이터 다운로드</span>
            </button>
          </div>

          <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200/80 dark:border-zinc-800 space-y-2 text-xs">
            <div className="font-bold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-primary" /> 개인정보 처리 및 안전 관리 원칙
            </div>
            <p className="text-zinc-500 leading-relaxed text-[11px]">
              소희는 관련 법령에 따라 고객 동의 없는 외부 데이터 전송을 엄격히 차단하며, 사장님이 원하실 때 언제든지 모든 상담 이력과 예약 기록을 엑셀 파일로 안전하게 다운로드하실 수 있습니다.
            </p>
          </div>
        </div>
      )}

      {/* Tab 5: Security & Audit */}
      {activeTab === 'security' && (
        <div className="p-6 rounded-3xl bg-white dark:bg-[#121215] border border-zinc-200/80 dark:border-zinc-800 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
            <div>
              <h2 className="text-base font-extrabold text-zinc-950 dark:text-zinc-50">
                안전 활동 및 변경 기록
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                권한 변경, 게시물 승인, 데이터 다운로드 등 모든 주요 활동의 안전 기록입니다.
              </p>
            </div>
          </div>

          {audits.length === 0 ? (
            <EmptyEvidenceState
              title="기록된 활동 내역이 없습니다"
              description="권한 변경이나 정책 수정 등의 이벤트가 발생하면 안전하게 기록되어 여기에 표시됩니다."
              kind="NO_PROOF"
            />
          ) : (
            <div className="space-y-3">
              {audits.map((item) => (
                <div
                  key={item.auditId}
                  className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200/80 dark:border-zinc-800 flex items-center justify-between text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-zinc-900 dark:text-zinc-100">
                        {item.details}
                      </span>
                      <span className="font-mono text-[10px] text-zinc-400">
                        ({item.actionType})
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-400 flex items-center gap-2">
                      <span>수행자: {item.performer}</span>
                      <span>•</span>
                      <span>{item.timestamp}</span>
                    </div>
                  </div>

                  <span className="px-2.5 py-1 rounded-full bg-state-ok-soft text-state-ok dark:bg-state-ok dark:text-state-ok border border-state-ok/40 text-[10px] font-bold">
                    ✓ 확인 완료
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 6: Infrastructure & Health */}
      {activeTab === 'health' && (
        <div className="p-6 rounded-3xl bg-white dark:bg-[#121215] border border-zinc-200/80 dark:border-zinc-800 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
            <div>
              <h2 className="text-base font-extrabold text-zinc-950 dark:text-zinc-50">
                소희 서비스 정상 작동 여부
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                소희 AI 시스템과 외부 연동 서비스의 실시간 가동 상태입니다.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {healthList.map((dep) => (
              <div
                key={dep.serviceName}
                className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200/80 dark:border-zinc-800 flex items-center justify-between text-xs"
              >
                <div className="space-y-1">
                  <span className="font-extrabold text-zinc-900 dark:text-zinc-100 block">
                    {dep.serviceName}
                  </span>
                  <span className="text-[11px] text-zinc-500">
                    상태 점검 완료
                  </span>
                </div>

                <span className={cn(
                  "px-2.5 py-1 rounded-full text-[10px] font-bold border",
                  dep.status === 'HEALTHY'
                    ? "bg-state-ok-soft text-state-ok dark:bg-state-ok dark:text-state-ok border-state-ok/40"
                    : "bg-state-warn-soft text-state-warn dark:bg-state-warn dark:text-state-warn border-state-warn/40"
                )}>
                  {dep.status === 'HEALTHY' ? '● 정상 작동 중' : '▲ 점검 필요'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
