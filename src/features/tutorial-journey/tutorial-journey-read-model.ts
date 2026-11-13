import type { SoheeReadinessSnapshot, SoheeReadinessFactKey } from '@/features/sohee-ready/types'

export type TutorialJourneyStage =
  | 'FIRST_MEETING'      // 1/5: 첫 만남 & 소희에게 바라는 점 이야기
  | 'BUSINESS_LEARNING' // 1/5: 사업장 지식 학습 및 사업자 확인
  | 'CHANNELS_SETUP'    // 2/5: 인스타그램/스레드 공식 연동
  | 'TEXT_CALIBRATION'  // 3/5: 문장 스타일 및 톤앤매너 캘리브레이션
  | 'IMAGE_CALIBRATION' // 4/5: 비주얼 스타일 및 이미지 캘리브레이션
  | 'FIRST_POST_PREP'   // 5/5: 운영 정책 및 첫 게시물 원고 확인
  | 'FIRST_POST_DONE';  // 완료: 첫 실게시 및 사후 검증 완료

export interface TutorialJourneyAction {
  label: string
  href: string
  description: string
}

export interface TutorialJourneyGuidance {
  acknowledgement: string
  nextQuestion?: string
  quickReplies?: string[]
  stateExplanation?: string
}

export interface TutorialJourneyProgress {
  workspaceId: string
  currentStage: TutorialJourneyStage
  stepIndex: number // 1 ~ 5
  totalSteps: number // 5
  isCompleted: boolean
  stageLabel: string
  stageDescription: string
  readinessCount: number // 0 ~ 7
  totalReadinessFacts: number // 7
  soheeReadiness: SoheeReadinessSnapshot
  blockingReason?: string
  primaryAction: TutorialJourneyAction
  optionalParallelActions: TutorialJourneyAction[]
  soheeGuidance: TutorialJourneyGuidance
}

export interface TutorialJourneyComputeOptions {
  isFirstPostPublished?: boolean
  hasWelcomeInteraction?: boolean
}

/**
 * [ANI-1443] Canonical Tutorial Journey Read Model
 *
 * Maps canonical 7 SOHEE_READY facts into owner-friendly 5-step growth tutorial.
 * Pure function with deterministic output across all routes, shells, and docks.
 */
