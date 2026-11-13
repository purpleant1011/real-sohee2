export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { AgentOrchestrator } from '@/lib/agent-os/agent-orchestrator';
import { projectActivityEvent } from '@/features/agent-activity/activity-event';
import { projectPublicAgentProgress } from '@/features/agent-activity/public-agent-progress';
import { ConversationRepository, ConversationTurnConflict } from '@/lib/conversation/conversation-repository';
import { verifyWorkspaceActor, handleWorkspaceActorError, redactErrorPayload } from '@/lib/auth/workspace-actor-guard';

import { getWorkspaceProfile } from '@/lib/profile/workspace-profile-service';
import { CanonicalContentLifecycleService } from '@/features/content/canonical-content-lifecycle';
import { MarketingWorkService } from '@/lib/agent-os/marketing-work-service';
import { MarketingMissionService } from '@/features/missions/marketing-mission-service';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createProductionGenerationOrchestrator } from '@/features/creative/production-generation-factory';
import { buildVisualBrief } from '@/features/creative/visual-brief-builder';
import type { IndustryDomain } from '@/features/creative/visual-brief-types';
import { SupabaseCreativeBundleStore } from '@/features/creative/creative-bundle-store';
import { classifyDockIntent } from '@/features/agent-intent/classify-dock-intent';
import { parseDockActions } from '@/features/agent-intent/dock-actions';
import { answerDockQuestion } from '@/features/chat-floor/dock-model.server';
import { answerFirstTurn } from '@/features/chat-floor/first-reply';

function turnConflictPayload(error: ConversationTurnConflict) {
  return {
    errorCode: error.code,
    message: error.code === 'TURN_ALREADY_EXISTS'
      ? '이미 접수된 요청입니다. 대화 기록에서 진행 상황을 확인해 주세요.'
      : '같은 요청 식별자로 다른 내용을 보낼 수 없습니다.',
    ...(error.code === 'TURN_ALREADY_EXISTS' ? {
      runId: error.runId, threadId: error.threadId, recovery: 'GET_THREAD',
    } : {}),
  };
}

function resolveIndustryDomain(rawIndustry?: string): IndustryDomain {
  if (!rawIndustry) return 'general';
  const lower = rawIndustry.toLowerCase();
  if (lower.includes('베이커리') || lower.includes('빵') || lower.includes('디저트') || lower.includes('bakery')) {
    return 'bakery';
  }
  if (lower.includes('뷰티') || lower.includes('미용') || lower.includes('헤어') || lower.includes('네일') || lower.includes('속눈썹') || lower.includes('beauty')) {
    return 'beauty';
  }
  if (lower.includes('카페') || lower.includes('커피') || lower.includes('cafe')) {
    return 'cafe';
  }
  return 'general';
}

