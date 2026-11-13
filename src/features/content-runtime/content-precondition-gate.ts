import { PublishingChannel } from './types';

export interface PreconditionCheckParams {
  workspaceId: string;
  isHarnessReady: boolean;
  connectedChannels: PublishingChannel[];
  availableCredits: number;
  requiredCredits: number;
}

export interface PreconditionEvaluationResult {
  canProceed: boolean;
  isHarnessReady: boolean;
  hasConnectedChannel: boolean;
  hasSufficientCredits: boolean;
  blockedReasons: string[];
  primaryCta: {
    label: string;
    targetUrl: string;
    isDisabled: boolean;
  };
}

export class ContentCtaPreconditionGate {
  /**
   * 콘텐츠 생성 및 실행 전 3대 선행조건 엄격 평가 (ANI-830)
   */
  evaluate(params: PreconditionCheckParams): PreconditionEvaluationResult {
    const {
      isHarnessReady,
      connectedChannels,
      availableCredits,
      requiredCredits,
    } = params;

    const hasConnectedChannel = connectedChannels.length > 0;
    const hasSufficientCredits = availableCredits >= requiredCredits;
    const blockedReasons: string[] = [];

    // 1. 하네스 준비 검사
    if (!isHarnessReady) {
      blockedReasons.push('가게 말투와 어떤 손님에게 알릴지 먼저 정해 주세요.');
    }

    // 2. 채널 연동 검사
    if (!hasConnectedChannel) {
      blockedReasons.push('글을 올릴 계정을 하나 이상 연결해 주세요.');
    }

    // 3. 소희 크레딧 검사
    if (!hasSufficientCredits) {
      blockedReasons.push(
        '현재 이용 한도에 도달했어요. 이용 안내를 확인해 주세요.'
      );
    }

    const canProceed = blockedReasons.length === 0;

    // 우선순위에 따른 단일 Primary CTA 결정
    let primaryCta = {
      label: '홍보 글 만들기',
      targetUrl: '/app/content-hub/create',
      isDisabled: false,
    };

    if (!isHarnessReady) {
      primaryCta = {
        label: '가게 말투 설정하기',
        targetUrl: '/app/brand-voice',
        isDisabled: false,
      };
    } else if (!hasConnectedChannel) {
      primaryCta = {
        label: '게시할 계정 연결하기',
        targetUrl: '/app/channels',
        isDisabled: false,
      };
    } else if (!hasSufficientCredits) {
      primaryCta = {
        label: '이용 한도 확인하기',
        targetUrl: '/app/account/credits',
        isDisabled: false,
      };
    }

    return {
      canProceed,
      isHarnessReady,
      hasConnectedChannel,
      hasSufficientCredits,
      blockedReasons,
      primaryCta,
    };
  }
}