export function computeTutorialJourneyProgress(
  snapshot: SoheeReadinessSnapshot,
  options?: TutorialJourneyComputeOptions
): TutorialJourneyProgress {
  const isFactDone = (key: SoheeReadinessFactKey) => Boolean(snapshot.facts?.[key]?.verified)

  const bizDone = isFactDone('BUSINESS_VERIFIED')
  const igDone = isFactDone('INSTAGRAM_VERIFIED')
  const thDone = isFactDone('THREADS_VERIFIED')
  const knowDone = isFactDone('BUSINESS_KNOWLEDGE_CONFIRMED')
  const textDone = isFactDone('TEXT_HARNESS_CONFIRMED')
  const imgDone = isFactDone('IMAGE_HARNESS_CONFIRMED')
  const polDone = isFactDone('OPERATING_POLICY_CONFIRMED')

  const verifiedFactsCount = [
    bizDone,
    igDone,
    thDone,
    knowDone,
    textDone,
    imgDone,
    polDone,
  ].filter(Boolean).length

  // 1. If first post has already been published & verified
  if (options?.isFirstPostPublished) {
    return {
      workspaceId: snapshot.workspaceId,
      currentStage: 'FIRST_POST_DONE',
      stepIndex: 5,
      totalSteps: 5,
      isCompleted: true,
      stageLabel: '첫 게시물 발행 완료',
      stageDescription: '인스타그램과 스레드에 소희의 첫 게시물이 성공적으로 발행되고 검증되었습니다.',
      readinessCount: 7,
      totalReadinessFacts: 7,
      soheeReadiness: snapshot,
      primaryAction: {
        label: '소희와 다음 마케팅 시작하기',
        href: '/app',
        description: '메인 업무 보드로 이동하여 일상 마케팅을 이어갑니다.',
      },
      optionalParallelActions: [],
      soheeGuidance: {
        acknowledgement: '사장님, 첫 게시물이 성공적으로 발행되었어요! 앞으로도 사장님 스타일에 꼭 맞게 일할게요.',
        stateExplanation: '첫 게시물 검증 완료 (FIRST_POST_DONE)',
      },
    }
  }

  // 2. Stage 1: First Meeting or Business Learning
  if (!knowDone) {
    if (options?.hasWelcomeInteraction === false && verifiedFactsCount === 0) {
      return {
        workspaceId: snapshot.workspaceId,
        currentStage: 'FIRST_MEETING',
        stepIndex: 1,
        totalSteps: 5,
        isCompleted: false,
        stageLabel: '소희와의 첫 만남',
        stageDescription: '사장님의 마케팅 직원 소희에게 바라는 역할과 말투를 알려주세요.',
        readinessCount: verifiedFactsCount,
        totalReadinessFacts: 7,
        soheeReadiness: snapshot,
        primaryAction: {
          label: '소희와 첫인사 나누기',
          href: '/start',
          description: '소희에게 바라는 업무와 선호하는 분위기를 대화로 들려주세요.',
        },
        optionalParallelActions: [
          {
            label: '사업자등록 진위확인',
            href: '/start',
            description: '국세청 사업자 진위를 확인합니다.',
          },
        ],
        soheeGuidance: {
          acknowledgement: '사장님, 만나서 반갑습니다! 저는 사장님 매장의 전담 마케팅 직원 소희입니다.',
          nextQuestion: '저에게 어떤 마케팅을 가장 먼저 맡기고 싶으신가요?',
          quickReplies: [
            '인스타 홍보를 잘해줬으면 좋겠어.',
            '너무 광고 같은 말투는 싫어.',
            '단골 손님들과 편하게 소통하고 싶어.',
          ],
        },
      }
    }

    return {
      workspaceId: snapshot.workspaceId,
      currentStage: 'BUSINESS_LEARNING',
      stepIndex: 1,
      totalSteps: 5,
      isCompleted: false,
      stageLabel: '매장 지식 학습',
      stageDescription: '우리 매장의 대표 상품, 가격, 영업시간을 소희에게 가르쳐주세요.',
      readinessCount: verifiedFactsCount,
      totalReadinessFacts: 7,
      soheeReadiness: snapshot,
      blockingReason: !bizDone ? '사업자 진위확인 진행 중' : undefined,
      primaryAction: {
        label: '우리 매장 지식 확정하기',
        href: '/app/sohee?tab=training',
        description: '대표 메뉴/시술 및 매장 필수 지식을 확정합니다.',
      },
      optionalParallelActions: [
        {
          label: 'SNS 채널 미리 연동하기',
          href: '/start?step=channels',
          description: '인스타그램과 스레드 계정을 연결합니다.',
        },
        {
          label: '사업자등록 상태 확인',
          href: '/start',
          description: '국세청 사업자 진위확인 상태를 점검합니다.',
        },
      ],
      soheeGuidance: {
        acknowledgement: '사장님 매장만의 차별점과 손님들이 가장 사랑하는 메뉴나 시술을 알려주시면 글에 쏙쏙 담아낼게요!',
        nextQuestion: '매장의 대표 시술이나 주력 상품은 무엇인가요?',
        quickReplies: [
          '자연스러운 맞춤 헤어 시술 전문이에요.',
          '매일 아침 굽는 유기농 베이커리입니다.',
          '1:1 퍼스널 케어 중심 매장입니다.',
        ],
      },
    }
  }

  // 3. Stage 2: Channels Setup (Instagram OR Threads - 2026-10-07 ANI-1524: single channel verified suffices)
  const channelDone = igDone || thDone
  if (!channelDone) {
    return {
      workspaceId: snapshot.workspaceId,
      currentStage: 'CHANNELS_SETUP',
      stepIndex: 2,
      totalSteps: 5,
      isCompleted: false,
      stageLabel: 'SNS 공식 채널 연동',
      stageDescription: '인스타그램 또는 스레드 공식 권한을 연결합니다. 채널 1개만 연결되어도 바로 시작할 수 있어요.',
      readinessCount: verifiedFactsCount,
      totalReadinessFacts: 7,
      soheeReadiness: snapshot,
      primaryAction: {
        label: '공식 채널 연동하기',
        href: '/start?step=channels',
        description: 'Meta 공식 계정으로 안전하게 로그인하고 권한을 위임합니다.',
      },
      optionalParallelActions: [
        {
          label: '글쓰기 기준 미리 살펴보기',
          href: '/app/sohee?tab=training',
          description: '소희의 문장 스타일을 미리 조율해 봅니다.',
        },
      ],
      soheeGuidance: {
        acknowledgement: '매장 지식을 잘 기억해 두었어요! 이제 만든 글과 사진을 전송할 공식 인스타 또는 스레드 채널을 연결해 볼까요?',
        stateExplanation: '인스타그램 또는 스레드 공식 연동 대기 중',
        quickReplies: ['공식 로그인으로 연결할게요', '비밀번호가 정말 필요 없나요?'],
      },
    }
  }

  // 4. Stage 3: Text Calibration
  if (!textDone) {
    return {
      workspaceId: snapshot.workspaceId,
      currentStage: 'TEXT_CALIBRATION',
      stepIndex: 3,
      totalSteps: 5,
      isCompleted: false,
      stageLabel: '글쓰기 취향 캘리브레이션',
      stageDescription: '소희가 사장님의 매장 지식을 바탕으로 뽑은 샘플 문장을 비교하고 취향을 맞춰보세요.',
      readinessCount: verifiedFactsCount,
      totalReadinessFacts: 7,
      soheeReadiness: snapshot,
      primaryAction: {
        label: '글쓰기 취향 캘리브레이션',
        href: '/app/sohee?tab=training',
        description: '실제 작성된 샘플을 보고 "너무 과장하지 마", "조금 더 담백하게" 등 피드백을 전달하세요.',
      },
      optionalParallelActions: [
        {
          label: '비주얼 스타일 미리 보기',
          href: '/app/sohee?tab=training',
          description: '매장 사진 분위기 기준을 미리 살펴봅니다.',
        },
      ],
      soheeGuidance: {
        acknowledgement: '공식 채널이 든든하게 연결되었습니다! 이제 제가 사장님 매장 말투를 배울 차례예요.',
        nextQuestion: '준비된 3개 샘플 중 사장님의 느낌에 가장 가까운 문장은 몇 번인가요?',
        quickReplies: ['1번이 좋은데 조금 덜 친한 척했으면 해', '2번 말투가 딱 좋아요', '더 차분하고 전문적인 느낌으로'],
      },
    }
  }

  // 5. Stage 4: Image Calibration
  if (!imgDone) {
    return {
      workspaceId: snapshot.workspaceId,
      currentStage: 'IMAGE_CALIBRATION',
      stepIndex: 4,
      totalSteps: 5,
      isCompleted: false,
      stageLabel: '이미지 취향 캘리브레이션',
      stageDescription: '소장하신 매장 사진을 등록하거나 소희가 AI로 생성할 이미지의 비주얼 방향을 맞춰보세요.',
      readinessCount: verifiedFactsCount,
      totalReadinessFacts: 7,
      soheeReadiness: snapshot,
      primaryAction: {
        label: '이미지 취향 캘리브레이션',
        href: '/app/sohee?tab=training',
        description: '3~5장의 골든 레퍼런스 이미지를 확정하고 시각 취향을 고정합니다.',
      },
      optionalParallelActions: [
        {
          label: '운영 정책 미리 확인하기',
          href: '/app/sohee?tab=command',
          description: '게시 전 승인 정책을 미리 점검합니다.',
        },
      ],
      soheeGuidance: {
        acknowledgement: '말투 기준이 완벽하게 정리되었습니다! 이제 피드에 올릴 사진 취향을 함께 맞춰볼까요?',
        nextQuestion: '사장님 매장 사진으로 시작하시겠어요, 아니면 소희가 제안하는 스타일 방향부터 보시겠어요?',
        quickReplies: ['내 사진으로 시작할게요', '사진 없이 스타일 방향부터 볼래요', '사람 얼굴은 안 나왔으면 해'],
      },
    }
  }

  // 6. Stage 5: First Post Prep (Policy check or All 7 Ready)
  if (!polDone) {
    return {
      workspaceId: snapshot.workspaceId,
      currentStage: 'FIRST_POST_PREP',
      stepIndex: 5,
      totalSteps: 5,
      isCompleted: false,
      stageLabel: '안심 운영 정책 설정',
      stageDescription: '게시 전 사장님의 직접 승인을 항상 받을지 안전 규칙을 확인합니다.',
      readinessCount: verifiedFactsCount,
      totalReadinessFacts: 7,
      soheeReadiness: snapshot,
      primaryAction: {
        label: '안심 운영 정책 확정하기',
        href: '/app/sohee?tab=command',
        description: '기본값인 "게시 전 항상 내 확인 받기"와 필수 제한 규칙을 확정합니다.',
      },
      optionalParallelActions: [],
      soheeGuidance: {
        acknowledgement: '글과 이미지 기준이 모두 사장님 마음에 쏙 들게 준비되었어요!',
        nextQuestion: '안전을 위해 "게시 전 항상 사장님 승인 받기"를 기본으로 시작할게요. 괜찮으신가요?',
        quickReplies: ['네, 제가 확인하고 올릴게요', '하루 최대 몇 개까지 올릴 수 있나요?'],
      },
    }
  }

  // All 7 facts confirmed!
  return {
    workspaceId: snapshot.workspaceId,
    currentStage: 'FIRST_POST_PREP',
    stepIndex: 5,
    totalSteps: 5,
    isCompleted: false,
    stageLabel: '첫 게시물 발행 준비 완료 (SOHEE_READY)',
    stageDescription: '7가지 준비가 모두 증명되었습니다. 사장님만을 위한 첫 마케팅 게시물을 함께 완성해 보세요.',
    readinessCount: 7,
    totalReadinessFacts: 7,
    soheeReadiness: snapshot,
    primaryAction: {
      label: '첫 게시물 함께 만들기',
      href: '/start/preview',
      description: '배운 지식과 취향을 담은 첫 번째 게시물을 검토하고 승인합니다.',
    },
    optionalParallelActions: [],
    soheeGuidance: {
      acknowledgement: '축하드려요 사장님! 저와 함께 7가지 준비를 모두 완벽하게 마쳤습니다. 🎉',
      nextQuestion: '사장님 매장을 알릴 첫 번째 게시물을 지금 바로 같이 만들어볼까요?',
      quickReplies: ['첫 게시물 같이 만들어보자', '원고부터 먼저 보여줘', '사진만 조금 밝게 해줘'],
    },
  }
}