function buildChatResultPayload(r: Awaited<ReturnType<typeof AgentOrchestrator.executeTurn>>) {
  return {
    role: 'assistant',
    sessionId: r.sessionId,
    threadId: r.threadId,
    runId: r.runId,
    workItemId: r.workItemId,
    missionId: r.missionId,
    planVersion: r.planVersion,
    contextVersion: r.contextVersion,
    step: r.step,
    toolName: r.toolName,
    content: r.replyContent,
    preview: r.preview,
    visualImage: r.visualImage,
    mcpAction: r.mcpAction,
    planCard: r.planCard,
    liveExecutionCard: r.liveExecutionCard,
    approvalCard: r.approvalCard,
    evidenceResultCard: r.evidenceResultCard,
    failureCard: r.failureCard,
    variants: r.variants,
    topic: r.topic,
    draftId: r.draftId,
    openInStudioPath: r.openInStudioPath,
    actionGraph: r.actionGraph,
    creditDeduction: r.creditDeduction,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;

  try {
    const body = await request.json().catch(() => ({}));
    const actor = await verifyWorkspaceActor(request, workspaceId, body);
    const isTestAccount = actor.isTestAccount;

    const { messages = [], selectionData, threadId, sessionId, surfaceContext } = body;
    const planContext = {
      missionId: typeof body.missionId === 'string' ? body.missionId : undefined,
      previousRunId: typeof body.previousRunId === 'string' ? body.previousRunId : undefined,
      expectedPlanVersion: Number.isSafeInteger(body.expectedPlanVersion) && body.expectedPlanVersion >= 0 ? body.expectedPlanVersion : undefined,
    };

    const surfaceMissionId = typeof surfaceContext === 'object' && surfaceContext !== null && typeof (surfaceContext as any).missionId === 'string' && /^[0-9a-f-]{8,}$/i.test((surfaceContext as any).missionId)
      ? (surfaceContext as any).missionId
      : undefined;

    // Scope Conflict Check (Fail-Closed):
    // 화면의 surfaceContext.missionId와 요청 본문의 planContext.missionId가 둘 다 존재하는데 불일치하는 경우
    // 다른 임무의 계획/실행이 현재 화면의 임무를 오염시키지 않도록 즉시 거부한다.
    if (surfaceMissionId && planContext.missionId && planContext.missionId !== surfaceMissionId) {
      return NextResponse.json({
        role: 'assistant',
        status: 'FAILED',
        errorCode: 'PLAN_SCOPE_CONFLICT',
        content: '⚠️ 보고 계신 마케팅 업무와 대화 컨텍스트가 일치하지 않아 안전하게 중단되었습니다. 새로고침 후 다시 시도해 주세요.',
      }, { status: 400 });
    }

    if (!planContext.missionId && surfaceMissionId) {
      planContext.missionId = surfaceMissionId;
    }

    // Authoritative Current-Turn Resolution (ANI-1029)
    const suppliedClientKeys: unknown[] = ['clientMessageId', 'client_message_id']
      .filter(key => Object.prototype.hasOwnProperty.call(body, key))
      .map(key => body[key]);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (suppliedClientKeys.some(key => typeof key !== 'string' || !uuid.test(key)) ||
      (suppliedClientKeys.length === 2 && String(suppliedClientKeys[0]).toLowerCase() !== String(suppliedClientKeys[1]).toLowerCase())) {
      return NextResponse.json({
        errorCode: 'INVALID_CLIENT_MESSAGE_ID',
        message: '요청 식별자가 올바르지 않습니다. 대화를 새로고침해 주세요.',
      }, { status: 400 });
    }
    // Never replace a supplied invalid key: that would turn a retry into a new execution.
    const clientMessageId = suppliedClientKeys.length > 0
      ? (suppliedClientKeys[0] as string).toLowerCase()
      : crypto.randomUUID();

    let currentTurnText = (
      typeof body.currentUserMessage === 'string' ? body.currentUserMessage.trim() :
      typeof body.message === 'string' ? body.message.trim() :
      typeof body.prompt === 'string' ? body.prompt.trim() : ''
    );

    const lastHistoricalUserEntry = [...messages].reverse().find((m: any) => m.role === 'user' || !m.role);
    const lastHistoricalContent = (lastHistoricalUserEntry?.content || '').trim();

    if (lastHistoricalContent && currentTurnText && lastHistoricalContent !== currentTurnText) {
      console.warn('[ANI-1029 Intake Contract] Detected historical last-user divergence from currentUserMessage.', {
        historical: lastHistoricalContent.slice(0, 50),
        authoritative: currentTurnText.slice(0, 50),
      });
    }

    if (!currentTurnText && lastHistoricalContent) {
      currentTurnText = lastHistoricalContent;
    }

    if (!currentTurnText && !selectionData) {
      return NextResponse.json({
        role: 'assistant',
        status: 'FAILED',
        errorCode: 'EMPTY_CURRENT_USER_MESSAGE',
        content: '⚠️ 메시지 내용을 입력해 주세요.',
      }, { status: 400 });
    }

    // 회수 요청 처리 (Task 9: 단일 conversation-adapter 경유, dockIntent 단순 답변 분기 전에 처리)
    const { isRecoveryIntent, handleRecoveryConversation } = await import('@/features/booking-recovery/conversation-adapter');
    if (isRecoveryIntent(currentTurnText) || body.caseId || body.sourceInboundMessageId) {
      const { createProductionBookingRecoveryService } = await import('@/features/booking-recovery/production');
      const adminClient = createAdminSupabaseClient();
      const recoveryService = createProductionBookingRecoveryService(adminClient);

      const recoveryActor = {
        workspaceId,
        userId: actor.actorId || '00000000-0000-4000-8000-000000000000',
        role: (actor.role === 'owner' ? 'owner' : 'manager') as 'owner' | 'manager',
      };

      const recoveryResult = await handleRecoveryConversation(
        {
          actor: recoveryActor,
          message: currentTurnText,
          caseId: body.caseId,
          sourceInboundMessageId: body.sourceInboundMessageId,
          slotId: body.slotId,
        },
        { service: recoveryService }
      );

      if (recoveryResult.type === 'recovery.updated') {
        const assistantText = `💌 고객님의 예약 문의 상태입니다. 아래 내용과 조건을 확인해 주세요.`;
        if (threadId) {
          try {
            await ConversationRepository.saveMessage(workspaceId, threadId, 'user', currentTurnText, { clientMessageId });
            await ConversationRepository.saveMessage(workspaceId, threadId, 'sohee', assistantText);
          } catch {}
        }
        return NextResponse.json({
          role: 'assistant',
          content: assistantText,
          reply: assistantText,
          recoveryCard: recoveryResult.view,
          step: recoveryResult.view.stage,
        }, { headers: { 'Cache-Control': 'no-store' } });
      } else if (recoveryResult.type === 'recovery.selection') {
        const assistantText = `💌 처리 대기 중인 예약 문의가 ${recoveryResult.cases.length}건 있습니다. 처리하실 문의를 선택해 주세요:`;
        return NextResponse.json({
          role: 'assistant',
          content: assistantText,
          reply: assistantText,
          actions: recoveryResult.cases.map((c) => ({
            id: `select-case-${c.caseId}`,
            label: `${c.offer?.serviceName || '문의'} (${c.statusLabel})`,
            href: `/app/conversations?caseId=${c.caseId}`,
          })),
        }, { headers: { 'Cache-Control': 'no-store' } });
      } else if (recoveryResult.type === 'recovery.empty') {
        return NextResponse.json({
          role: 'assistant',
          content: recoveryResult.message,
          reply: recoveryResult.message,
        }, { headers: { 'Cache-Control': 'no-store' } });
      }
    }

    // Dock navigation/creation intents are proposals only: no model or external write on this path.
    // Keep the existing orchestrator and interview flow untouched for other chat consumers.
    if (body.dockIntent === true && !selectionData) {
      const missionScope = typeof body.missionId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.missionId)
        ? body.missionId
        : typeof surfaceContext === 'object' && surfaceContext !== null && typeof (surfaceContext as any).missionId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test((surfaceContext as any).missionId)
          ? (surfaceContext as any).missionId
          : undefined;

      const intent = classifyDockIntent(currentTurnText, { missionId: missionScope });
      const result = intent?.reply
        ? { content: intent.reply, fallback: false, suggestedQuestions: [] }
        : await answerFirstTurn({ answer: (signal) => answerDockQuestion(currentTurnText, signal) });
      return NextResponse.json({
        role: 'assistant',
        reply: result.content,
        ...result,
        actions: parseDockActions(intent?.actions ?? []),
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // 1. Multi-step Interview Selection Processing
    if (selectionData) {
      const { step, purpose, imageStyle, imageCount = '1' } = selectionData;
      let interviewMissionId: string | null = null;

      let activeThreadId = threadId;
      if (!activeThreadId) {
        try {
          const newThread = await ConversationRepository.createThread(workspaceId, purpose ? `마케팅 인터뷰: ${purpose}` : '새 인터뷰 대화');
          activeThreadId = newThread?.id;
        } catch (threadErr) {
          console.warn('[ChatRoute] Non-fatal thread creation in interview:', threadErr);
        }
      }

      // Canonical Workspace Profile 조회 (business + brand)
      const profile = await getWorkspaceProfile({ workspaceId }).catch(() => ({ business: null, brand: null }));
      const businessName = profile.business?.business_name || '매장';
      const industry = profile.business?.industry || '';
      const location = profile.business?.location || '';
      const brandKeywords = profile.brand?.keywords || [];

      if (step === 'PURPOSE_SELECTED') {
        const assistantText = `사장님께서 선택해 주신 **[${purpose}]** 주제에 맞춰 소희가 이미지 스타일 기준을 구성했습니다! 🎨\n\n게시물에 함께 들어갈 **이미지 제작 방향과 스타일**을 선택해 주시면 즉시 준비하겠습니다:`;
        if (activeThreadId) {
          try {
            await ConversationRepository.saveMessage(workspaceId, activeThreadId, 'user', `[마케팅 목적 선택] ${purpose}`, { clientMessageId });
            await ConversationRepository.saveMessage(workspaceId, activeThreadId, 'sohee', assistantText);
          } catch (mErr) {
            console.warn('[ChatRoute] Non-fatal interview message persistence warning:', mErr);
          }
        }
        return NextResponse.json({
          role: 'assistant',
          threadId: activeThreadId,
          step: 'INTERVIEW_QUESTION',
          content: assistantText,
          interview: {
            stepIndex: 2,
            questionCategory: 'IMAGE_STYLE',
            question: '어떤 스타일의 이미지로 피드를 구성할까요?',
            options: [
              { id: 'opt_img_1', label: '1. 자연광 감성 스마트폰 실사 샷', description: '매장에서 자연광을 받아 찍은 듯한 내추럴하고 따뜻한 피드 감성', value: '자연광 감성 스마트폰 실사 샷' },
              { id: 'opt_img_2', label: '2. 대표 시그니처 디테일 포커스 샷', description: '원재료, 서비스 디테일, 제품 마감 등 전문성을 극대화하는 클로즈업 컷', value: '대표 시그니처 디테일 포커스 샷' },
              { id: 'opt_img_3', label: '3. 서비스 비포/애프터 비교 샷', description: '변화와 효과가 직관적으로 드러나는 비포애프터 컷', value: '서비스 비포/애프터 비교 샷' },
              { id: 'opt_img_4', label: '4. 고객 경험 & 서비스 진행 샷', description: '정성스러운 서비스와 고객 맞춤 프로세스를 담은 현장 컷', value: '고객 경험 & 서비스 진행 샷' },
              { id: 'opt_img_5', label: '5. 매장 공간 및 분위기 감성 샷', description: `${businessName}의 감각적인 인테리어와 편안한 매장 분위기`, value: '매장 공간 및 분위기 감성 샷' },
            ],
          },
        });
      }

      if (step === 'STYLE_SELECTED') {
        const assistantText = `스타일: **[${imageStyle}]** 선택 완료했습니다! 📸\n\n인스타그램 피드에 게시할 **이미지 제작 수량(장수)**을 선택해 주시면 바로 시안을 완성하겠습니다:`;
        if (activeThreadId) {
          try {
            await ConversationRepository.saveMessage(workspaceId, activeThreadId, 'user', `[스타일 선택] ${imageStyle}`, { clientMessageId });
            await ConversationRepository.saveMessage(workspaceId, activeThreadId, 'sohee', assistantText);
          } catch (mErr) {
            console.warn('[ChatRoute] Non-fatal interview message persistence warning:', mErr);
          }
        }
        return NextResponse.json({
          role: 'assistant',
          threadId: activeThreadId,
          step: 'INTERVIEW_QUESTION',
          content: assistantText,
          interview: {
            stepIndex: 3,
            questionCategory: 'IMAGE_COUNT',
            question: '이미지를 몇 장 제작할까요?',
            options: [
              { id: 'opt_cnt_1', label: '1. 대표 단일 컷 (1장)', description: '시선을 사로잡는 강력한 시그니처 대표 사진 1장', value: '1' },
              { id: 'opt_cnt_2', label: '2. 비포/애프터 비교 컷 (2장)', description: '변화 전과 완료 모습을 나란히 보여주는 2장 구성', value: '2' },
              { id: 'opt_cnt_3', label: '3. 스토리텔링 피드 팩 (3장)', description: '전경 컷 + 디테일 컷 + 서비스 과정 3장 구성', value: '3' },
              { id: 'opt_cnt_4', label: '4. 서비스 상세 과정 팩 (4장)', description: '상담 안내 ➔ 준비/진행 ➔ 완성 ➔ 사후 관리 안내 4장 구성', value: '4' },
              { id: 'opt_cnt_5', label: '5. 인스타 풀 캐러셀 팩 (5장)', description: '다양한 각도의 완성 컷과 매장 분위기까지 담은 5장 풀세트', value: '5' },
            ],
          },
        });
      }

      if (step === 'COUNT_SELECTED') {
        const locationNotice = location ? `\n\n📍 ${location} (${businessName})` : '';
        const cleanBizTag = businessName.replace(/[^a-zA-Z0-9가-힣_]/g, '');
        const cleanIndustryTag = industry.replace(/[^a-zA-Z0-9가-힣_]/g, '');
        const dynamicHashtags = [
          cleanBizTag ? `#${cleanBizTag}` : '#매장소식',
          ...(cleanIndustryTag ? [`#${cleanIndustryTag}`] : []),
          ...(brandKeywords.map((k: string) => `#${k.replace(/[^a-zA-Z0-9가-힣_]/g, '')}`).filter(Boolean)),
          '#소희AI'
        ];

        const generatedCaption = `${purpose} 안내 🌿\n\n${businessName}만의 맞춤형 서비스와 정성으로 특별한 경험을 선물해 드려요 ✨\n\n📌 프로필 상단 링크에서 실시간 예약 및 상세 안내를 확인해 보세요 😊${locationNotice}`;

        const cleanHandleBase = businessName.toLowerCase().replace(/[^a-z0-9_]/g, '') || 'official';

        // 1. Canonical DB Persistence (ANI-1023, ANI-1040): content_items + content_versions + work_items
        let canonicalContent: { contentId: string; versionId: string; fingerprint: string; status: string } | null = null;
        let workItemId: string | null = null;
        try {
          canonicalContent = await CanonicalContentLifecycleService.createContent({
            workspaceId,
            channel: 'instagram',
            title: `${businessName} ${purpose} 룩북`,
            caption: generatedCaption,
            hashtags: dynamicHashtags,
            mediaUrls: [],
            createdBy: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actor.actorId)
              ? actor.actorId
              : '00000000-0000-0000-0000-000000000000',
          });

          if (canonicalContent) {
            const effectiveActorId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actor.actorId)
              ? actor.actorId
              : '00000000-0000-0000-0000-000000000000';
            const workRes = await MarketingWorkService.ensureMarketingWorkItem({
              workspaceId,
              threadId: threadId || '00000000-0000-0000-0000-000000000000',
              messageId: clientMessageId,
              userPrompt: `${purpose} (${imageStyle}, ${imageCount}장)`,
              actorId: effectiveActorId,
            });
            workItemId = workRes.workItem.id;
            await MarketingWorkService.linkContentToWorkItem({
              workspaceId,
              workItemId,
              contentItemId: canonicalContent.contentId,
              status: 'review_required',
            });

            // Ensure and bind Marketing Mission (ANI-1192, ANI-1210, ANI-1211)
            try {
              const supabaseAdmin = createAdminSupabaseClient();
              const missionService = new MarketingMissionService(supabaseAdmin);
              const mission = await missionService.ensureMarketingMission({
                workspaceId,
                traceId: `trc-interview-${clientMessageId}`,
                goal: `${purpose} (${imageStyle})`,
                sourceMessageId: clientMessageId,
                targetChannel: 'instagram',
                actorType: 'user',
                actorId: effectiveActorId,
                strategySummary: `${businessName} ${purpose} 인스타그램 룩북`,
              });
              interviewMissionId = mission.id;
              await missionService.transitionMission({
                workspaceId,
                missionId: mission.id,
                traceId: `trc-interview-${clientMessageId}`,
                toStatus: 'PLANNING',
                actorType: 'agent',
              });
              await missionService.transitionMission({
                workspaceId,
                missionId: mission.id,
                traceId: `trc-interview-${clientMessageId}`,
                toStatus: 'PRODUCING',
                actorType: 'agent',
              });
              await missionService.transitionMission({
                workspaceId,
                missionId: mission.id,
                traceId: `trc-interview-${clientMessageId}`,
                toStatus: 'AWAITING_APPROVAL',
                actorType: 'agent',
                ownerActionRequired: true,
              });
              await missionService.bindContentAndApproval({
                workspaceId,
                missionId: mission.id,
                traceId: `trc-interview-${clientMessageId}`,
                contentItemId: canonicalContent.contentId,
                contentVersionId: canonicalContent.versionId,
              });
            } catch (mErr) {
              console.warn('[ChatRoute] Non-fatal mission binding error in interview:', mErr);
            }
          }
        } catch (persistErr) {
          console.error('[ChatRoute] Failed to persist canonical content or work item:', persistErr);
          return NextResponse.json({
            role: 'assistant',
            status: 'FAILED',
            errorCode: 'PERSISTENCE_FAILED',
            content: '⚠️ 초안과 작업 항목을 안전하게 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
          }, { status: 500 });
        }

        if (!canonicalContent || !canonicalContent.contentId || !canonicalContent.versionId || !canonicalContent.fingerprint) {
          return NextResponse.json({
            role: 'assistant',
            status: 'FAILED',
            errorCode: 'CANONICAL_IDENTITY_MISSING',
            content: '⚠️ 유효한 콘텐츠 식별자(contentId/versionId/fingerprint)가 누락되었습니다.',
          }, { status: 500 });
        }

        // 2. Concrete Production Generation Orchestration (ANI-1118)
        let visualImage: any = null;
        let mediaUrl = '';
        let persistedBundle: any = null;
        try {
          const supabaseClient = createAdminSupabaseClient();
          const orchestrator = createProductionGenerationOrchestrator({
            supabaseClient,
            workspaceId,
          });

          // 1. Authoritative learning image style query (only approved visual style with receipt)
          let learnedVisualContext: any = undefined;
          let learningEpoch = 1;
          const learningDependencies: Array<{ workspaceId: string; sourceId: string; revision: number }> = [];

          if (process.env.SOHEE_CHANNEL_LEARNING_ENABLED === '1') {
            try {
              const { data: rpcData, error: rpcError } = await (supabaseClient as any).rpc('get_approved_learning_context', {
                p_workspace_id: workspaceId,
                p_purpose: 'image',
                p_max_facts: 32,
                p_query: '',
              });
              if (!rpcError && rpcData) {
                const items = Array.isArray(rpcData.items) ? rpcData.items : Array.isArray(rpcData) ? rpcData : [];
                learningEpoch = Number(rpcData.epoch ?? items[0]?.epoch ?? 1);
                const visualItem = items.find((item: any) => item.category === 'visual' && item.content);
                if (visualItem) {
                  // Flatten all leaf dependencies
                  const rawDeps = visualItem.dependencies;
                  if (Array.isArray(rawDeps) && rawDeps.length > 0) {
                    for (const dep of rawDeps) {
                      const sId = dep.sourceId || dep.source_id || dep.id;
                      if (sId) {
                        learningDependencies.push({
                          workspaceId: dep.workspaceId || dep.workspace_id || workspaceId,
                          sourceId: String(sId),
                          revision: Number(dep.revision || dep.source_revision || 1),
                        });
                      }
                    }
                  } else if (visualItem.source_id) {
                    learningDependencies.push({
                      workspaceId,
                      sourceId: String(visualItem.source_id),
                      revision: Number(visualItem.source_revision ?? 1),
                    });
                  }
                  learnedVisualContext = {
                    imageStyle: String(visualItem.content),
                    dependencies: learningDependencies,
                    epoch: learningEpoch,
                  };
                }
              }
            } catch {
              // safe fallback
            }
          }

          const visualBrief = buildVisualBrief({
            workspaceId,
            contentVersionId: canonicalContent.versionId,
            businessContext: {
              name: businessName,
              industry: resolveIndustryDomain(industry),
              keywords: brandKeywords,
              targetAudience: '일반 고객 및 단골 이웃',
              location,
            },
            productContext: {
              name: purpose,
              sellingPoints: brandKeywords.length > 0 ? brandKeywords : ['맞춤형 케어'],
            },
            channel: 'instagram',
            caption: generatedCaption,
            learnedVisualContext,
          });

          const idempotencyKey = `chat-gen-${workspaceId}-${clientMessageId}`;
          const genResult = await orchestrator.execute({
            idempotencyKey,
            requestFingerprint: visualBrief.promptDigest,
            sequenceNumber: 1,
            workspaceId,
            contentVersionId: canonicalContent.versionId,
            visualBrief,
          });

          if (genResult.status !== 'READY' || !genResult.mediaAsset) {
            throw new Error(genResult.error?.message || 'Generation failed to reach READY status');
          }

          // 2. Post-generation gate check: verify that channel sources were not revoked during generation
          if (learningDependencies.length > 0) {
            const { createSupabaseConsumerGate, validateLearningResult } = await import('@/features/channel-learning/consumer-gate');
            const consumerGate = createSupabaseConsumerGate(supabaseClient, 'image');
            const valid = await validateLearningResult(
              {
                workspaceId,
                epoch: learningEpoch,
                dependencies: learningDependencies,
                purpose: 'image',
              },
              consumerGate,
            );
            if (!valid) {
              const asset = genResult.mediaAsset;
              // Clean up freshly generated asset scoped strictly to current workspace.
              // Never delete replays, external SNS original assets, or assets belonging to other workspaces.
              if (
                !genResult.isReplay &&
                asset &&
                asset.workspace_id === workspaceId &&
                asset.source_type === 'GENERATED_OPENAI'
              ) {
                const { cleanupQuarantineQuickImage } = await import('@/features/channel-studio/image-option');
                const cleanupResult = await cleanupQuarantineQuickImage({
                  admin: supabaseClient,
                  workspaceId,
                  assetId: asset.id,
                  objectPath: asset.object_path,
                  isReplay: genResult.isReplay,
                  sourceType: asset.source_type,
                });
                if (!cleanupResult.success) {
                  console.error('[ChatRoute] Post-generation revocation cleanup could not guarantee safety:', {
                    assetId: asset.id,
                    workspaceId,
                    cleanupResult,
                  });
                }
              }
              throw new Error('LEARNING_SOURCE_REVOKED');
            }
          }

          // Generate signed URL for safe private storage delivery
          mediaUrl = `/api/workspaces/${workspaceId}/media/${genResult.mediaAsset.id}`;
          try {
            const { data: signedData } = await supabaseClient.storage
              .from('content-media')
              .createSignedUrl(genResult.mediaAsset.object_path, 3600);
            if (signedData?.signedUrl) {
              mediaUrl = signedData.signedUrl;
            }
          } catch (signErr) {
            console.warn('[ChatRoute] Signed URL creation fallback to internal media endpoint:', signErr);
          }

          visualImage = {
            assetId: genResult.mediaAsset.id,
            url: mediaUrl,
            prompt: visualBrief.promptText,
            style: imageStyle,
            dimensions: `${genResult.mediaAsset.width}x${genResult.mediaAsset.height}`,
            modelId: (genResult.mediaAsset.generation_metadata as any)?.model || 'gpt-image-2',
            costSC: 150,
            provenanceId: genResult.runId,
            createdAt: genResult.mediaAsset.created_at,
            status: 'VERIFIED_READY',
          };

          // 3. Persist CreativeBundle & Ordered Media Lineage (ANI-1129)
          try {
            const bundleStore = new SupabaseCreativeBundleStore(supabaseClient);
            persistedBundle = await bundleStore.persistBundle({
              workspaceId,
              contentId: canonicalContent.contentId,
              versionId: canonicalContent.versionId,
              channel: 'instagram',
              caption: generatedCaption,
              hashtags: dynamicHashtags,
              orderedMedia: [
                {
                  mediaAssetId: genResult.mediaAsset.id,
                  sha256Digest: genResult.mediaAsset.sha256_digest,
                  position: 0,
                  role: 'primary',
                },
              ],
              creativeBriefVersion: visualBrief.briefVersion,
            });
            console.log('[ChatRoute] Persisted canonical CreativeBundle:', persistedBundle.bundleId, persistedBundle.bundleFingerprint);
          } catch (bundleErr) {
            console.error('[ChatRoute] Failed to persist creative bundle:', bundleErr);
          }
        } catch (genErr: any) {
          console.error('[ChatRoute] Production generation failed:', genErr);
          return NextResponse.json({
            role: 'assistant',
            status: 'FAILED',
            errorCode: genErr?.code || 'GENERATION_FAILED',
            content: '⚠️ 고품질 시안 이미지 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.',
          }, { status: 500 });
        }

        const assistantPreviewText = `사장님께서 선택해 주신 **[${purpose}]** + **[${imageStyle}]** 콘셉트를 반영하여 **실제 인스타그램 피드 룩북** 제작을 완료했습니다! 📸\n\n하단의 피드 화면을 검토해 주시고, **[실제 공식 채널에 즉시 게시하기]**를 눌러주시면 라이브 배포를 진행합니다!`;
        if (activeThreadId) {
          try {
            await ConversationRepository.saveMessage(workspaceId, activeThreadId, 'user', `[제작 수량 선택] ${imageCount}장`, { clientMessageId });
            await ConversationRepository.saveMessage(workspaceId, activeThreadId, 'sohee', assistantPreviewText, {
              actionGraph: {
                contentId: canonicalContent.contentId,
                versionId: canonicalContent.versionId,
                bundleId: persistedBundle?.bundleId,
                workItemId,
                mediaUrl,
              }
            });
          } catch (mErr) {
            console.warn('[ChatRoute] Non-fatal preview turn message persistence warning:', mErr);
          }
        }

        return NextResponse.json({
          role: 'assistant',
          threadId: activeThreadId,
          step: 'CONTENT_PREVIEW',
          content: assistantPreviewText,
          contentId: canonicalContent.contentId,
          versionId: canonicalContent.versionId,
          versionNumber: 1,
          fingerprint: canonicalContent.fingerprint,
          bundleId: persistedBundle?.bundleId,
          bundleFingerprint: persistedBundle?.bundleFingerprint,
          workItemId,
          missionId: interviewMissionId,
          preview: {
            channel: 'INSTAGRAM',
            profileName: `${businessName}${industry ? ` | ${industry}` : ''}`,
            accountHandle: `@${cleanHandleBase}`,
            images: [mediaUrl],
            caption: generatedCaption,
            hashtags: dynamicHashtags,
            contentId: canonicalContent.contentId,
            versionId: canonicalContent.versionId,
            versionNumber: 1,
            fingerprint: canonicalContent.fingerprint,
            bundleId: persistedBundle?.bundleId,
            bundleFingerprint: persistedBundle?.bundleFingerprint,
            workItemId,
          },
          visualImage,
          creditDeduction: isTestAccount ? {
            textTokens: 320,
            textSC: 0,
            imageUnits: 1,
            imageSC: 0,
            totalDeductedSC: 0,
            reason: '테스트 계정 (크레딧 무제한)'
          } : {
            textTokens: 320,
            textSC: 1,
            imageUnits: 1,
            imageSC: 150,
            totalDeductedSC: 151,
            reason: '대화형 인터뷰 완료 + GPT-Image-2 룩북 이미지 생성'
          }
        });
      }
    }

    // 2. Canonical Agent Orchestrator Turn Execution (ANI-651, ANI-918, ANI-1029)
    // Pipeline: Turn Intake ➔ Memory ➔ Plan ➔ ActionWorker ➔ MCP ➔ ConversationBrain ➔ Durable DB
    const acceptHeader = request.headers.get('accept') || '';
    const wantsEventStream = acceptHeader.includes('text/event-stream');

    if (wantsEventStream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          let isClosed = false;
          let keepaliveTimer: NodeJS.Timeout | null = null;

          const safeEnqueue = (text: string) => {
            if (isClosed) return;
            try {
              controller.enqueue(encoder.encode(text));
            } catch {
              isClosed = true;
            }
          };

          const sendEvent = (event: string, data: any) => {
            safeEnqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          };

          keepaliveTimer = setInterval(() => {
            safeEnqueue(': keepalive\n\n');
          }, 15000);

          try {
            const orchestratorResult = await AgentOrchestrator.executeTurn({
              workspaceId,
              ...planContext,
              sessionId,
              threadId,
              clientMessageId,
              userId: actor.actorId,
              surfaceContext,
              userMessage: currentTurnText,
              conversationHistory: messages,
              isTestAccount,
              onRunCreated: (runId, thId) => {
                sendEvent('run', { runId, ...(thId ? { threadId: thId } : {}) });
              },
              onActivity: (stored) => {
                const event = projectActivityEvent(stored);
                if (event && event.workspace_id === workspaceId) {
                  safeEnqueue(`id: ${event.sequence}\nevent: activity\ndata: ${JSON.stringify(event)}\n\n`);
                }
              },
              onProgress: (prog) => {
                const publicProgress = projectPublicAgentProgress(prog);
                if (publicProgress) sendEvent('progress', publicProgress);
              },
            });

            const resultPayload = buildChatResultPayload(orchestratorResult);

            sendEvent('result', resultPayload);
          } catch (turnErr) {
            console.error('[ChatRoute Stream] Orchestrator error:', redactErrorPayload(turnErr));
            if (turnErr instanceof ConversationTurnConflict) {
              sendEvent('error', turnConflictPayload(turnErr));
            } else if (turnErr && typeof turnErr === 'object' && 'code' in turnErr && (turnErr as { code?: unknown }).code === '42501') {
              // 기존 JSON 경로와 동일: DB 권한 오류만 첫 응답 안내로 대체한다.
              const fallback = await answerFirstTurn({ answer: async () => { throw turnErr; } });
              sendEvent('result', { role: 'assistant', reply: fallback.content, ...fallback, actions: [] });
            } else {
            sendEvent('error', {
              message: '일시적인 시스템 오류로 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.'
            });
            }
          } finally {
            if (keepaliveTimer) clearInterval(keepaliveTimer);
            if (!isClosed) {
              try {
                controller.close();
              } catch {
                // ignore
              }
            }
          }
        }
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store, no-transform',
          'X-Accel-Buffering': 'no',
        }
      });
    }

    let orchestratorResult;
    try {
      orchestratorResult = await AgentOrchestrator.executeTurn({
        workspaceId, ...planContext, sessionId, threadId, clientMessageId, userId: actor.actorId,
        surfaceContext, userMessage: currentTurnText, conversationHistory: messages, isTestAccount
      });
    } catch (err) {
      // Only the explicitly handled DB permission failure uses the first-reply guidance.
      // Provider/runtime failures must reach the outer 500 handler, not masquerade as success.
      if (err && typeof err === 'object' && 'code' in err && err.code === '42501') {
        console.error('[ChatRoute] Turn failed:', redactErrorPayload(err));
        const fallback = await answerFirstTurn({ answer: async () => { throw err; } });
        return NextResponse.json({ role: 'assistant', reply: fallback.content, ...fallback, actions: [] }, {
          headers: { 'Cache-Control': 'no-store' }
        });
      }
      throw err;
    }

    return NextResponse.json(buildChatResultPayload(orchestratorResult), {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache'
      }
    });

  } catch (err: unknown) {
    const authResponse = handleWorkspaceActorError(err);
    if (authResponse) return authResponse;

    if (err instanceof ConversationTurnConflict) {
      return NextResponse.json(turnConflictPayload(err), { status: 409, headers: { 'Cache-Control': 'no-store' } });
    }
    const sanitizedError = redactErrorPayload(err);
    console.error('Sohee Agent Chat Error:', sanitizedError);
    return NextResponse.json({
      role: 'assistant',
      step: 'ERROR',
      status: 'FAILED',
      errorCode: 'AGENT_CHAT_TURN_FAILED',
      content: '⚠️ 일시적인 시스템 오류로 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      error: sanitizedError,
      creditDeduction: {
        textTokens: 0,
        textSC: 0,
        imageUnits: 0,
        imageSC: 0,
        totalDeductedSC: 0,
        reason: '실행 실패로 크레딧 미차감'
      }
    }, {
      status: 500,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache'
      }
    });
  }
}

