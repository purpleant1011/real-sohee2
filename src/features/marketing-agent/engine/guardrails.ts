import { AutonomyPolicy, ChannelKey } from "../types";
import { ActionStatus } from "@/lib/read-models/types";

export const DEFAULT_AUTONOMY_POLICY: AutonomyPolicy = {
  workspaceId: "ws-default",
  globalKillSwitchActive: false,
  channelKillSwitches: {
    instagram: false,
    threads: false,
    naver_blog: false,
    naver_place: false,
    daangn: false,
    kakaotalk_channel: false,
    google_business: false,
  },
  maxAutoMessagesPerDay: 20,
  maxAdSpendPerMonth: 0,
  recontactCooldownDays: 7,
  requireApprovalForExternalSend: true,
  requireApprovalForPublish: true,
  prohibitedKeywords: ["100% 보장", "부작용 전무", "파격 무료 이벤트", "의료 시술"],
  safeHoursOnly: true,
};

export interface WorkspacePolicyState {
  workspaceId: string;
  workspaceKillSwitch: boolean;
  killSwitchReason?: string;
  dailySpendCap: number;
  dailySendCap: number;
  currentDaySpend: number;
  currentDaySends: number;
  quietHoursEnabled: boolean;
  quietHoursStart: string; // e.g. "21:00"
  quietHoursEnd: string;   // e.g. "09:00"
  cooldownMinutes: number;
}

const policyStore = new Map<string, WorkspacePolicyState>();

export function getGuardrailPolicyState(workspaceId: string): WorkspacePolicyState {
  if (!policyStore.has(workspaceId)) {
    policyStore.set(workspaceId, {
      workspaceId,
      workspaceKillSwitch: false,
      dailySpendCap: 50000,
      dailySendCap: 100,
      currentDaySpend: 0,
      currentDaySends: 0,
      quietHoursEnabled: true,
      quietHoursStart: "21:00",
      quietHoursEnd: "09:00",
      cooldownMinutes: 1440,
    });
  }
  return policyStore.get(workspaceId)!;
}

export function setWorkspaceKillSwitch(params: {
  workspaceId: string;
  active: boolean;
  reason?: string;
}): void {
  const current = getGuardrailPolicyState(params.workspaceId);
  current.workspaceKillSwitch = params.active;
  current.killSwitchReason = params.reason;
}

export function resetDailyCounters(workspaceId: string): void {
  const current = getGuardrailPolicyState(workspaceId);
  current.currentDaySpend = 0;
  current.currentDaySends = 0;
}

export interface EnforcePolicyParams {
  workspaceId: string;
  channel: string;
  cost?: number;
  targetTime?: string; // ISO string
  policyState?: WorkspacePolicyState;
}

export interface PolicyEnforcementResult {
  allowed: boolean;
  status: ActionStatus;
  blockReason?: string;
}

function getKstHoursAndMinutes(date: Date): { hours: number; minutes: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  let hours = 0;
  let minutes = 0;
  for (const part of parts) {
    if (part.type === 'hour') hours = parseInt(part.value, 10);
    if (part.type === 'minute') minutes = parseInt(part.value, 10);
  }
  if (hours === 24) hours = 0;
  return { hours, minutes };
}

export function enforceActionPolicy(params: EnforcePolicyParams): PolicyEnforcementResult {
  const policy = params.policyState ?? getGuardrailPolicyState(params.workspaceId);

  // 1. Kill Switch Check
  if (policy.workspaceKillSwitch) {
    return {
      allowed: false,
      status: "blocked_by_policy",
      blockReason: `워크스페이스 비상 킬스위치 가동 중: ${policy.killSwitchReason || "외부 행동 전면 차단"}`,
    };
  }

  // 2. Spend Cap Check
  const actionCost = params.cost ?? 0;
  if (policy.currentDaySpend + actionCost > policy.dailySpendCap) {
    return {
      allowed: false,
      status: "blocked_by_policy",
      blockReason: `일일 지출 한도 초과 (현재: ${policy.currentDaySpend}원 / 한도: ${policy.dailySpendCap}원)`,
    };
  }

  // 3. Quiet Hours Check
  if (policy.quietHoursEnabled) {
    const targetDate = params.targetTime ? new Date(params.targetTime) : new Date();
    const { hours, minutes } = getKstHoursAndMinutes(targetDate);
    const currentTimeMinutes = hours * 60 + minutes;

    const [startH, startM] = policy.quietHoursStart.split(":").map(Number);
    const [endH, endM] = policy.quietHoursEnd.split(":").map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    const isQuietTime = startMinutes > endMinutes
      ? (currentTimeMinutes >= startMinutes || currentTimeMinutes < endMinutes)
      : (currentTimeMinutes >= startMinutes && currentTimeMinutes < endMinutes);

    if (isQuietTime) {
      return {
        allowed: false,
        status: "blocked_by_policy",
        blockReason: `방해금지 시간(야간 ${policy.quietHoursStart} ~ ${policy.quietHoursEnd}) 고객 수신 보호`,
      };
    }
  }

  // Record safe expenditure/send
  policy.currentDaySpend += actionCost;
  policy.currentDaySends += 1;

  return {
    allowed: true,
    status: "approved",
  };
}

export interface GuardrailCheckResult {
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
  idempotencyKey: string;
}

export function checkActionGuardrails(
  policy: AutonomyPolicy,
  actionType: "send_message" | "publish_post" | "reply_review" | "spend_budget",
  channelKey: ChannelKey,
  targetIdentifier: string,
  now: Date = new Date()
): GuardrailCheckResult {
  const dateStr = now.toISOString().split("T")[0];
  const idempotencyKey = "idemp:" + policy.workspaceId + ":" + channelKey + ":" + actionType + ":" + targetIdentifier + ":" + dateStr;

  if (policy.globalKillSwitchActive) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: "전역 킬 스위치(Global Kill Switch)가 활성화되어 모든 외부 행동이 차단되었습니다.",
      idempotencyKey,
    };
  }

  if (policy.channelKillSwitches[channelKey]) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: channelKey + " 채널이 비상 중단(Kill Switch) 상태입니다.",
      idempotencyKey,
    };
  }

  if (policy.safeHoursOnly && (actionType === "send_message" || actionType === "publish_post")) {
    const kstHour = (now.getUTCHours() + 9) % 24;
    if (kstHour < 9 || kstHour >= 21) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: "심야 시간(21:00 ~ 09:00) 고객 피로도 보호를 위해 외부 메시지 발송이 제한됩니다.",
        idempotencyKey,
      };
    }
  }

  if (actionType === "send_message" && policy.requireApprovalForExternalSend) {
    return {
      allowed: true,
      requiresApproval: true,
      reason: "외부 고객 직접 메시지 발송은 사장님 사전 승인이 필요합니다.",
      idempotencyKey,
    };
  }

  if (actionType === "publish_post" && policy.requireApprovalForPublish) {
    return {
      allowed: true,
      requiresApproval: true,
      reason: "공개 피드 포스팅은 사장님 사전 승인이 필요합니다.",
      idempotencyKey,
    };
  }

  return {
    allowed: true,
    requiresApproval: false,
    idempotencyKey,
  };
}