export interface TutorialStagesStatus {
  stage1Done: boolean
  stage2Done: boolean
  stage3Done: boolean
  stage4Done: boolean
  stage5Done: boolean
  completedCount: number
}

/**
 * [ANI-1477] Canonical Tutorial Stages Status Evaluator
 *
 * Evaluates the completion status for each of the 5 tutorial stages
 * strictly aligned with computeTutorialJourneyProgress.
 */
export function computeTutorialStagesStatus(
  snapshot: SoheeReadinessSnapshot,
  options?: TutorialJourneyComputeOptions
): TutorialStagesStatus {
  const isFactDone = (key: SoheeReadinessFactKey) => Boolean(snapshot.facts?.[key]?.verified)

  const knowDone = isFactDone('BUSINESS_KNOWLEDGE_CONFIRMED')
  const igDone = isFactDone('INSTAGRAM_VERIFIED')
  const thDone = isFactDone('THREADS_VERIFIED')
  const textDone = isFactDone('TEXT_HARNESS_CONFIRMED')
  const imgDone = isFactDone('IMAGE_HARNESS_CONFIRMED')

  const stage1Done = knowDone
  const stage2Done = igDone || thDone // 2026-10-07 ANI-1524: single channel verified suffices
  const stage3Done = textDone
  const stage4Done = imgDone
  const stage5Done = Boolean(snapshot.ready) || Boolean(options?.isFirstPostPublished)

  const completedCount = [stage1Done, stage2Done, stage3Done, stage4Done, stage5Done].filter(Boolean).length

  return {
    stage1Done,
    stage2Done,
    stage3Done,
    stage4Done,
    stage5Done,
    completedCount,
  }
}