// GET endpoint to retrieve threads or thread messages
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  try {
    await verifyWorkspaceActor(request, workspaceId);
  } catch (err: unknown) {
    const authResponse = handleWorkspaceActorError(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ success: false, error: 'FORBIDDEN' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const threadId = searchParams.get('threadId');

  if (searchParams.has('clientMessageId')) {
    const clientMessageId = searchParams.get('clientMessageId');
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const headers = { 'Cache-Control': 'private, no-store' };
    if ((threadId !== null && !uuid.test(threadId)) || !clientMessageId || !uuid.test(clientMessageId)) {
      return NextResponse.json({ success: false, errorCode: 'TURN_RECOVERY_REQUEST_INVALID' }, { status: 400, headers });
    }
    const result = await ConversationRepository.getTurnRecoveryResult(workspaceId, threadId, clientMessageId);
    if (result.state === 'ERROR') {
      return NextResponse.json({ success: false, errorCode: result.errorCode, readResult: result }, { status: 503, headers });
    }
    // EMPTY is not permission to retry POST: the original request may still be saving its run.
    return NextResponse.json({ success: true, recovery: result.data, readResult: result }, { headers });
  }

  if (threadId) {
    const result = await ConversationRepository.getThreadMessagesResult(workspaceId, threadId);
    if (result.state === 'ERROR') {
      return NextResponse.json({
        success: false,
        error: result.message,
        errorCode: result.errorCode,
        readResult: result,
      }, { status: 500 });
    }
    return NextResponse.json({ 
      success: true, 
      messages: result.data,
      readResult: result 
    });
  }

  const result = await ConversationRepository.getThreadsResult(workspaceId);
  if (result.state === 'ERROR') {
    return NextResponse.json({
      success: false,
      error: result.message,
      errorCode: result.errorCode,
      readResult: result,
    }, { status: 500 });
  }
  return NextResponse.json({ 
    success: true, 
    threads: result.data,
    readResult: result 
  });
}
