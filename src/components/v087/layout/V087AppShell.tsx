"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import {
  LayoutDashboard,
  Sparkles,
  MessageSquare,
  CheckSquare,
  FolderKanban,
  Radio,
  TrendingUp,
  BrainCircuit,
  Settings,
  X,
  MoreHorizontal,
  ChevronDown,
  Zap,
  Activity,
} from "lucide-react";
import { SoheeAgentCopilot } from "../agent/SoheeAgentCopilot";
import { ThemeToggle } from "../ui/ThemeToggle";
import { getTodayReadModel } from "@/lib/read-models/today-read-model";
import { getOpportunitiesReadModel } from "@/lib/read-models/opportunity-read-model";
import { useWorkspaceId } from "@/hooks/use-workspace-context";

interface V087AppShellProps {
  children: React.ReactNode;
}

export function V087AppShell({ children }: V087AppShellProps) {
  const workspaceId = useWorkspaceId();
  const pathname = usePathname() || '';
  const [isAgentOpen, setIsAgentOpen] = useState(false);
  const [isMobileMoreOpen, setIsMobileMoreOpen] = useState(false);

  const todayData = getTodayReadModel({
    workspaceId,
    isDemo: true,
  });

  const oppList = getOpportunitiesReadModel({
    workspaceId,
    isDemo: true,
  });

  const navItems = [
    { href: "/app", label: "오늘의 콕핏", icon: LayoutDashboard, badge: null },
    { href: "/app/opportunities", label: "기회함", icon: Sparkles, badge: String(oppList.totalCount) },
    { href: "/app/missions", label: "실행안 센터", icon: Zap, badge: null },
    { href: "/app/approvals", label: "확인할 것", icon: CheckSquare, badge: String(todayData.pendingApprovals.length) },
    { href: "/app/inbox", label: "통합 문의함", icon: MessageSquare, badge: "3" },
    { href: "/app/content", label: "콘텐츠 허브", icon: FolderKanban, badge: null },
    { href: "/app/channels", label: "채널 연결", icon: Radio, badge: null },
    { href: "/app/reports", label: "소희가 만든 결과", icon: TrendingUp, badge: null },
    { href: "/app/memory", label: "우리 매장 기억", icon: BrainCircuit, badge: null },
    { href: "/app/settings/automation", label: "자동화 범위 / 안전", icon: Settings, badge: null },
  ];

  const mobilePrimaryTabs = [
    { href: "/app", label: "홈", icon: LayoutDashboard, badge: null },
    { href: "/app/opportunities", label: "기회", icon: Sparkles, badge: String(oppList.totalCount) },
    { href: "/app/approvals", label: "승인", icon: CheckSquare, badge: String(todayData.pendingApprovals.length) },
    { href: "/app/inbox", label: "문의", icon: MessageSquare, badge: "3" },
  ];

  const mobileMoreItems = [
    { href: "/app/missions", label: "실행안 센터", icon: Zap, desc: "준비된 실행안 및 진행 현황" },
    { href: "/app/content", label: "콘텐츠 허브", icon: FolderKanban, desc: "발행 파이프라인 및 캘린더" },
    { href: "/app/channels", label: "채널 연결", icon: Radio, desc: "인스타, 스레드, 블로그 연동" },
    { href: "/app/reports", label: "소희가 만든 결과", icon: TrendingUp, desc: "직접/어시스트 예약 및 매출" },
    { href: "/app/memory", label: "우리 매장 기억", icon: BrainCircuit, desc: "서비스/상품 정보, 팩트 및 원칙" },
    { href: "/app/settings/automation", label: "자동화 범위 / 안전", icon: Settings, desc: "킬스위치 및 승인 정책" },
  ];

  const getRouteTitle = () => {
    if (pathname === "/app") return "오늘의 콕핏 (10초 요약)";
    if (pathname.startsWith("/app/opportunities")) return "기회함 (소희가 발견한 것)";
    if (pathname.startsWith("/app/missions")) return "실행안 센터 (소희가 준비한 것)";
    if (pathname.startsWith("/app/approvals")) return "확인할 것 (사장님 승인 대기)";
    if (pathname.startsWith("/app/inbox")) return "통합 문의함 (고객 소통)";
    if (pathname.startsWith("/app/content")) return "콘텐츠 허브 (인스타/스레드/블로그)";
    if (pathname.startsWith("/app/channels")) return "채널 연결 관리 (인스타/스레드/블로그/카카오)";
    if (pathname.startsWith("/app/reports")) return "소희가 만든 결과 (성과 리포트)";
    if (pathname.startsWith("/app/memory")) return "소희가 기억하는 우리 매장 (Knowledge)";
    if (pathname.startsWith("/app/settings")) return "자동화 범위 / 안전 설정 (안전 가드레일)";
    return "소희 마케팅 자율 운영체제";
  };

  const todayFormatted = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());

  return (
    <div className="min-h-screen flex bg-[#FAF9F7] dark:bg-[#0C0D0E] text-[#171717] dark:text-zinc-100 font-sans antialiased selection:bg-[#F1EDFF] selection:text-[#5333E0]">
      {/* Desktop Sidebar (1024px+) */}
      <aside
        aria-label="주 메뉴"
        className="hidden lg:flex flex-col w-64 border-r border-[#EAE7E3] dark:border-[rgba(255,255,255,0.08)] bg-white dark:bg-[#141517] shrink-0 select-none shadow-[1px_0_12px_rgba(0,0,0,0.02)]"
      >
        {/* Brand Header */}
        <div className="p-5 pb-4 border-b border-[#EAE7E3] dark:border-[rgba(255,255,255,0.08)]">
          <div className="flex items-center justify-between">
            <Link href="/app" className="flex items-center gap-3 group">
              <motion.span
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="flex items-center justify-center w-9 h-9 rounded-2xl bg-gradient-to-br from-[#6D4AFF] to-[#8B6BFF] text-white font-black text-base shadow-[0_2px_8px_rgba(109,74,255,0.35),inset_0_1px_0_rgba(255,255,255,0.4)]"
              >
                ㅅ
              </motion.span>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-black text-base tracking-tight text-[#171717] dark:text-white">
                    소희
                  </span>
                  <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-[#F1EDFF] text-[#5333E0] dark:bg-[#231C44] dark:text-[#C3B4FF] border border-[#DCD3FF] dark:border-[#3D3075]">
                    V0.8.7
                  </span>
                </div>
                <span className="block text-[10px] font-semibold text-[#8C8A87] tracking-tight">
                  마케팅 자율 에이전트
                </span>
              </div>
            </Link>

            <ThemeToggle />
          </div>

          {/* Workspace Switcher */}
          <div className="w-full mt-4 p-2.5 rounded-2xl bg-[#FAF9F7] dark:bg-[#1C1E22] border border-[#EAE7E3] dark:border-[rgba(255,255,255,0.06)] flex items-center justify-between text-left shadow-xs">
            <div className="min-w-0">
              <span className="block text-[9px] font-extrabold text-[#8C8A87] uppercase tracking-wider">
                ACTIVE WORKSPACE
              </span>
              <strong className="block text-xs font-bold text-[#171717] dark:text-zinc-200 truncate">
                {todayData.workspaceName}
              </strong>
            </div>
            <ChevronDown className="w-4 h-4 text-[#8C8A87]" />
          </div>
        </div>

        {/* Navigation List with Floating Pill Motion */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href !== "/app" && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition-colors duration-150 ${
                  isActive
                    ? "text-[#5333E0] dark:text-[#C3B4FF]"
                    : "text-[#666666] dark:text-zinc-400 hover:text-[#171717] dark:hover:text-zinc-100 hover:bg-[#F6F4F0] dark:hover:bg-[#1C1E22]"
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="sidebar-active-pill"
                    className="absolute inset-0 rounded-xl bg-[#F1EDFF] dark:bg-[#231C44] border border-[#DCD3FF] dark:border-[#3D3075] shadow-xs"
                    transition={{ type: "spring", stiffness: 450, damping: 35 }}
                  />
                )}
                <div className="relative z-10 flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${isActive ? "text-[#6D4AFF] dark:text-[#8B6BFF]" : "text-[#8C8A87]"}`} />
                  <span>{item.label}</span>
                </div>
                {item.badge && item.badge !== "0" && (
                  <span
                    className={`relative z-10 px-2 py-0.5 text-[10px] font-black rounded-full ${
                      isActive
                        ? "bg-[#6D4AFF] text-white"
                        : "bg-[#EAE7E3] text-[#666666] dark:bg-zinc-800 dark:text-zinc-300"
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Sidebar Footer (Live System Guardrail Status) */}
        <div className="p-3.5 m-3 rounded-2xl bg-[#FAF9F7] dark:bg-[#1C1E22] border border-[#EAE7E3] dark:border-[rgba(255,255,255,0.06)] text-[11px] space-y-1.5 shadow-xs">
          <div className="flex items-center gap-2 font-bold text-[#171717] dark:text-zinc-200">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#10B981] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#10B981]" />
            </span>
            <span>가드레일 정상 가동</span>
          </div>
          <p className="text-[10px] text-[#8C8A87] leading-tight">
            일일 지출한도 10만원 · 방해금지 시간(21~09시) 준수
          </p>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 pb-20 lg:pb-0">
        {/* Top Header Bar */}
        <header className="h-16 px-4 lg:px-8 border-b border-[#EAE7E3] dark:border-[rgba(255,255,255,0.08)] bg-white/85 dark:bg-[#141517]/85 backdrop-blur-xl sticky top-0 z-30 flex items-center justify-between gap-4 shadow-xs">
          <div>
            <span className="block text-[10px] font-bold text-[#8C8A87] uppercase tracking-wider">
              {todayFormatted}
            </span>
            <h1 className="text-sm sm:text-base lg:text-lg font-black text-[#171717] dark:text-white truncate tracking-tight">
              {getRouteTitle()}
            </h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-[#ECFDF5] text-[#10B981] dark:bg-state-ok/60 dark:text-state-ok border border-state-ok/30 shadow-xs">
              <Activity className="w-3 h-3" />
              <span className="hidden sm:inline">실시간 자율 감지 중</span>
            </span>

            <div className="lg:hidden">
              <ThemeToggle />
            </div>

            {/* Agent Copilot Toggle Button */}
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => setIsAgentOpen((prev) => !prev)}
              aria-label="소희 대화 열기"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#6D4AFF] hover:bg-[#5A35EB] text-white font-extrabold text-xs shadow-[0_2px_8px_rgba(109,74,255,0.3),inset_0_1px_0_rgba(255,255,255,0.3)] transition-all cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5 fill-current" />
              <span>소희 판단 근거</span>
            </motion.button>
          </div>
        </header>

        {/* Page Children Container */}
        <main className="flex-1 p-4 lg:p-8 max-w-7xl w-full mx-auto space-y-6">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Floating Capsule Bar (5 Tabs) */}
      <nav
        aria-label="모바일 주 메뉴"
        className="lg:hidden fixed bottom-3 inset-x-3 h-16 bg-white/95 dark:bg-[#141517]/95 border border-[#EAE7E3] dark:border-[rgba(255,255,255,0.1)] rounded-2xl shadow-xl backdrop-blur-2xl z-40 flex items-center justify-around px-2"
      >
        {mobilePrimaryTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = pathname === tab.href;

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-[11px] font-bold transition-all relative ${
                isActive ? "text-[#6D4AFF] dark:text-[#8B6BFF]" : "text-[#8C8A87]"
              }`}
            >
              <Icon className="w-5 h-5 mb-0.5" />
              <span>{tab.label}</span>
              {tab.badge && tab.badge !== "0" && (
                <span className="absolute top-1 right-2.5 px-1.5 py-0.2 rounded-full text-[9px] font-black bg-[#6D4AFF] text-white">
                  {tab.badge}
                </span>
              )}
            </Link>
          );
        })}

        <button
          onClick={() => setIsMobileMoreOpen(true)}
          className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-[11px] font-bold transition-colors ${
            isMobileMoreOpen ? "text-[#6D4AFF]" : "text-[#8C8A87]"
          }`}
        >
          <MoreHorizontal className="w-5 h-5 mb-0.5" />
          <span>더보기</span>
        </button>
      </nav>

      {/* Mobile More Sheet Modal */}
      <AnimatePresence>
        {isMobileMoreOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="lg:hidden fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex flex-col justify-end"
          >
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 350, damping: 30 }}
              className="bg-white dark:bg-[#141517] rounded-t-3xl p-6 pb-10 space-y-4 shadow-2xl border-t border-[#EAE7E3] dark:border-[rgba(255,255,255,0.1)]"
            >
              <div className="flex items-center justify-between pb-3 border-b border-[#EAE7E3] dark:border-[rgba(255,255,255,0.06)]">
                <strong className="text-sm font-black text-[#171717] dark:text-white">
                  더보기 관리 메뉴
                </strong>
                <div className="flex items-center gap-2">
                  <ThemeToggle />
                  <button
                    onClick={() => setIsMobileMoreOpen(false)}
                    className="p-1 rounded-xl text-[#8C8A87] hover:bg-[#F6F4F0]"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {mobileMoreItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setIsMobileMoreOpen(false)}
                      className="flex items-center gap-3.5 p-3 rounded-2xl bg-[#FAF9F7] dark:bg-[#1C1E22] hover:bg-[#F1EDFF] text-xs font-bold text-[#171717] dark:text-zinc-200 transition-colors"
                    >
                      <div className="w-9 h-9 rounded-xl bg-white dark:bg-[#141517] border border-[#EAE7E3] dark:border-[rgba(255,255,255,0.08)] flex items-center justify-center text-[#6D4AFF] shadow-xs">
                        <Icon className="w-4 h-4" />
                      </div>
                      <div>
                        <strong className="block text-xs font-bold">{item.label}</strong>
                        <span className="text-[10px] font-medium text-[#8C8A87]">{item.desc}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Slide-in Copilot Drawer */}
      <SoheeAgentCopilot
        goal={todayData.goal}
        opportunity={todayData.topOpportunity}
        isOpen={isAgentOpen}
        onClose={() => setIsAgentOpen(false)}
      />
    </div>
  );
}
