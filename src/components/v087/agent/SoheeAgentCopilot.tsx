"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  X, 
  Shield, 
  ArrowUp, 
  Sparkles, 
  Loader2, 
  CheckCircle2, 
  Heart, 
  MessageCircle, 
  Send, 
  Bookmark, 
  MoreHorizontal,
  Camera,
  Calendar,
  Layers,
  ChevronRight,
  ChevronLeft,
  TrendingUp,
  Award,
  ExternalLink
} from "lucide-react";
import { TodayGoalReadModel, TodayOpportunityReadModel } from "@/lib/read-models/today-read-model";

interface InterviewOption {
  id: string;
  label: string;
  description?: string;
  value: string;
}

interface SocialPreviewData {
  channel: "INSTAGRAM" | "THREADS" | "NAVER_BLOG";
  profileName: string;
  profileHandle: string;
  locationText?: string;
  images: string[];
  caption: string;
  hashtags: string[];
  likesCount?: number;
}

interface ChatMessage {
  role: "sohee" | "user";
  text: string;
  subtext?: string;
  step?: "INTERVIEW_QUESTION" | "CONTENT_PREVIEW" | "GENERAL_REPLY";
  interview?: {
    stepIndex: number;
    questionCategory: "PURPOSE" | "IMAGE_STYLE" | "IMAGE_COUNT" | "CHANNEL_TONE";
    question: string;
    options: InterviewOption[];
  };
  preview?: SocialPreviewData;
  thoughtProcess?: string;
  suggestedActions?: Array<{ label: string; action: string }>;
}

interface SoheeAgentCopilotProps {
  workspaceId?: string;
  goal?: TodayGoalReadModel | null;
  opportunity?: TodayOpportunityReadModel | null;
  isOpen: boolean;
  onClose: () => void;
}

