'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Puzzle,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Shield,
  Sliders,
  Plus,
  Trash2,
  ExternalLink,
  Lock,
  Unlock,
  Search,
  Zap,
  Settings2,
  TrendingUp,
  MessageSquare,
  Share2,
  Target,
  BarChart3,
  Users,
  Inbox,
  PieChart,
  FileText,
  MapPin,
  Calendar,
  Compass,
  Video,
  RefreshCw,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import type { SoheePluginManifest, PluginInstallationState } from '@/types/plugin-platform';

interface PluginItem {
  manifest: SoheePluginManifest;
  installed: boolean;
  state: PluginInstallationState;
  healthStatus: string;
  connectedAccountId?: string | null;
  installedAt?: string | null;
}

interface PluginApiResponse {
  workspaceId: string;
  plugins: PluginItem[];
  totalCatalogCount: number;
  installedCount: number;
  readyCount: number;
  asOf: string;
}

const CATEGORY_TABS = [
  { id: 'ALL', label: '전체 도구' },
  { id: 'SNS', label: '인스타/스레드' },
  { id: 'ADS', label: '유료 광고' },
  { id: 'CRM', label: '상담·예약·CRM' },
  { id: 'CONTENT', label: '콘텐츠·조사' },
] as const;

export function PluginMarketplaceView({ workspaceId }: { workspaceId: string }) {
  const [plugins, setPlugins] = useState<PluginItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeModalPlugin, setActiveModalPlugin] = useState<PluginItem | null>(null);
  const [accountInput, setAccountInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  const fetchPlugins = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/workspaces/${workspaceId}/plugins`);
      if (res.ok) {
        const data: PluginApiResponse = await res.json();
        setPlugins(data.plugins || []);
      }
    } catch (err) {
      console.error('Failed to load plugins:', err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchPlugins();
  }, [fetchPlugins]);

  const handleInstall = async (pluginId: string) => {
    try {
      setIsSubmitting(true);
      const res = await fetch(`/api/workspaces/${workspaceId}/plugins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'INSTALL', pluginId }),
      });
      if (res.ok) {
        setActionSuccessMessage('플러그인이 성공적으로 설치되었습니다.');
        setTimeout(() => setActionSuccessMessage(null), 3000);
        await fetchPlugins();
      }
    } catch (err) {
      console.error('Failed to install plugin:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConnectAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeModalPlugin) return;

    try {
      setIsSubmitting(true);
      const res = await fetch(`/api/workspaces/${workspaceId}/plugins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'CONNECT',
          pluginId: activeModalPlugin.manifest.pluginId,
          accountId: accountInput.trim() || 'official_account',
        }),
      });
      if (res.ok) {
        setActiveModalPlugin(null);
        setAccountInput('');
        setActionSuccessMessage(`계정 [${accountInput || 'official_account'}] 연결이 완료되었습니다.`);
        setTimeout(() => setActionSuccessMessage(null), 3000);
        await fetchPlugins();
      }
    } catch (err) {
      console.error('Failed to connect account:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggle = async (pluginId: string) => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/plugins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'TOGGLE', pluginId }),
      });
      if (res.ok) {
        await fetchPlugins();
      }
    } catch (err) {
      console.error('Failed to toggle plugin:', err);
    }
  };

  const handleUninstall = async (pluginId: string) => {
    if (!confirm('이 플러그인을 제거하시겠습니까? 소희가 이 도구를 사용한 자율 작업을 중단합니다.')) return;
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/plugins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'UNINSTALL', pluginId }),
      });
      if (res.ok) {
        await fetchPlugins();
      }
    } catch (err) {
      console.error('Failed to uninstall plugin:', err);
    }
  };

  const filteredPlugins = useMemo(() => {
    return plugins.filter((item) => {
      const { manifest } = item;
      const matchesSearch =
        manifest.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        manifest.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
        manifest.outcomeTags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));

      if (!matchesSearch) return false;

      if (selectedCategory === 'ALL') return true;
      if (selectedCategory === 'SNS') {
        return manifest.categories.some((c) => c.includes('인스타그램') || c.includes('Threads'));
      }
      if (selectedCategory === 'ADS') {
        return manifest.categories.some((c) => c.includes('광고'));
      }
      if (selectedCategory === 'CRM') {
        return manifest.categories.some((c) => c.includes('상담') || c.includes('CRM') || c.includes('예약'));
      }
      if (selectedCategory === 'CONTENT') {
        return manifest.categories.some((c) => c.includes('콘텐츠') || c.includes('블로그'));
      }
      return true;
    });
  }, [plugins, selectedCategory, searchQuery]);

  const stats = useMemo(() => {
    const ready = plugins.filter((p) => p.state === 'READY').length;
    const authReq = plugins.filter((p) => p.state === 'AUTH_REQUIRED').length;
    const installed = plugins.filter((p) => p.installed).length;
    return { ready, authReq, installed, total: plugins.length };
  }, [plugins]);

  const renderPluginIcon = (iconName: string) => {
    switch (iconName) {
      case 'instagram':
        return <Share2 className="size-5 text-primary" />;
      case 'message-circle':
        return <MessageSquare className="size-5 text-state-wait" />;
      case 'share-2':
        return <Share2 className="size-5 text-state-wait" />;
      case 'message-square':
        return <MessageSquare className="size-5 text-state-warn" />;
      case 'file-text':
        return <FileText className="size-5 text-state-ok" />;
      case 'map-pin':
        return <MapPin className="size-5 text-state-warn" />;
      case 'calendar':
        return <Calendar className="size-5 text-primary" />;
      case 'target':
        return <Target className="size-5 text-state-wait" />;
      case 'zap':
        return <Zap className="size-5 text-state-warn" />;
      case 'bar-chart-3':
        return <BarChart3 className="size-5 text-state-wait" />;
      case 'users':
        return <Users className="size-5 text-state-ok" />;
      case 'inbox':
        return <Inbox className="size-5 text-primary" />;
      case 'pie-chart':
        return <PieChart className="size-5 text-state-danger" />;
      case 'search':
        return <Search className="size-5 text-state-ok" />;
      case 'trending-up':
        return <TrendingUp className="size-5 text-state-ok" />;
      case 'video':
        return <Video className="size-5 text-state-danger" />;
      case 'compass':
        return <Compass className="size-5 text-state-wait" />;
      default:
        return <Sparkles className="size-5 text-primary" />;
    }
  };

  const getStatusBadge = (state: PluginInstallationState, _health: string) => {
    switch (state) {
      case 'READY':
        return (
          <Badge variant="outline" className="bg-state-ok/10 text-state-ok border-state-ok/30 gap-1 text-[11px] font-semibold">
            <span className="size-1.5 rounded-full bg-state-ok animate-pulse" />
            가동 중 (READY)
          </Badge>
        );
      case 'AUTH_REQUIRED':
        return (
          <Badge variant="outline" className="bg-state-warn/10 text-state-warn border-state-warn/30 gap-1 text-[11px] font-semibold">
            <AlertCircle className="size-3" />
            계정 연결 필요
          </Badge>
        );
      case 'DISABLED':
        return (
          <Badge variant="outline" className="bg-zinc-500/10 text-zinc-400 border-zinc-500/30 text-[11px]">
            비활성화됨
          </Badge>
        );
      case 'PLAN_LOCKED':
        return (
          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 gap-1 text-[11px]">
            <Lock className="size-3" />
            상위 플랜 필요
          </Badge>
        );
      case 'DEGRADED':
        return (
          <Badge variant="outline" className="bg-state-danger/10 text-state-danger border-state-danger/30 gap-1 text-[11px]">
            공급자 장애
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="bg-zinc-800/40 text-zinc-400 border-zinc-700/40 text-[11px]">
            미설치
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-16">
      {/* 1. 상단 인트로 & 실시간 툴벨트 가동 현황 */}
      <div className="relative overflow-hidden rounded-3xl border border-primary/30 bg-gradient-to-br from-zinc-950 via-zinc-900 to-primary p-6 sm:p-8 shadow-xl text-white">
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-72 h-72 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-primary/25 text-primary border-primary/40 text-xs px-2.5 py-0.5 font-bold">
                <Puzzle className="size-3.5 mr-1" />
                SOHEE EXTENSIBLE CAPABILITY FABRIC
              </Badge>
              <span className="text-xs text-zinc-400 font-medium">· 3차 수정 V0.9</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white flex items-center gap-2">
              소희 플러그인 마켓플레이스
            </h1>
            <p className="text-sm text-zinc-200 max-w-2xl leading-relaxed">
              소희가 자율적으로 실행할 외부 채널, 유료 광고, 고객 상담, 콘텐츠 도구를 장착하세요.
              설치된 플러그인은 대화와 자율 캠페인에서 실시간 도구(Toolbelt)로 즉시 가동됩니다.
            </p>
          </div>

          {/* 실시간 툴벨트 스탯 카드 */}
          <div className="flex items-center gap-3 bg-zinc-900/90 border border-zinc-700/80 rounded-2xl p-4 shadow-lg backdrop-blur shrink-0">
            <div className="p-3 rounded-xl bg-primary/20 text-primary">
              <Zap className="size-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black text-white tabular-nums">{stats.ready}</span>
                <span className="text-xs text-zinc-400 font-semibold">/ {stats.total}개 도구</span>
              </div>
              <p className="text-xs font-bold text-[var(--v088-live)] flex items-center gap-1 mt-0.5">
                <span className="size-2 rounded-full bg-[var(--v088-live)] animate-pulse" />
                소희가 현장에서 즉시 가동 중
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={fetchPlugins}
              disabled={loading}
              className="ml-2 size-8 text-zinc-400 hover:text-white hover:bg-zinc-800"
              title="새로고침"
            >
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* 액션 피드백 토스트 */}
        {actionSuccessMessage && (
          <div className="mt-4 p-3 rounded-xl bg-state-ok/20 border border-state-ok/40 text-state-ok text-xs font-semibold flex items-center gap-2 animate-in fade-in">
            <CheckCircle2 className="size-4 shrink-0 text-state-ok" />
            <span>{actionSuccessMessage}</span>
          </div>
        )}
      </div>

      {/* 2. 필터 탭 & 검색바 */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-1.5 p-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-x-auto max-w-full">
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedCategory(tab.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                selectedCategory === tab.id
                  ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-zinc-800/60'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="플러그인 이름, 목표, 기능 검색..."
            className="pl-9 h-9 text-xs bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-xl focus:border-primary/50"
          />
        </div>
      </div>

      {/* 3. 플러그인 카드 그리드 */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-64 rounded-3xl bg-zinc-100 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 animate-pulse p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
                <div className="space-y-1.5 flex-1">
                  <div className="h-4 w-32 bg-zinc-200 dark:bg-zinc-800 rounded" />
                  <div className="h-3 w-20 bg-zinc-200 dark:bg-zinc-800 rounded" />
                </div>
              </div>
              <div className="h-16 bg-zinc-200/60 dark:bg-zinc-800/40 rounded-xl" />
              <div className="h-9 bg-zinc-200 dark:bg-zinc-800 rounded-xl" />
            </div>
          ))}
        </div>
      ) : filteredPlugins.length === 0 ? (
        <div className="text-center py-16 space-y-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-8">
          <Puzzle className="size-10 text-zinc-400 mx-auto" />
          <p className="text-base font-bold text-zinc-900 dark:text-zinc-100">조건에 맞는 플러그인을 찾지 못했습니다.</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">다른 검색어나 카테고리 필터를 선택해 보세요.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredPlugins.map(({ manifest, installed, state, healthStatus, connectedAccountId }) => (
            <Card
              key={manifest.pluginId}
              className={`flex flex-col justify-between border transition-all duration-200 rounded-3xl overflow-hidden shadow-sm hover:shadow-md ${
                state === 'READY'
                  ? 'border-state-ok/60 bg-white dark:bg-zinc-900 shadow-state-ok/5 ring-1 ring-state-ok/20'
                  : state === 'AUTH_REQUIRED'
                  ? 'border-state-warn/60 bg-white dark:bg-zinc-900 shadow-state-warn/5 ring-1 ring-state-warn/20'
                  : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/90 hover:border-primary/40 dark:hover:border-primary'
              }`}
            >
              <CardHeader className="p-5 pb-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-2xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-xs flex items-center justify-center">
                      {renderPluginIcon(manifest.icon)}
                    </div>
                    <div>
                      <CardTitle className="text-base font-extrabold text-zinc-900 dark:text-zinc-100 leading-snug">
                        {manifest.displayName}
                      </CardTitle>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono mt-0.5">
                        v{manifest.version} · {manifest.trustTier === 'VERIFIED_FIRST_PARTY' ? '공식 검증' : '코어 엔진'}
                      </p>
                    </div>
                  </div>
                  <div>{getStatusBadge(state, healthStatus)}</div>
                </div>

                <CardDescription className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed line-clamp-2">
                  {manifest.summary}
                </CardDescription>

                {/* 태그 & 지원 채널 */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {manifest.outcomeTags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-[10px] font-medium text-zinc-700 dark:text-zinc-300"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </CardHeader>

              <CardContent className="px-5 py-3 space-y-3 text-xs border-t border-zinc-100 dark:border-zinc-800/80 bg-zinc-50/60 dark:bg-zinc-950/40">
                {/* 연결 계정 안내 */}
                {connectedAccountId && (
                  <div className="flex items-center justify-between text-[11px] p-2.5 rounded-xl bg-state-ok-soft border border-state-ok/30 text-state-ok font-semibold">
                    <span className="font-bold">연결 계정</span>
                    <span className="font-mono">{connectedAccountId}</span>
                  </div>
                )}

                {/* 제공 역량 목록 요약 */}
                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    제공 역량 (CAPABILITIES)
                  </span>
                  <ul className="space-y-1 text-[11px] text-zinc-700 dark:text-zinc-300 font-medium">
                    {manifest.capabilities.slice(0, 2).map((cap) => (
                      <li key={cap.capabilityId} className="flex items-center gap-1.5 truncate">
                        <span className="size-1.5 rounded-full bg-primary shrink-0" />
                        <span className="truncate">{cap.name}</span>
                        <Badge variant="outline" className="text-[9px] py-0 px-1 ml-auto font-mono text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700">
                          {cap.riskClass}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>

              <CardFooter className="p-4 pt-3 bg-zinc-50 dark:bg-zinc-950/70 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-2">
                {!installed ? (
                  <Button
                    onClick={() => handleInstall(manifest.pluginId)}
                    disabled={isSubmitting}
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs h-9 rounded-xl shadow-md shadow-primary/20 cursor-pointer"
                  >
                    <Plus className="size-3.5 mr-1.5" />
                    플러그인 설치하기
                  </Button>
                ) : state === 'AUTH_REQUIRED' ? (
                  <div className="flex items-center gap-2 w-full">
                    <Button
                      onClick={() => setActiveModalPlugin({ manifest, installed, state, healthStatus, connectedAccountId })}
                      className="flex-1 bg-state-warn hover:bg-state-warn/90 text-state-warn-soft font-bold text-xs h-9 rounded-xl shadow-md shadow-state-warn/20 cursor-pointer"
                    >
                      <Unlock className="size-3.5 mr-1.5" />
                      계정 연결 설정
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleUninstall(manifest.pluginId)}
                      className="size-9 rounded-xl text-zinc-400 hover:text-state-danger hover:bg-state-danger-soft dark:hover:bg-state-danger/30 cursor-pointer"
                      title="제거"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 w-full">
                    <Button
                      variant="outline"
                      onClick={() => handleToggle(manifest.pluginId)}
                      className={`flex-1 text-xs h-9 rounded-xl font-bold cursor-pointer transition-colors ${
                        state === 'READY'
                          ? 'border-state-ok/50 text-state-ok bg-state-ok-soft hover:bg-state-ok-soft'
                          : 'text-zinc-600 dark:text-zinc-400 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {state === 'READY' ? '가동 중 (토글)' : '비활성됨 (재개)'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setActiveModalPlugin({ manifest, installed, state, healthStatus, connectedAccountId })}
                      className="size-9 rounded-xl text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/60 dark:hover:bg-zinc-800 cursor-pointer"
                      title="설정 변경"
                    >
                      <Settings2 className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleUninstall(manifest.pluginId)}
                      className="size-9 rounded-xl text-zinc-400 hover:text-state-danger hover:bg-state-danger-soft dark:hover:bg-state-danger/30 cursor-pointer"
                      title="제거"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {/* 4. 계정 연결 설정 모달 */}
      <Dialog
        open={!!activeModalPlugin}
        onOpenChange={(open) => !open && setActiveModalPlugin(null)}
        title={`${activeModalPlugin?.manifest.displayName || '플러그인'} 연결 설정`}
      >
        <div className="space-y-4 p-2">
          <p className="text-xs text-muted-foreground">
            소희가 해당 채널 또는 API에 안전하게 접근할 수 있도록 연결 정보를 입력하세요.
          </p>

          <form onSubmit={handleConnectAccount} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">
                채널 계정 식별자 (아이디/핸들/채널명)
              </label>
              <Input
                value={accountInput}
                onChange={(e) => setAccountInput(e.target.value)}
                placeholder="예: @studio_byreum, kakao_biz_id"
                required
                className="h-10 text-xs bg-zinc-900 border-border rounded-xl"
              />
              <p className="text-[11px] text-muted-foreground">
                * 인증 정보는 테넌트별 암호화 금고(Credential Vault)에 안전하게 보관됩니다.
              </p>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setActiveModalPlugin(null)}
                className="text-xs rounded-xl"
              >
                취소
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs rounded-xl font-semibold px-4"
              >
                {isSubmitting ? '연결 중...' : '연결 및 READY 활성화'}
              </Button>
            </div>
          </form>
        </div>
      </Dialog>
    </div>
  );
}
