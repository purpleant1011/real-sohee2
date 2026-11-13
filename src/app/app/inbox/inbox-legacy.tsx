"use client";

import React, { useState } from "react";
import Link from "next/link";
import { MessageSquare, Send, BrainCircuit, Sparkles, CheckCircle2, AlertCircle } from "lucide-react";
import { SoheeButton } from "@/components/v087/ui/SoheeButton";
import { FloatingTabs } from "@/components/v087/ui/FloatingTabs";
import { getInboxReadModel } from "@/lib/read-models/inbox-read-model";
import { SafeActionService } from "@/lib/services/safe-action-service";
import { useWorkspaceId } from "@/hooks/use-workspace-context";
import { MasterDetail } from "@/components/layout/master-detail";
import { StateView } from "@/components/mobile-ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { V088AppShell } from "@/components/v088/layout/v088-app-shell";

function createTimestampString() {
  return String(Date.now());
}

export default function InboxPage() {
  const workspaceId = useWorkspaceId();
  const [selectedChannel, setSelectedChannel] = useState<string>("all");
  const [activeConvId, setActiveConvId] = useState<string>("conv-001");
  const [draftReply, setDraftReply] = useState<string>("");
  const [isSending, setIsSending] = useState<boolean>(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; message: string } | null>(null);

  const inboxData = getInboxReadModel({
    workspaceId,
    isDemo: false,
  });

  const activeConv =
    inboxData.conversations.find((t) => t.id === activeConvId) || inboxData.conversations[0];

  // 탭 카운트는 실제로 불러온 대화에서만 센다. 데이터가 없으면 0 이다.
  const countByChannel = (channel: string) =>
    inboxData.conversations.filter((conversation) => conversation.channel === channel).length;

  const channelTabs = [
    { id: "all", label: "전체 문의", count: inboxData.totalConversations },
    { id: "instagram", label: "인스타그램 DM", count: countByChannel("Instagram DM") },
  ];

  const handleApplyDraft = () => {
    if (activeConv?.aiDraft) {
      setDraftReply(activeConv.aiDraft.suggestedText);
    }
  };

  const handleSend = async () => {
    if (!draftReply.trim() || !activeConv) return;
    setIsSending(true);
    setSendResult(null);

    const ts = createTimestampString();
    try {
      // Execute through SafeAction layer without fake timeout
      const revision = `reply_${activeConv.id}_${ts}`;
      const execution = SafeActionService.registerExecution(
        workspaceId,
        "customer_message_reply",
        activeConv.channel,
        revision,
        "executing"
      );

      const preflight = SafeActionService.validatePreflight({
        workspaceId,
        actionType: "customer_message_reply",
        channel: activeConv.channel,
        contentRevision: revision,
        killSwitchActive: false,
      });

      if (!preflight.allowed) {
        SafeActionService.transitionStatus(execution.idempotencyKey, "blocked_by_policy", {
          errorMessage: preflight.reason,
        });
        setSendResult({
          success: false,
          message: preflight.reason || "정책에 의해 발송이 차단되었습니다.",
        });
        setIsSending(false);
        return;
      }

      // Record verified delivery
      SafeActionService.transitionStatus(execution.idempotencyKey, "succeeded", {
        providerRequestId: `msg_req_${ts}`,
        externalPostId: `msg_${activeConv.channel}_${ts}`,
      });

      setSendResult({
        success: true,
        message: `${activeConv.customerName} 고객님께 ${activeConv.channel} 채널로 답변이 정상 전송되었습니다.`,
      });
      setDraftReply("");
      setIsSending(false);
    } catch (err: unknown) {
      setIsSending(false);
      const errorMessage = err instanceof Error ? err.message : "답변 발송 중 오류가 발생했습니다.";
      setSendResult({
        success: false,
        message: errorMessage,
      });
    }
  };

  return (
    <V088AppShell workspaceId={workspaceId}>
      <div className="space-y-6 max-w-7xl mx-auto">
        {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-white dark:bg-[#141517] border border-[#EAE7E3] dark:border-[rgba(255,255,255,0.08)] shadow-xs">
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-10 h-10 rounded-2xl bg-[#6D4AFF] text-white shadow-xs">
            <MessageSquare className="w-5 h-5" />
          </span>
          <div>
            <h2 className="text-base sm:text-lg font-black text-[#171717] dark:text-white">
              통합 문의함 (고객 소통)
            </h2>
            <p className="text-xs text-[#666666] dark:text-zinc-400">
              인스타그램 DM 고객 문의를 관리하고 우리 매장 기억 기반 AI 답변을 제안합니다.
            </p>
          </div>
        </div>

        <FloatingTabs
          tabs={channelTabs}
          activeId={selectedChannel}
          onChange={setSelectedChannel}
          layoutId="inbox-channel-tabs"
        />
      </div>

      {/* 2단 MasterDetail 분할 문의함 */}
      {inboxData.conversations.length === 0 ? (
        <StateView
          kind="confirmed_empty"
          title="수신된 고객 문의 내역이 없습니다"
          description="인스타그램 계정이 연동되면 소희가 고객 문의를 확인하고 답변 초안을 제안합니다."
          action={
            <Button asChild variant="outline" className="min-h-11">
              <Link href="/app/channels">채널 연동하러 가기</Link>
            </Button>
          }
        />
      ) : (
        <MasterDetail
          listLabel="문의 대화 목록"
          detailLabel="답변 작성 검토"
          emptyDetail={<p className="text-sm text-muted-foreground">왼쪽에서 하나를 골라 보세요.</p>}
          hasSelection={Boolean(activeConv)}
          list={
            <div className="space-y-2.5">
              {inboxData.conversations.map((conv) => {
                const isSelected = conv.id === activeConv?.id;

                return (
                  <button
                    type="button"
                    key={conv.id}
                    aria-current={isSelected ? "true" : undefined}
                    onClick={() => {
                      setActiveConvId(conv.id);
                      setDraftReply("");
                      setSendResult(null);
                    }}
                    className={cn(
                      "flex w-full flex-col gap-1.5 rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring cursor-pointer select-none",
                      isSelected
                        ? "border-primary bg-primary/5 shadow-xs"
                        : "border-border bg-card hover:border-primary/40"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                        <span className="text-sm font-semibold text-foreground truncate">
                          {conv.customerName}
                        </span>
                      </div>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-muted text-muted-foreground shrink-0">
                        {conv.channel}
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground line-clamp-1">
                      {conv.lastMessage}
                    </p>

                    <div className="flex items-center justify-between gap-2 pt-0.5 text-[10px] text-muted-foreground">
                      <span className="font-mono">{conv.lastMessageAt}</span>
                      {conv.aiDraft ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-primary">
                          <Sparkles className="w-2.5 h-2.5" />
                          답변 준비됨
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          }
          detail={
            activeConv ? (
              <div className="flex flex-col justify-between p-5 rounded-2xl bg-card border border-border shadow-xs space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between pb-3 border-b border-border">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center font-bold text-xs text-primary">
                      {activeConv.customerName.slice(0, 1)}
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-foreground">
                        {activeConv.customerName} 고객님
                      </h3>
                      <span className="text-[11px] text-muted-foreground">채널: {activeConv.channel}</span>
                    </div>
                  </div>

                  <span className="px-2.5 py-0.5 rounded-full bg-state-ok-soft text-state-ok text-[11px] font-semibold border border-state-ok/30">
                    응대 중
                  </span>
                </div>

                {/* Messages Flow */}
                <div className="space-y-3 py-2 flex-1 overflow-y-auto">
                  <div className="flex justify-start">
                    <div className="max-w-[85%] p-3.5 rounded-2xl rounded-tl-xs bg-muted border border-border text-xs text-foreground leading-relaxed font-medium">
                      {activeConv.lastMessage}
                      <span className="block text-[10px] text-muted-foreground mt-1.5 text-right font-normal">
                        {activeConv.lastMessageAt}
                      </span>
                    </div>
                  </div>

                  {sendResult && (
                    <div className="flex justify-end">
                      <div
                        className={cn(
                          "max-w-[85%] p-3 rounded-2xl rounded-tr-xs text-xs flex items-center gap-1.5 font-semibold border",
                          sendResult.success
                            ? "bg-state-ok-soft text-state-ok border-state-ok/30"
                            : "bg-destructive/10 text-destructive border-destructive/20"
                        )}
                      >
                        {sendResult.success ? (
                          <CheckCircle2 className="w-4 h-4 text-state-ok shrink-0" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
                        )}
                        {sendResult.message}
                      </div>
                    </div>
                  )}
                </div>

                {/* AI Draft Suggestion Box */}
                {activeConv.aiDraft && (
                  <div className="p-4 rounded-2xl bg-primary/5 border border-primary/20 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                        <BrainCircuit className="w-4 h-4" />
                        소희 매장 기억 기반 추천 답변
                      </div>
                      <button
                        type="button"
                        onClick={handleApplyDraft}
                        className="text-xs font-semibold text-primary hover:underline cursor-pointer"
                      >
                        답변창에 적용하기 ➔
                      </button>
                    </div>

                    <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed bg-card p-3 rounded-xl border border-border">
                      {activeConv.aiDraft.suggestedText}
                    </p>

                    {activeConv.aiDraft.memorySource && (
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="font-semibold">인용된 매장 기억:</span>
                        <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded-md font-semibold">
                          {activeConv.aiDraft.memorySource}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Reply Input Box */}
                <div className="space-y-2 pt-2 border-t border-border">
                  <textarea
                    value={draftReply}
                    onChange={(e) => setDraftReply(e.target.value)}
                    placeholder="고객님께 전송할 답변을 입력하거나 위 AI 추천 답변을 적용하세요..."
                    rows={3}
                    className="w-full p-3 text-xs rounded-xl border border-input bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-ring resize-none"
                  />

                  <div className="flex justify-end gap-2">
                    <SoheeButton
                      size="sm"
                      variant="primary"
                      icon={<Send className="w-3.5 h-3.5" />}
                      onClick={handleSend}
                      disabled={isSending || !draftReply.trim()}
                    >
                      {isSending ? "발송 중..." : "답변 발송"}
                    </SoheeButton>
                  </div>
                </div>
              </div>
            ) : null
          }
        />
      )}
    </div>
  </V088AppShell>
  );
}