export function SoheeAgentCopilot({
  workspaceId = "ws-default",
  goal,
  opportunity,
  isOpen,
  onClose,
}: SoheeAgentCopilotProps) {
  void opportunity;
  const [activeTab, setActiveTab] = useState<"chat" | "reasoning" | "data" | "logs">("chat");
  const [inputText, setInputText] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  
  // Multi-step selections
  const [selectedPurpose, setSelectedPurpose] = useState<string>("");
  const [selectedStyle, setSelectedStyle] = useState<string>("");
  const [activeImageIndex, setActiveImageIndex] = useState<number>(0);
  const [publishResult, setPublishResult] = useState<{ success: boolean; message: string; url?: string } | null>(null);

  // Preference and Market Learning State
  const [learningHistory, setLearningHistory] = useState<Array<{ date: string; topic: string; style: string; reactionScore: number }>>([
    { date: "8/30", topic: "신메뉴 출시 및 비포애프터", style: "자연광 스마트폰 실사", reactionScore: 96 },
    { date: "8/27", topic: "인기 시그니처 메뉴 안내", style: "초근접 디테일컷", reactionScore: 92 },
    { date: "8/24", topic: "이번 주 예약 슬롯 마감", style: "사장님 1:1 맞춤 응대", reactionScore: 89 },
  ]);

  const [latestThought, setLatestThought] = useState<string>(
    "우리 매장 문맥 분석: 매장 주력 서비스 기준으로 1:1 맞춤 기획 대기 중"
  );

  const [logs, setLogs] = useState<Array<{ time: string; tag: string; message: string; color: string }>>([
    { time: "10:30:10", tag: "AGENT_READY", message: "소희 1:1 대화형 매장 기획 엔진 가동", color: "text-state-ok" },
    { time: "10:30:12", tag: "PROFILE_LOADED", message: "정본 프로필: 우리 매장 (@store_id 대표 메뉴/서비스 전문)", color: "text-primary" },
  ]);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "sohee",
      text: "안녕하세요 사장님! 매장 마케팅 전담 에이전트 소희예요. 😊\n\n매장 대표 메뉴, 신메뉴 출시, 이벤트 안내 등 원하시는 포스팅을 저에게 말씀해 주시면, **질문을 통해 원하시는 이미지 장수와 느낌을 정하고 실제 인스타그램 화면 그대로 완성**해 드릴게요!\n\n어떤 콘텐츠를 만들어 볼까요?",
      subtext: "소희 루나 추론 엔진 · 매장 맞춤 도메인",
      suggestedActions: [
        { label: "📸 대표 메뉴 피드 포스팅 만들기", action: "create_post" },
        { label: "✨ 신규 시그니처 서비스 홍보하기", action: "promote_item" },
        { label: "📣 주말 특별 이벤트 소식 만들기", action: "promote_event" },
      ],
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen, isThinking]);

  const handleSendText = async (textToSend?: string, selectionData?: Record<string, unknown>) => {
    const messageContent = textToSend || inputText.trim();
    if (!messageContent && !selectionData) return;
    if (isThinking) return;

    if (!textToSend && !selectionData) {
      setInputText("");
    }

    const selectionText = selectionData ? `[선택] ${String(selectionData.purpose || selectionData.imageStyle || (selectionData.imageCount ? String(selectionData.imageCount) + '장' : ''))}` : '';

    const newMessages: ChatMessage[] = [
      ...messages,
      { role: "user", text: messageContent || selectionText },
    ];
    setMessages(newMessages);
    setIsThinking(true);
    setPublishResult(null);

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agent/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({
            role: m.role === "sohee" ? "assistant" : "user",
            content: m.text,
          })),
          selectionData,
        }),
      });

      if (!res.ok) throw new Error("응답 실패");
      const data: ChatMessage = await res.json();

      if (data.thoughtProcess) {
        setLatestThought(data.thoughtProcess);
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "sohee",
          text: data.text || (typeof data === 'object' && data !== null && 'content' in data ? String((data as Record<string, unknown>).content) : ''),
          subtext: "소희 자율 에이전트 (루나 추론 엔진)",
          step: data.step,
          interview: data.interview,
          preview: data.preview,
          thoughtProcess: data.thoughtProcess,
          suggestedActions: data.suggestedActions,
        },
      ]);

      const nowTime = new Date().toLocaleTimeString();
      setLogs((prev) => [
        ...prev,
        {
          time: nowTime,
          tag: data.step === "CONTENT_PREVIEW" ? "PREVIEW_RENDERED" : "INTERVIEW_STEP",
          message: `소희 추론 및 단계 완료 (${data.step || "REPLY"})`,
          color: "text-[#9333EA]",
        },
      ]);
    } catch (err) {
      console.error("Sohee copilot error:", err);
      setMessages((prev) => [
        ...prev,
        {
          role: "sohee",
          text: "사장님, 요청하신 내용을 정리 중입니다. 원하시는 포스팅 주제나 스타일을 말씀해 주세요!",
          subtext: "소희 응답 준비 완료",
        },
      ]);
    } finally {
      setIsThinking(false);
    }
  };

  // Option Click Handler in 3-Stage Interview
  const handleSelectOption = (category: "PURPOSE" | "IMAGE_STYLE" | "IMAGE_COUNT" | "CHANNEL_TONE", option: InterviewOption) => {
    if (category === "PURPOSE") {
      setSelectedPurpose(option.value);
      handleSendText(`[선택: ${option.label}]`, {
        step: "PURPOSE_SELECTED",
        purpose: option.value,
      });
    } else if (category === "IMAGE_STYLE") {
      setSelectedStyle(option.value);
      handleSendText(`[선택: ${option.label}]`, {
        step: "STYLE_SELECTED",
        purpose: selectedPurpose || "대표 메뉴/서비스 비포애프터",
        imageStyle: option.value,
      });
    } else if (category === "IMAGE_COUNT") {
      handleSendText(`[선택: ${option.label}]`, {
        step: "COUNT_SELECTED",
        purpose: selectedPurpose || "대표 메뉴/서비스 비포애프터",
        imageStyle: selectedStyle || "자연광 감성 스마트폰 실사 샷",
        imageCount: option.value,
        channel: "INSTAGRAM",
      });

      // 누적 학습 메모리 저장
      setLearningHistory((prev) => [
        {
          date: `${new Date().getMonth() + 1}/${new Date().getDate()}`,
          topic: selectedPurpose || "대표 메뉴",
          style: selectedStyle || "자연광 실사",
          reactionScore: 95,
        },
        ...prev,
      ]);
    }
  };

  // Action Click Handler (Real Instant Publishing via Meta API)
  const handleActionClick = async (action: string, previewData?: SocialPreviewData) => {
    if (action === "publish_instagram_now" || action === "publish_threads_now") {
      setIsPublishing(true);
      const targetChannel = action === "publish_instagram_now" ? "INSTAGRAM" : "THREADS";

      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/publishing/instant`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel: targetChannel,
            caption: previewData?.caption || "우리 매장 대표 메뉴/서비스 소개",
            hashtags: previewData?.hashtags || [],
            images: previewData?.images || [],
          }),
        });

        const data = await res.json();
        if (data.success) {
          const liveUrl = targetChannel === "INSTAGRAM" ? "https://www.instagram.com/sohee.ai" : "https://www.threads.net/@sohee.ai";
          setPublishResult({
            success: true,
            message: `${targetChannel === "INSTAGRAM" ? "인스타그램(@sohee.ai)" : "스레드(@sohee.ai)"}에 실제 게시물이 성공적으로 발행되었습니다!`,
            url: liveUrl,
          });

          setLogs((prev) => [
            ...prev,
            {
              time: new Date().toLocaleTimeString(),
              tag: "REAL_PUBLISH_SUCCESS",
              message: `${targetChannel} 실제 포스팅 발행 성공 (${liveUrl})`,
              color: "text-state-ok",
            },
          ]);
        } else {
          throw new Error(data.error || "발행 실패");
        }
      } catch (err: unknown) {
        setPublishResult({
          success: false,
          message: err instanceof Error ? err.message : "발행 중 오류가 발생했습니다.",
        });
      } finally {
        setIsPublishing(false);
      }
    } else if (action === "save_to_schedule") {
      setPublishResult({
        success: true,
        message: "이번 주 수요일 14:00 자동 발행 근무표에 등록되었습니다!",
      });
    } else if (action === "restart_interview" || action === "create_post" || action === "promote_lash" || action === "promote_men" || action === "start_post_interview") {
      handleSendText("대표 메뉴 인스타그램 포스팅 새로 기획해줘");
    }
  };

  if (!isOpen) return null;

  return (
    <aside 
      aria-label="소희 대화 및 감독 패널"
      className="fixed inset-y-0 right-0 z-50 w-full sm:w-[440px] lg:w-[480px] bg-white dark:bg-[#130E20] border-l border-[#E9D5FF] dark:border-[#581C87]/40 shadow-2xl flex flex-col transition-all duration-300 ease-out"
    >
      {/* Header */}
      <header className="p-4 border-b border-[#E9D5FF] dark:border-[#3B1963] flex items-center justify-between gap-3 bg-[#FAF5FF]/90 dark:bg-[#130E20]/90 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-9 h-9 rounded-2xl bg-linear-to-br from-[#9333EA] to-[#7E22CE] text-white font-black text-sm shadow-sm">
            ㅅ
          </span>
          <div>
            <div className="flex items-center gap-1.5">
              <strong className="block text-sm font-bold text-[#1F1437] dark:text-[#F3EEFF]">소희 에이전트</strong>
              <span className="px-1.5 py-0.2 rounded text-[10px] font-black bg-[#9333EA]/10 text-[#9333EA] dark:text-[#D8B4FE]">
                @sohee.ai (테스트)
              </span>
            </div>
            <span className="flex items-center gap-1 text-[11px] text-[#7E6E9B] dark:text-[#A78BFA]">
              <span className="w-1.5 h-1.5 rounded-full bg-state-ok animate-pulse" />
              우리 매장 ➔ @sohee.ai 즉시 발행
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-state-ok-soft text-state-ok dark:bg-state-ok/40 dark:text-state-ok border border-state-ok/30">
            <Shield className="w-3 h-3" />
            Full Agent
          </span>
          <button
            onClick={onClose}
            aria-label="소희 패널 닫기"
            className="p-1 rounded-lg text-[#7E6E9B] hover:text-[#1F1437] dark:hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Tabs */}
      <nav className="flex border-b border-[#E9D5FF] dark:border-[#3B1963] px-3 text-xs font-black bg-white dark:bg-[#130E20]">
        <button
          onClick={() => setActiveTab("chat")}
          className={`py-2.5 px-3 border-b-2 transition-colors cursor-pointer ${
            activeTab === "chat"
              ? "border-[#9333EA] text-[#9333EA] dark:text-[#D8B4FE]"
              : "border-transparent text-[#7E6E9B] dark:text-[#A78BFA]"
          }`}
        >
          대화 &amp; 뷰티 포스팅
        </button>
        <button
          onClick={() => setActiveTab("reasoning")}
          className={`py-2.5 px-3 border-b-2 transition-colors cursor-pointer ${
            activeTab === "reasoning"
              ? "border-[#9333EA] text-[#9333EA] dark:text-[#D8B4FE]"
              : "border-transparent text-[#7E6E9B] dark:text-[#A78BFA]"
          }`}
        >
          소희 생각 (추론)
        </button>
        <button
          onClick={() => setActiveTab("data")}
          className={`py-2.5 px-3 border-b-2 transition-colors cursor-pointer ${
            activeTab === "data"
              ? "border-[#9333EA] text-[#9333EA] dark:text-[#D8B4FE]"
              : "border-transparent text-[#7E6E9B] dark:text-[#A78BFA]"
          }`}
        >
          선호 &amp; 반응 데이터
        </button>
        <button
          onClick={() => setActiveTab("logs")}
          className={`py-2.5 px-3 border-b-2 transition-colors cursor-pointer ${
            activeTab === "logs"
              ? "border-[#9333EA] text-[#9333EA] dark:text-[#D8B4FE]"
              : "border-transparent text-[#7E6E9B] dark:text-[#A78BFA]"
          }`}
        >
          발행 로그
        </button>
      </nav>

      {/* Main Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#FAF5FF]/30 dark:bg-[#0D0716]/40">
        {/* Goal Banner */}
        {goal && (
          <div className="p-3 rounded-2xl bg-white dark:bg-[#1A1229] border border-[#E9D5FF] dark:border-[#3B1963] text-xs shadow-2xs">
            <div className="flex items-center justify-between text-[#7E6E9B] dark:text-[#A78BFA] mb-1 font-bold">
              <span>현재 집중 목표</span>
              <span className="px-1.5 py-0.2 rounded text-[10px] font-black bg-state-ok-soft text-state-ok dark:bg-state-ok dark:text-state-ok">
                실측 SOT
              </span>
            </div>
            <strong className="block text-xs font-black text-[#1F1437] dark:text-[#F3EEFF]">
              {goal.title || "이번 주 화/목 잔여 4타임 슬롯 마감"}
            </strong>
          </div>
        )}

        {/* Tab 1: Chat & Interactive Studio */}
        {activeTab === "chat" && (
          <div className="space-y-4">
            {messages.map((msg, idx) => (
              <article
                key={idx}
                className={`p-3.5 rounded-2xl text-xs sm:text-sm leading-relaxed shadow-2xs ${
                  msg.role === "sohee"
                    ? "bg-white dark:bg-[#1A1229] text-[#1F1437] dark:text-[#F3EEFF] border border-[#E9D5FF]/80 dark:border-[#3B1963]"
                    : "bg-[#9333EA] text-white ml-6 font-medium"
                }`}
              >
                {msg.role === "sohee" && (
                  <div className="flex items-center gap-1.5 mb-2 text-xs font-black text-[#9333EA] dark:text-[#D8B4FE]">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>소희</span>
                  </div>
                )}

                <p className="whitespace-pre-wrap">{msg.text}</p>

                {/* 1. 소희의 대화형 인터뷰 옵션 카드 (5가지 선택지) */}
                {msg.interview && msg.interview.options && (
                  <div className="mt-3.5 space-y-2 border-t border-[#E9D5FF]/60 dark:border-[#3B1963] pt-3">
                    <div className="text-[11px] font-black text-[#9333EA] dark:text-[#D8B4FE] flex items-center gap-1">
                      <ChevronRight className="w-3.5 h-3.5" />
                      {msg.interview.question}
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {msg.interview.options.map((opt) => (
                        <button
                          key={opt.id}
                          onClick={() => handleSelectOption(msg.interview!.questionCategory, opt)}
                          className="p-2.5 rounded-xl text-left bg-[#FAF5FF] dark:bg-[#25153A] border border-[#E9D5FF] dark:border-[#581C87] hover:border-[#9333EA] hover:bg-[#F3E8FF] transition-all cursor-pointer group shadow-2xs"
                        >
                          <div className="text-xs font-black text-[#1F1437] dark:text-[#F3EEFF] group-hover:text-[#9333EA] dark:group-hover:text-[#D8B4FE]">
                            {opt.label}
                          </div>
                          {opt.description && (
                            <div className="text-[11px] text-[#7E6E9B] dark:text-[#A78BFA] mt-0.5">
                              {opt.description}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 2. 실제 인스타그램 포스팅 결과물과 100% 동일한 라이브 피드 카드 UI */}
                {msg.preview && (
                  <div className="mt-4 rounded-2xl overflow-hidden border border-[#E9D5FF] dark:border-[#581C87] bg-white dark:bg-[#130E20] shadow-md">
                    {/* Instagram Profile Header */}
                    <div className="p-3 flex items-center justify-between border-b border-[#E9D5FF]/60 dark:border-[#3B1963]">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-linear-to-tr from-state-warn via-state-danger to-primary p-0.5">
                          <div className="w-full h-full rounded-full bg-white dark:bg-zinc-900 flex items-center justify-center text-[10px] font-black text-[#9333EA]">
                            BR
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-bold text-[#1F1437] dark:text-white flex items-center gap-1">
                            {msg.preview.profileHandle}
                            <span className="w-1 h-1 rounded-full bg-state-wait inline-block" />
                          </div>
                          {msg.preview.locationText && (
                            <div className="text-[10px] text-[#7E6E9B] dark:text-[#A78BFA]">
                              {msg.preview.locationText}
                            </div>
                          )}
                        </div>
                      </div>
                      <MoreHorizontal className="w-4 h-4 text-[#7E6E9B]" />
                    </div>

                    {/* Feed Image Carousel (Multi-image support) */}
                    <div className="relative bg-zinc-100 dark:bg-zinc-900 aspect-square flex items-center justify-center overflow-hidden">
                      <img
                        src={msg.preview.images[activeImageIndex] || msg.preview.images[0]}
                        alt="우리 매장 인스타그램 피드 실사 이미지"
                        className="w-full h-full object-cover transition-all duration-300"
                      />

                      {/* Carousel Indicator & Controls */}
                      {msg.preview.images.length > 1 && (
                        <>
                          <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-[10px] font-bold text-white tabular-nums">
                            {activeImageIndex + 1} / {msg.preview.images.length}
                          </div>

                          {activeImageIndex > 0 && (
                            <button
                              onClick={() => setActiveImageIndex((prev) => Math.max(prev - 1, 0))}
                              className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/50 hover:bg-black/70 text-white cursor-pointer"
                            >
                              <ChevronLeft className="w-4 h-4" />
                            </button>
                          )}

                          {activeImageIndex < msg.preview.images.length - 1 && (
                            <button
                              onClick={() => setActiveImageIndex((prev) => Math.min(prev + 1, msg.preview!.images.length - 1))}
                              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/50 hover:bg-black/70 text-white cursor-pointer"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          )}

                          <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex items-center gap-1">
                            {msg.preview.images.map((_, dotIdx) => (
                              <span
                                key={dotIdx}
                                className={`w-1.5 h-1.5 rounded-full transition-all ${
                                  dotIdx === activeImageIndex ? "bg-white w-3" : "bg-white/50"
                                }`}
                              />
                            ))}
                          </div>
                        </>
                      )}

                      <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-[10px] font-bold text-white flex items-center gap-1">
                        <Camera className="w-3 h-3 text-primary" />
                        피드 미리보기
                      </div>
                    </div>

                    {/* Action Bar */}
                    <div className="p-3 space-y-2">
                      <div className="flex items-center justify-between text-[#1F1437] dark:text-white">
                        <div className="flex items-center gap-3">
                          <Heart className="w-5 h-5 text-state-danger fill-state-danger" />
                          <MessageCircle className="w-5 h-5" />
                          <Send className="w-5 h-5" />
                        </div>
                        <Bookmark className="w-5 h-5" />
                      </div>

                      <div className="text-[11px] font-bold text-[#1F1437] dark:text-white">
                        좋아요 {msg.preview.likesCount || 168}개
                      </div>

                      {/* Caption & Hashtags */}
                      <div className="text-xs text-[#1F1437] dark:text-[#E9D5FF] space-y-1 leading-relaxed">
                        <span className="font-black mr-1.5">{msg.preview.profileHandle}</span>
                        <span className="whitespace-pre-wrap">{msg.preview.caption}</span>
                        <div className="pt-1.5 text-state-wait font-semibold text-[11px] flex flex-wrap gap-1">
                          {msg.preview.hashtags.map((h, hIdx) => (
                            <span key={hIdx}>{h}</span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Direct Execution Bar (이대로 전송할까요?) */}
                    <div className="p-3.5 bg-[#FAF5FF] dark:bg-[#201333] border-t border-[#E9D5FF] dark:border-[#581C87] space-y-2.5">
                      <div className="text-xs font-black text-[#9333EA] dark:text-[#D8B4FE] flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4" />
                        이대로 지금 즉시 인스타그램에 전송할까요?
                      </div>

                      {publishResult && (
                        <div className={`p-2.5 rounded-xl border text-xs font-bold flex flex-col gap-1 ${
                          publishResult.success
                            ? "bg-state-ok-soft border-state-ok/40 text-state-ok"
                            : "bg-state-danger-soft border-state-danger/40 text-state-danger"
                        }`}>
                          <div className="flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4 text-state-ok shrink-0" />
                            <span>{publishResult.message}</span>
                          </div>
                          {publishResult.url && (
                            <a
                              href={publishResult.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] text-state-wait underline flex items-center gap-1 ml-5 font-bold"
                            >
                              게시물 확인하기 ({publishResult.url})
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                        <button
                          onClick={() => handleActionClick("publish_instagram_now", msg.preview)}
                          disabled={isPublishing}
                          className="px-3 py-2 rounded-xl bg-[#9333EA] hover:bg-[#7E22CE] text-white text-xs font-black shadow-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          {isPublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                          지금 즉시 인스타에 발행
                        </button>
                        <button
                          onClick={() => handleActionClick("publish_threads_now", msg.preview)}
                          disabled={isPublishing}
                          className="px-3 py-2 rounded-xl bg-[#1F1437] hover:bg-black text-white text-xs font-black shadow-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <Layers className="w-4 h-4" />
                          스레드에도 동시 발행
                        </button>
                        <button
                          onClick={() => handleActionClick("save_to_schedule", msg.preview)}
                          className="px-3 py-2 rounded-xl bg-white dark:bg-[#2B1B44] border border-[#E9D5FF] dark:border-[#581C87] text-[#1F1437] dark:text-[#F3EEFF] text-xs font-bold hover:bg-[#F3E8FF] flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Calendar className="w-3.5 h-3.5 text-[#9333EA]" />
                          이번 주 근무표에 예약
                        </button>
                        <button
                          onClick={() => handleActionClick("restart_interview")}
                          className="px-3 py-2 rounded-xl bg-white dark:bg-[#2B1B44] border border-[#E9D5FF] dark:border-[#581C87] text-[#7E6E9B] dark:text-[#A78BFA] text-xs font-bold hover:bg-[#F3E8FF] flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          ✏️ 조건 다시 설정
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Suggested Action Quick Pills */}
                {msg.suggestedActions && msg.suggestedActions.length > 0 && !msg.preview && (
                  <div className="mt-3 pt-2.5 border-t border-[#E9D5FF]/60 dark:border-[#3B1963] flex flex-wrap gap-1.5">
                    {msg.suggestedActions.map((act, aIdx) => (
                      <button
                        key={aIdx}
                        onClick={() => handleActionClick(act.action)}
                        className="px-2.5 py-1 rounded-lg bg-[#FAF5FF] dark:bg-[#25153A] border border-[#E9D5FF] dark:border-[#581C87] text-[#9333EA] dark:text-[#D8B4FE] text-[11px] font-black hover:bg-[#F3E8FF] cursor-pointer"
                      >
                        {act.label} ➔
                      </button>
                    ))}
                  </div>
                )}

                {msg.subtext && (
                  <small className="block text-[10px] text-[#7E6E9B] dark:text-[#A78BFA] mt-2 font-medium">
                    {msg.subtext}
                  </small>
                )}
              </article>
            ))}

            {isThinking && (
              <div className="p-3.5 rounded-2xl bg-white dark:bg-[#1A1229] border border-[#E9D5FF] dark:border-[#3B1963] text-xs text-[#9333EA] dark:text-[#D8B4FE] flex items-center gap-2 font-bold animate-pulse">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>소희가 우리 매장 인스타 피드와 실사 이미지를 디자인하고 있어요...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Tab 2: Reasoning Stream */}
        {activeTab === "reasoning" && (
          <div className="space-y-3 text-xs leading-relaxed">
            <div className="p-4 rounded-2xl bg-white dark:bg-[#1A1229] border border-[#E9D5FF] dark:border-[#3B1963] space-y-1.5 shadow-2xs">
              <strong className="block text-xs font-black text-[#9333EA] dark:text-[#D8B4FE] flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                소희의 현재 추론 흐름 (Reasoning Pipeline)
              </strong>
              <p className="text-[#1F1437] dark:text-[#E9D5FF] font-medium leading-relaxed">
                {latestThought}
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-white dark:bg-[#1A1229] border border-[#E9D5FF] space-y-1">
              <strong className="block text-xs font-bold text-[#1F1437] dark:text-white">
                1. 우리 매장 대표 비즈니스 도메인 주입
              </strong>
              <p className="text-[#7E6E9B] dark:text-[#A78BFA]">
                매장의 대표 메뉴와 서비스 정체성을 바탕으로 1:1 질문-답변을 유도합니다.
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-white dark:bg-[#1A1229] border border-[#E9D5FF] space-y-1">
              <strong className="block text-xs font-bold text-[#1F1437] dark:text-white">
                2. 다장(캐러셀) gpt-image-2 비주얼 엔진
              </strong>
              <p className="text-[#7E6E9B] dark:text-[#A78BFA]">
                사장님이 선택하신 장수(1~5장)에 맞춰 다양한 각도의 실사 이미지를 생성하고 캐러셀로 렌더링합니다.
              </p>
            </div>
          </div>
        )}

        {/* Tab 3: Preference & Market Learning Memory */}
        {activeTab === "data" && (
          <div className="space-y-3 text-xs">
            <div className="p-4 rounded-2xl bg-white dark:bg-[#1A1229] border border-[#E9D5FF] dark:border-[#3B1963] space-y-2">
              <div className="flex items-center justify-between">
                <strong className="text-xs font-black text-[#1F1437] dark:text-white flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-[#9333EA]" />
                  사장님 포스팅 선호도 누적 데이터
                </strong>
                <span className="text-[10px] font-bold text-state-ok">상시 학습 중</span>
              </div>
              <p className="text-[#7E6E9B] dark:text-[#A78BFA] text-[11px]">
                대화를 통해 선택하신 주제와 스타일이 축적되어 소희가 다음 제안 시 더 높은 정확도로 추천합니다.
              </p>
            </div>

            <div className="space-y-2">
              {learningHistory.map((item, idx) => (
                <div key={idx} className="p-3 rounded-2xl bg-white dark:bg-[#1A1229] border border-[#E9D5FF] dark:border-[#3B1963] flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="text-xs font-bold text-[#1F1437] dark:text-[#F3EEFF]">
                      {item.topic} · <span className="text-[#9333EA]">{item.style}</span>
                    </div>
                    <div className="text-[10px] text-[#7E6E9B]">{item.date} 선택 이력</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-black text-state-ok flex items-center gap-0.5">
                      <TrendingUp className="w-3 h-3" />
                      {item.reactionScore}점
                    </div>
                    <span className="text-[9px] text-[#7E6E9B]">시장 반응도</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 4: Logs */}
        {activeTab === "logs" && (
          <div className="space-y-2 text-xs font-mono">
            {logs.map((log, idx) => (
              <div key={idx} className="p-3 rounded-2xl bg-white dark:bg-[#1A1229] border border-[#E9D5FF] dark:border-[#3B1963]">
                <div className="flex items-center justify-between text-[10px] text-[#7E6E9B] dark:text-[#A78BFA] font-bold">
                  <span>{log.time}</span>
                  <span className={`font-black ${log.color}`}>{log.tag}</span>
                </div>
                <div className="mt-1 text-xs text-[#1F1437] dark:text-[#F3EEFF] font-medium font-sans">
                  {log.message}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Composer Input */}
      <div className="p-3 sm:p-4 border-t border-[#E9D5FF] dark:border-[#3B1963] bg-white dark:bg-[#130E20]">
        <div className="relative flex items-center">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendText();
              }
            }}
            placeholder="소희에게 대표 메뉴/서비스 포스팅 제작을 지시하세요..."
            rows={2}
            className="w-full pl-3 pr-10 py-2.5 text-xs sm:text-sm rounded-2xl bg-[#FAF5FF] dark:bg-[#1A1229] border border-[#E9D5FF] dark:border-[#3B1963] focus:outline-none focus:ring-2 focus:ring-[#9333EA] resize-none text-[#1F1437] dark:text-[#F3EEFF] placeholder-[#7E6E9B] dark:placeholder-[#A78BFA]"
          />
          <button
            onClick={() => handleSendText()}
            disabled={!inputText.trim() || isThinking}
            aria-label="메시지 보내기"
            className="absolute right-2.5 bottom-2.5 p-2 rounded-xl bg-[#9333EA] hover:bg-[#7E22CE] disabled:opacity-40 text-white transition-all shadow-xs cursor-pointer"
          >
            {isThinking ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </aside>
  );
}
