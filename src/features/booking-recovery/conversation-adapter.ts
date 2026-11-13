import { RecoveryActor, RecoveryView } from './contracts';
import { BookingRecoveryService } from './service';

export const RECOVERY_MODEL_TOOL_NAMES = [
  'recovery.list',
  'recovery.open',
  'recovery.prepare',
  'recovery.get',
  'recovery.request_send_approval',
  'recovery.request_booking_approval',
] as const;

export type RecoveryModelToolName = (typeof RECOVERY_MODEL_TOOL_NAMES)[number];

export interface RecoveryConversationInput {
  actor: RecoveryActor;
  message?: string;
  caseId?: string;
  sourceInboundMessageId?: string;
  slotId?: string;
}

export type RecoveryConversationResult =
  | {
      type: 'recovery.updated';
      caseId: string;
      missionId: string;
      version: number;
      view: RecoveryView;
    }
  | {
      type: 'recovery.selection';
      cases: RecoveryView[];
      message?: string;
    }
  | {
      type: 'recovery.empty';
      message: string;
    }
  | {
      type: 'recovery.error';
      code: string;
      message: string;
    };

export interface RecoveryConversationDeps {
  service: BookingRecoveryService;
  approve?: (...args: any[]) => any;
}

/**
 * Checks whether user message is an intent for booking recovery,
 * strictly distinguishing it from marketing content/image generation requests.
 */
export function isRecoveryIntent(message: string): boolean {
  if (!message || typeof message !== 'string') return false;
  const normalized = message.trim();

  // Content/image creation requests should NEVER be hijacked by recovery
  const contentKeywords = [
    '글 써줘',
    '원고',
    '피드',
    '블로그',
    '카드뉴스',
    '스레드',
    '포스팅',
    '게시물',
    '인스타 글',
    '인스타그램 글',
    '이미지',
    '사진',
    '그림',
    '만들어줘',
    '작성해줘',
  ];

  for (const kw of contentKeywords) {
    if (normalized.includes(kw)) {
      return false;
    }
  }

  // Recovery-specific keywords
  const recoveryKeywords = [
    '미응답',
    '미결제',
    '예약 문의',
    '예약문의',
    '문의 챙겨',
    '문의 확인',
    '문의 온 거',
    '이 문의',
    'DM 문의',
    '디엠 문의',
    '답변 보내',
    '답변 작성',
    '예약 확정',
    '예약 진행',
    '예약 수락',
    '고객 문의',
  ];

  for (const kw of recoveryKeywords) {
    if (normalized.includes(kw)) {
      return true;
    }
  }

  return false;
}

/**
 * Handles recovery conversation safely without executing unauthorized mutations.
 * Natural language '예약해줘' or '확정해줘' will NEVER invoke approval/execution.
 */
export async function handleRecoveryConversation(
  input: RecoveryConversationInput,
  deps: RecoveryConversationDeps
): Promise<RecoveryConversationResult> {
  const { actor, message, caseId, sourceInboundMessageId } = input;
  const { service } = deps;

  // 1. Direct case ID lookup
  if (caseId) {
    const view = await service.getCaseView(actor.workspaceId, caseId);
    if (!view) {
      return {
        type: 'recovery.error',
        code: 'NOT_FOUND',
        message: '해당 예약 문의를 찾을 수 없습니다.',
      };
    }

    return {
      type: 'recovery.updated',
      caseId: view.caseId,
      missionId: view.missionId,
      version: view.version,
      view,
    };
  }

  // 2. Open case from inbound message ID
  if (sourceInboundMessageId) {
    const openRes = await service.openCase(actor, sourceInboundMessageId);
    if (!openRes.ok) {
      return {
        type: 'recovery.error',
        code: openRes.code,
        message: openRes.message,
      };
    }

    return {
      type: 'recovery.updated',
      caseId: openRes.value.caseId,
      missionId: openRes.value.missionId,
      version: openRes.value.version,
      view: openRes.value,
    };
  }

  // 3. Ambiguous natural language without specific case reference -> List cases
  const cases = await service.listCaseViews(actor.workspaceId, 10);
  if (cases.length === 0) {
    return {
      type: 'recovery.empty',
      message: '현재 처리 대기 중인 예약 문의가 없습니다.',
    };
  }

  // If there are multiple cases, prompt owner with selection card
  return {
    type: 'recovery.selection',
    cases,
    message: '처리하실 예약 문의를 선택해 주세요.',
  };
}

/**
 * Exposes ONLY read/prepare/proposal request tools to LLM.
 * Direct approve/send/confirm execution tools are strictly omitted.
 */
export function getRecoveryModelTools(): Array<{
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}> {
  return [
    {
      type: 'function',
      function: {
        name: 'recovery.list',
        description: '처리 대기 중인 고객 예약 문의 목록을 조회합니다.',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: '조회할 최대 케이스 수' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'recovery.get',
        description: '특정 예약 회수 케이스의 최신 상태 및 제안 조건을 조회합니다.',
        parameters: {
          type: 'object',
          properties: {
            caseId: { type: 'string', description: '조회할 케이스 UUID' },
          },
          required: ['caseId'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'recovery.open',
        description: '고객의 수신 DM 문의로부터 예약 회수 케이스를 열거나 기존 케이스를 반환합니다.',
        parameters: {
          type: 'object',
          properties: {
            sourceInboundMessageId: { type: 'string', description: '수신 고객 메시지 UUID' },
          },
          required: ['sourceInboundMessageId'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'recovery.prepare',
        description: '확인된 서비스 및 가용 시간을 바탕으로 고객 답변 제안 초안을 생성합니다.',
        parameters: {
          type: 'object',
          properties: {
            caseId: { type: 'string', description: '대상 케이스 UUID' },
            expectedVersion: { type: 'number', description: '현재 케이스 버전' },
            slotId: { type: 'string', description: '배정할 가용 예약 슬롯 UUID' },
          },
          required: ['caseId', 'expectedVersion'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'recovery.request_send_approval',
        description: '작성된 답변 초안을 사장님께 보여주고 전송 승인 카드를 띄웁니다. (직접 발송하지 않음)',
        parameters: {
          type: 'object',
          properties: {
            caseId: { type: 'string', description: '대상 케이스 UUID' },
          },
          required: ['caseId'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'recovery.request_booking_approval',
        description: '고객의 수락이 확인된 제안에 대해 사장님께 최종 예약 확정 승인 카드를 띄웁니다. (직접 확정하지 않음)',
        parameters: {
          type: 'object',
          properties: {
            caseId: { type: 'string', description: '대상 케이스 UUID' },
          },
          required: ['caseId'],
        },
      },
    },
  ];
}
