'use client'

import { useMemo } from 'react'
import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import type { ShellScreenConfig } from '@/features/mobile-shell'
import { ChatBody, ChatComposerHost } from '@/features/mobile-chat/chat-parts'
import type { ChatSendResult } from '@/features/mobile-chat/chat-send'
import type { ChatBubble } from '@/features/mobile-chat/transcript'
import { MobileHubView } from '@/features/mobile-hub/hub-view'
import type { WorkItemsResult } from '@/features/mobile-hub/use-work-items'
import type { WorkRow } from '@/features/mobile-hub/work-items'
import { MobileWorkHub } from '@/features/mobile-hubs/work-hub-view'
import { MobileMoreHub } from '@/features/mobile-hubs/more-hub-view'
import type { MoreHubSnapshot, WorkHubSnapshot } from '@/features/mobile-hubs/hub-model'
import { FirstActionCard } from '@/features/mobile-today/first-action-card'
import { AutonomyControl } from '@/features/mobile-today/autonomy-control'
import { ExampleTodayScreen } from '@/features/mobile-today/example-today-screen'
import { MobileLandingView } from '@/features/mobile-landing/landing-view'
import { LANDING_EXAMPLES } from '@/features/mobile-landing/landing-model'
import { MobileOnboardingView } from '@/features/mobile-onboarding/onboarding-view'
import type { OnboardingViewSnapshot } from '@/features/mobile-onboarding/onboarding-view'
import {
  PhotoIntakeStepView,
  PhotoRightsStepView,
  ShopInfoStepView,
} from '@/features/mobile-onboarding/first-post-lane-views'
import { FirstPostPreviewDemo } from '@/features/mobile-firstpost/preview-set-demo'
import { ApprovalReviewDemo } from '@/features/mobile-firstpost/approval-review-demo'
import { ResultScreenDemo } from '@/features/mobile-firstpost/result-screen-demo'
import { FirstPostFlowDemo } from '@/features/mobile-firstpost/first-post-flow-demo'
import { NotificationList } from '@/features/mobile-notifications/notification-list'
import type { NotificationCenterData } from '@/features/notifications/repository'
import type { AutonomyServerState } from '@/features/mobile-today/autonomy-state'
import type { AutonomyController } from '@/features/mobile-today/use-autonomy'
import { MobileChannelsView } from '@/features/mobile-channels/channels-view'
import type { ChannelsViewSnapshot } from '@/features/mobile-channels/channels-view'
import { mapChannelsApi } from '@/features/mobile-channels/channels-api-mapper'
import { ExampleCustomersScreen } from '@/features/mobile-customers/example-customers-screen'
import { ExampleCampaignsScreen } from '@/features/mobile-campaigns/example-campaigns-screen'
import { ExampleResultsScreen } from '@/features/mobile-results/example-results-screen'
import { ResultsDrilldownView } from '@/features/mobile-results/results-drilldown-view'
import type { ResultsDrilldownSnapshot } from '@/features/mobile-results/results-drilldown-view'
import { ExampleInboxScreen } from '@/features/mobile-inbox/example-inbox-screen'
import type { InboxViewSnapshot } from '@/features/mobile-inbox/inbox-view'
import { MobileConversationDetail } from '@/features/mobile-inbox/detail-view'
import type { ConversationDetailDto } from '@/features/mobile-inbox/detail-model'
import { MobileBookingTimeline } from '@/features/mobile-inbox/booking-timeline-view'
import type { BookingInquiryDto } from '@/features/mobile-inbox/booking-timeline-model'
import { ExampleLedgerScreen } from '@/features/mobile-inbox/example-ledger-screen'
import { FailurePanel } from '@/features/mobile-resilience/failure-panel'
import { MobileMoreView } from '@/features/mobile-settings/more-view'
import type { MoreViewSnapshot } from '@/features/mobile-settings/more-model'
import { MobileCreditView } from '@/features/mobile-settings/credit-view'
import type { CreditViewSnapshot } from '@/features/mobile-settings/credit-view'
import { MobileMemoryApprovalView } from '@/features/mobile-settings/memory-approval-view'
import type { MemoryApprovalViewSnapshot } from '@/features/mobile-settings/memory-approval-view'
import { ready } from '@/features/mobile-decision/contracts'
import type { DecisionPage, MobileHomeDto, Remote } from '@/features/mobile-decision/contracts'

/**
 * W1 모바일 셸 육안 검수용 화면 (ANI-1662).
 * 예시 데이터만 쓰고 인증·조회·외부 요청은 하지 않는다.
 */
export function MobileShellPreview() {
  const config = useMemo<ShellScreenConfig>(() => ({ mode: 'BROWSE', title: '오늘' }), [])
  return (
    <MobileAppShell>
      <ShellScreen {...config}>
        <PreviewContent />
      </ShellScreen>
    </MobileAppShell>
  )
}

function PreviewContent() {
  const credit = buildPreviewCredit(PREVIEW_OBSERVED_AT)
  const memoryApproval = buildPreviewMemoryApproval(PREVIEW_OBSERVED_AT)

  return (
    <div data-mobile-r2-preview className="space-y-4 pt-4">
      <div className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">예시 화면</p>
        <p>모바일 화면 확인용이며 실제 업무 데이터가 아니에요. 조회·외부 요청은 보내지 않아요.</p>
      </div>

      <section aria-labelledby="preview-today" className="space-y-3">
        <h2 id="preview-today" className="text-lg font-semibold tracking-tight">오늘 할 일</h2>
        <FirstActionCard view={PREVIEW_VIEW} onRefresh={noop} onDelegate={noop} />
        <AutonomyControl controller={PREVIEW_AUTONOMY} />
      </section>

      <section aria-labelledby="preview-today-example" className="space-y-4 border-t border-border pt-4">
        <h2 id="preview-today-example" className="text-lg font-semibold tracking-tight">오늘 화면</h2>
        <ExampleTodayScreen />
      </section>

      <section aria-labelledby="preview-chat" className="space-y-3">
        <h2 id="preview-chat" className="text-lg font-semibold tracking-tight">대화</h2>
        <ChatBody bubbles={PREVIEW_BUBBLES} stage="awaiting_decision">
          <ChatComposerHost onSend={previewSend} />
        </ChatBody>
      </section>

      <section role="region" aria-labelledby="preview-work" className="space-y-3">
        <h2 id="preview-work" className="text-lg font-semibold tracking-tight">작업 목록</h2>
        <MobileHubView workspaceId="preview-workspace" source={PREVIEW_WORK_ITEMS} />
      </section>

      <section role="region" aria-labelledby="preview-work-hub" className="space-y-3 border-t border-border pt-4">
        <h2 id="preview-work-hub" className="text-lg font-semibold tracking-tight">작업 탭 허브</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          다섯 탭의 ‘작업’을 눌렀을 때 처음 보이는 화면이에요. 예시 화면이라 실제 조회는 하지 않아요.
        </p>
        <MobileWorkHub snapshot={PREVIEW_WORK_HUB} />
      </section>

      <section aria-labelledby="preview-notifications" className="space-y-3 border-t border-border pt-4">
        <h2 id="preview-notifications" className="text-lg font-semibold tracking-tight">알림함</h2>
        <NotificationList data={PREVIEW_NOTIFICATIONS} workspaceId="preview-workspace" />
      </section>

      <section aria-labelledby="preview-customers" className="space-y-4 border-t border-border pt-4">
        <h2 id="preview-customers" className="text-lg font-semibold tracking-tight">고객 화면</h2>
        <ExampleCustomersScreen />
      </section>

      <section aria-labelledby="preview-campaigns" className="space-y-4 border-t border-border pt-4">
        <h2 id="preview-campaigns" className="text-lg font-semibold tracking-tight">캠페인 제안 화면</h2>
        <ExampleCampaignsScreen />
      </section>

      <section aria-labelledby="preview-results" className="space-y-4 border-t border-border pt-4">
        <h2 id="preview-results" className="text-lg font-semibold tracking-tight">성과 화면</h2>
        <ExampleResultsScreen />
      </section>

      <section id="preview-results-drilldown" aria-labelledby="preview-results-drilldown-title" className="space-y-4 border-t border-border pt-4">
        <h2 id="preview-results-drilldown-title" className="text-lg font-semibold tracking-tight">성과 근거 드릴다운</h2>
        <p className="text-sm text-muted-foreground">숫자를 눌렀을 때 보이는 화면 4가지 — 확인됨·확인된 0건·집계 안 함·조회 실패.</p>
        {PREVIEW_DRILLDOWNS.map((snapshot, index) => (
          <div key={index} data-preview-drilldown className="rounded-2xl border border-border bg-card p-4">
            <ResultsDrilldownView snapshot={snapshot} />
          </div>
        ))}
      </section>

      <section aria-labelledby="preview-channels" className="space-y-4 border-t border-border pt-4">
        <h2 id="preview-channels" className="text-lg font-semibold tracking-tight">채널 화면</h2>
        <MobileChannelsView snapshot={PREVIEW_CHANNELS} />
      </section>

      <section aria-labelledby="preview-inbox" className="space-y-4 border-t border-border pt-4">
        <h2 id="preview-inbox" className="text-lg font-semibold tracking-tight">소통함 화면</h2>
        <ExampleInboxScreen />
      </section>

      <section aria-labelledby="preview-conversation" className="space-y-4 border-t border-border pt-4">
        <h2 id="preview-conversation" className="text-lg font-semibold tracking-tight">대화 상세 화면</h2>
        <MobileConversationDetail detail={PREVIEW_CONVERSATION} />
      </section>

      <section aria-labelledby="preview-booking" className="space-y-4 border-t border-border pt-4">
        <h2 id="preview-booking" className="text-lg font-semibold tracking-tight">예약 문의 타임라인</h2>
        <MobileBookingTimeline inquiry={PREVIEW_BOOKING} />
      </section>

      <section aria-labelledby="preview-ledger" className="space-y-4 border-t border-border pt-4">
        <h2 id="preview-ledger" className="text-lg font-semibold tracking-tight">예약표 화면</h2>
        <ExampleLedgerScreen />
      </section>

      <section aria-labelledby="preview-more" className="space-y-4 border-t border-border pt-4">
        <h2 id="preview-more" className="text-lg font-semibold tracking-tight">더보기 화면</h2>
        <MobileMoreView snapshot={PREVIEW_MORE} />
      </section>

      <section role="region" aria-labelledby="preview-more-hub" className="space-y-3 border-t border-border pt-4">
        <h2 id="preview-more-hub" className="text-lg font-semibold tracking-tight">더보기 탭 허브</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          다섯 탭의 ‘더보기’를 눌렀을 때 처음 보이는 화면이에요. 예시 화면이라 실제 조회는 하지 않아요.
        </p>
        <MobileMoreHub snapshot={PREVIEW_MORE_HUB} />
      </section>

      <section aria-labelledby="preview-credit" className="space-y-4 border-t border-border pt-4">
        <h2 id="preview-credit" className="text-lg font-semibold tracking-tight">크레딧 화면</h2>
        <MobileCreditView snapshot={credit} />
      </section>

      <section aria-labelledby="preview-memory" className="space-y-4 border-t border-border pt-4">
        <h2 id="preview-memory" className="text-lg font-semibold tracking-tight">가게 기억 승인 화면</h2>
        <MobileMemoryApprovalView snapshot={memoryApproval} />
      </section>

      <section aria-labelledby="preview-resilience" className="space-y-4 border-t border-border pt-4">
        <h2 id="preview-resilience" className="text-lg font-semibold tracking-tight">복귀·오류 화면</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          조회에 실패하면 빈 화면이 아니라 다음 행동 하나를 보여줘요. 예시 화면이에요.
        </p>
        <FailurePanel status={409} />
        <FailurePanel status={401} />
        <FailurePanel status="network" />
      </section>

      <section aria-label="모바일 랜딩 예시" className="border-t border-border pt-4">
        <MobileLandingView
          snapshot={{ loadState: 'ready', examples: LANDING_EXAMPLES, checkedAt: PREVIEW_OBSERVED_AT }}
        />
      </section>

      <section aria-label="가게 소개 화면 예시" className="border-t border-border pt-4">
        <MobileOnboardingView snapshot={PREVIEW_ONBOARDING} actions={PREVIEW_ONBOARDING_ACTIONS} />
      </section>

      <section aria-labelledby="preview-first-post" className="space-y-8 border-t border-border pt-4">
        <h2 id="preview-first-post" className="text-lg font-semibold tracking-tight">
          첫 게시 준비 화면
        </h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          입력한 값은 저장되지 않아요. 화면 배치와 문구만 확인하는 예시예요.
        </p>
        <ShopInfoStepView />
        <PhotoIntakeStepView />
        <PhotoRightsStepView />
      </section>

      <section aria-label="홍보 미리보기 예시" className="border-t border-border pt-4">
        <FirstPostPreviewDemo />
      </section>

      <section aria-label="게시 전 최종 확인 예시" className="border-t border-border pt-4">
        <ApprovalReviewDemo />
      </section>

      <section aria-label="첫 게시 결과 예시" className="border-t border-border pt-4">
        <ResultScreenDemo />
      </section>

      <section aria-label="첫 포스팅 흐름 예시" data-first-post-flow-demo className="border-t border-border pt-4">
        <FirstPostFlowDemo />
      </section>

      <section aria-labelledby="preview-tabs" className="space-y-2">
        <h2 id="preview-tabs" className="text-lg font-semibold tracking-tight">셸 확인 항목</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>상단 헤더와 다섯 개 탭이 겹치지 않는다.</li>
          <li>본문이 탭바에 가리지 않고 끝까지 스크롤된다.</li>
          <li>390px 폭에서 글자가 잘리지 않는다.</li>
        </ul>
      </section>
    </div>
  )
}

function noop() {}

const PREVIEW_OBSERVED_AT = '2026-10-23T09:00:00.000Z'

/**
 * 승인 대기 2건을 가진 정적 응답. pickFirstAction은 createdAt이 이른 항목을
 * 폴드 안 CTA로 고르므로, 게시 승인이 먼저 오도록 시각을 잡아 둔다.
 */
const PREVIEW_DECISIONS: Remote<DecisionPage> = ready<DecisionPage>(
  {
    items: [
      {
        id: 'preview-approval-1',
        kind: 'post_publish',
        title: '게시 전 최종 확인이 필요해요',
        targetLabel: '인스타그램 · 예시 게시물',
        createdAt: '2026-10-23T07:30:00.000Z',
        expiresAt: null,
      },
      {
        id: 'preview-approval-2',
        kind: 'dm_reply',
        title: '고객 문의 답장을 확인해 주세요',
        targetLabel: '예약 문의 · 예시 고객',
        createdAt: '2026-10-23T08:00:00.000Z',
        expiresAt: null,
      },
    ],
    total: 2,
    complete: true,
  },
  PREVIEW_OBSERVED_AT,
)

const PREVIEW_VIEW: Pick<MobileHomeDto, 'decisions'> = { decisions: PREVIEW_DECISIONS }

/**
 * 근거 드릴다운 정적 스냅샷. 실제 조회 없이 화면이 '확인됨/집계 안 함/조회 실패'를
 * 각각 다르게 그리는지만 본다.
 */
const PREVIEW_DRILLDOWNS: ResultsDrilldownSnapshot[] = [
  {
    loadKind: 'ready',
    kpiId: 'published',
    chip: null,
    metricState: 'OBSERVED',
    value: 3,
    evidenceCount: 3,
    sourceLabel: '게시 확인 근거 기록',
    periodLabel: '2026.10.16 ~ 2026.10.23 (UTC)',
    datasetVerified: true,
    metricConnected: true,
    checkedAt: PREVIEW_OBSERVED_AT,
    stale: false,
  },
  {
    // 확인된 0건은 '근거 없음'과 다르다. 서버가 봤고 0이었다는 뜻이라 0건을 그대로 보여준다.
    loadKind: 'ready',
    kpiId: 'bookings',
    chip: null,
    metricState: 'OBSERVED',
    value: 0,
    evidenceCount: 0,
    sourceLabel: '예약 장부',
    periodLabel: '2026.10.16 ~ 2026.10.23 (UTC)',
    datasetVerified: true,
    metricConnected: true,
    checkedAt: PREVIEW_OBSERVED_AT,
    stale: false,
  },
  {
    loadKind: 'ready',
    kpiId: 'inquiries',
    chip: { kind: 'partial', label: '이 숫자는 집계하지 않아요' },
    metricState: null,
    value: null,
    evidenceCount: 0,
    sourceLabel: null,
    periodLabel: '2026.10.16 ~ 2026.10.23 (UTC)',
    datasetVerified: true,
    metricConnected: false,
    checkedAt: PREVIEW_OBSERVED_AT,
    stale: false,
  },
  {
    loadKind: 'error',
    kpiId: 'deposits',
    chip: { kind: 'error' },
    metricState: null,
    value: null,
    evidenceCount: 0,
    sourceLabel: null,
    periodLabel: null,
    datasetVerified: true,
    metricConnected: true,
    checkedAt: null,
    stale: false,
  },
]

/** 자율근무 서버 readback을 흉내 낸 정적 상태. useAutonomy처럼 조회하지 않는다. */
const PREVIEW_AUTONOMY_STATE: AutonomyServerState = {
  desiredMode: 'RUNNING',
  actualMode: 'RUNNING',
  activeActionRunCount: 2,
  killSwitchActive: false,
  version: 1,
  observedAt: PREVIEW_OBSERVED_AT,
}

/** 정적 대화 기록. 승인 카드와 증거 링크가 실제 컴포넌트에서 어떻게 그려지는지 확인한다. */
const PREVIEW_BUBBLES: ChatBubble[] = [
  {
    id: 'preview-bubble-1',
    role: 'owner',
    text: '이번 주 예약 문의 답장을 준비해 줄 수 있어?',
    pending: false,
    evidence: [],
    approval: null,
  },
  {
    id: 'preview-bubble-2',
    role: 'sohee',
    text: '예약 문의 3건을 확인하고 답장 초안을 준비했어요. 보내기 전에 확인이 필요해요.',
    pending: false,
    evidence: [],
    approval: { id: 'preview-approval-1', title: '답장 초안 확인' },
  },
  {
    id: 'preview-bubble-3',
    role: 'sohee',
    text: '확인한 문의와 초안은 작업 목록에 남겨 두었어요.',
    pending: false,
    evidence: [{ label: '작업 기록 보기', href: '/app/work' }],
    approval: null,
  },
]

/** 보내기를 눌러도 실제 전송 요청을 보내지 않고, 그 사실을 입력창 아래에 그대로 알린다. */
function previewSend(): ChatSendResult {
  return { ok: false, message: '미리보기에서는 메시지를 실제로 보내지 않아요.' }
}

/** 예시 작업 목록. 서버 목록이 아니므로 complete 는 false 로 두고 부분 목록으로 표시한다. */
const PREVIEW_WORK_ROWS: WorkRow[] = [
  {
    id: 'preview-work-1',
    title: '인스타그램 게시물 · 신메뉴 안내',
    status: 'review',
    rawState: 'waiting_for_approval',
    statusLabel: '검토 중',
    channelLabel: '인스타그램',
    href: '/app/work/preview-work-1',
    publishedUrl: null,
    isApproved: false,
    createdAt: '2026-10-23T07:20:00.000Z',
  },
  {
    id: 'preview-work-2',
    title: '예약 문의 답장 초안 3건',
    status: 'draft',
    rawState: 'draft',
    statusLabel: '초안',
    channelLabel: '인스타그램',
    href: '/app/work/preview-work-2',
    publishedUrl: null,
    isApproved: false,
    createdAt: '2026-10-23T08:10:00.000Z',
  },
  {
    id: 'preview-work-3',
    title: '주간 게시물 · 시술 후 관리 안내',
    status: 'confirmed',
    rawState: 'published',
    statusLabel: '게시 확인',
    channelLabel: '인스타그램',
    href: '/app/work/preview-work-3',
    publishedUrl: 'https://www.instagram.com/p/preview-example/',
    isApproved: true,
    createdAt: '2026-10-21T05:00:00.000Z',
  },
]

export const PREVIEW_WORK_ITEMS: WorkItemsResult = {
  items: PREVIEW_WORK_ROWS,
  loadState: 'ready',
  complete: false,
  refresh: noop,
}

/** 버튼을 눌러도 실제 변경 요청을 보내지 않고, 그 사실을 화면에 그대로 알린다. */
const PREVIEW_AUTONOMY: AutonomyController = {
  state: PREVIEW_AUTONOMY_STATE,
  load: 'ready',
  errorMessage: '',
  conflict: false,
  refresh: noop,
  setPaused: async () => ({ ok: false, kind: 'failed', message: '미리보기에서는 자율근무를 바꾸지 않아요.' }),
}

/**
 * 온보딩 예시 스냅샷: 가게 정보는 확인됐고 사진 조회는 끝났지만 확인된 사진이 없다.
 * 사진 조회가 끝나지 않은 경우(mediaComplete=false)는 partial 로 남겨 두므로,
 * 여기서는 "사진 없음"이 실제로 확인된 상태를 보여 준다.
 */
const PREVIEW_ONBOARDING: OnboardingViewSnapshot = {
  loadState: 'ready',
  // 예시 화면이라 사진 업로드 카드는 붙이지 않는다(workspaceId 없음 = 서버 요청 없음).
  workspaceId: null,
  profile: { business_name: '예시 가게', industry: '뷰티', summary: '동네에서 10년째, 머리 잘하는 집' },
  preferences: { tone: 'friendly' },
  facts: { TEXT_HARNESS_CONFIRMED: true, INSTAGRAM_VERIFIED: false, THREADS_VERIFIED: false },
  checkedAt: PREVIEW_OBSERVED_AT,
  empty: false,
}

/** 예시 화면 동작. 저장·이동은 하지 않는다(입력값은 저장되지 않는다는 안내와 같은 뜻). */
const PREVIEW_ONBOARDING_ACTIONS = {
  saveShop: async () => ({ ok: true }) as const,
  saveTone: async () => ({ ok: true }) as const,
  goChannels: () => undefined,
  goPreview: () => undefined,
  reload: () => undefined,
}

/**
 * 알림함 예시. 읽지 않음 3건 + 읽음 1건, 네 가지 종류, 안전한 /app 내부 경로만 넣는다.
 * 승인·일정은 목록에서 본문이 일반 문구로 가려지므로(deeplink.previewText) 그 결과를 그대로 확인한다.
 * system 알림은 연결 경로가 없는 경우(href: null)를 보여 준다.
 */
export const PREVIEW_NOTIFICATIONS: NotificationCenterData = {
  userId: 'preview-user',
  preferences: { approvalEvents: true, scheduleEvents: true, publishEvents: true },
  notifications: [
    {
      id: 'preview-notification-1',
      kind: 'approval',
      body: '게시 전 최종 확인이 필요해요',
      href: '/app/approvals/preview-approval-1',
      readAt: null,
      createdAt: '2026-10-23T08:40:00.000Z',
    },
    {
      id: 'preview-notification-2',
      kind: 'schedule',
      body: '내일 오전 예약 3건이 있어요',
      href: '/app/schedule',
      readAt: null,
      createdAt: '2026-10-23T07:10:00.000Z',
    },
    {
      id: 'preview-notification-3',
      kind: 'publish',
      body: '인스타그램 게시가 확인됐어요',
      href: '/app/work/preview-work-3',
      readAt: null,
      createdAt: '2026-10-22T09:30:00.000Z',
    },
    {
      id: 'preview-notification-4',
      kind: 'system',
      body: '알림 설정을 확인해 주세요',
      href: null,
      readAt: '2026-10-22T10:00:00.000Z',
      createdAt: '2026-10-21T23:50:00.000Z',
    },
  ],
}

/**
 * 고객 예시. 동의 확인·철회·미확인 고객과 다른 워크스페이스 고객(목록에서 제외)을 함께 둔다.
 * 철회 고객은 이름이 마스킹되고 연락 CTA 가 모두 비활성으로 그려진다.
 */
export const PREVIEW_INBOX: InboxViewSnapshot = {
  loadState: 'ready',
  workspaceId: 'preview-workspace',
  complete: true,
  checkedAt: PREVIEW_OBSERVED_AT,
  threads: [
    {
      id: 'preview-thread-1', workspaceId: 'preview-workspace', channel: 'instagram_dm', customerName: '김예시',
      consent: 'granted', status: 'draft_ready', unread: true,
      lastMessage: { text: '목요일 오후에 속눈썹펌 예약 가능한 시간 있을까요?', receivedAt: '2026-10-22T05:10:00.000Z', fromCustomer: true },
      draft: { text: '목요일 오후 2시와 4시 30분에 가능해요.', sources: ['예약표', '시술 안내'] },
      sendBlockers: [],
    },
    {
      id: 'preview-thread-2', workspaceId: 'preview-workspace', channel: 'kakao', customerName: '이예시',
      consent: 'unknown', status: 'needs_reply', unread: false,
      lastMessage: { text: '가격이 어떻게 되나요?', receivedAt: '2026-10-22T03:00:00.000Z', fromCustomer: true },
      draft: { text: '시술별 가격 안내드릴게요.', sources: [] },
      sendBlockers: ['NO_SEND_SCOPE'],
    },
  ],
}

const PREVIEW_CONVERSATION: ConversationDetailDto = {
  thread: PREVIEW_INBOX.threads[0],
  targetLabel: '예시 인스타 계정 → 김예시',
  fingerprint: 'a'.repeat(64),
  version: 1,
  delivery: 'none',
  complete: true,
  messages: [
    { id: 'pm-1', fromCustomer: true, text: '안녕하세요! 지난번에 펌이 너무 마음에 들어서 다시 연락드렸어요.', at: '2026-10-22T05:08:00.000Z' },
    { id: 'pm-2', fromCustomer: true, text: '목요일 오후에 속눈썹펌 예약 가능한 시간 있을까요?', at: '2026-10-22T05:10:00.000Z' },
  ],
}

const PREVIEW_BOOKING: BookingInquiryDto = {
  id: 'preview-booking-1', workspaceId: 'preview-workspace', customerName: '김예시',
  inquiryText: '목요일 오후에 속눈썹펌 예약 가능한 시간 있을까요?', receivedAt: '2026-10-22T05:10:00.000Z',
  candidates: [{ id: 'c1', label: '목 오후 2시' }, { id: 'c2', label: '목 오후 4시 30분' }],
  approvedAt: '2026-10-22T06:00:00.000Z', send: 'accepted', customerResponse: 'none', ledger: 'none', depositRequired: false,
}

export const PREVIEW_MORE: MoreViewSnapshot = {
  loadState: 'ready', workspaceId: 'preview-a', now: PREVIEW_OBSERVED_AT, checkedAt: PREVIEW_OBSERVED_AT,
  lastReauthAt: null,
  workspaces: [{ id: 'preview-a', name: '예시 가게 본점', role: 'owner' }, { id: 'preview-b', name: '예시 가게 2호점', role: 'owner' }],
  sections: [
    { id: 'store', status: 'ok', summary: '영업시간·소개 확인됨' },
    { id: 'channels', status: 'attention', summary: '인스타그램 연결 확인 필요' },
    { id: 'billing', status: 'unknown', summary: null },
  ],
  privacy: { export: 'none', withdraw: 'none' },
}

/**
 * 채널 화면 예시. 손으로 DTO를 만들지 않고 실제 서버 응답 매퍼를 그대로 통과시킨다.
 * (예시 데이터만 다르고, 어떤 상태가 어떤 문구로 바뀌는지는 실서비스와 같아야 한다.)
 */
export const PREVIEW_CHANNELS: ChannelsViewSnapshot = mapChannelsApi({
  instagram: { status: 'VERIFIED', verified: true, supportedPublish: true, lastCheckedAt: PREVIEW_OBSERVED_AT },
  threads: { status: 'CONNECTED_UNVERIFIED', verified: false, supportedPublish: true, lastCheckedAt: PREVIEW_OBSERVED_AT },
  naverBlog: { status: 'CONNECTED_UNVERIFIED', verified: false, supportedPublish: false, lastCheckedAt: null },
  naverPlace: { status: 'UNKNOWN', verified: false, supportedPublish: false, lastCheckedAt: null },
  daangn: { status: 'READY_DEGRADED', verified: false, supportedPublish: false, lastCheckedAt: PREVIEW_OBSERVED_AT },
})

/**
 * 크레딧 예시. 소희 이용 크레딧과 고객 예약금은 별도 원장으로 두고 합산하지 않는다.
 * 예상 비용이 확인된 상태라 실행 가능 판정이 그대로 그려지는지 확인한다.
 */
export const PREVIEW_CREDIT: CreditViewSnapshot = {
  loadState: 'ready',
  checkedAt: PREVIEW_OBSERVED_AT,
  credit: { available: 42, reserved: 6, consumed: 128, refunded: 2, observedAt: PREVIEW_OBSERVED_AT },
  customerDeposit: {
    available: 150000,
    reserved: 0,
    consumed: 0,
    refunded: 30000,
    observedAt: PREVIEW_OBSERVED_AT,
  },
  estimate: 4,
}

/**
 * 가게 기억 예시: 확정 1건, 소희 추측 1건(출처 없음), 기존 값과 다른 변경 제안 1건.
 * 추측·변경 제안이 승인 전 고객에게 노출되지 않는다는 안내와 차단 사유를 확인한다.
 */
export const PREVIEW_MEMORY_APPROVAL: MemoryApprovalViewSnapshot = {
  loadState: 'ready',
  complete: true,
  checkedAt: PREVIEW_OBSERVED_AT,
  candidates: [
    {
      key: 'hours.weekday',
      proposalId: 'preview-memory-1',
      kind: 'hours',
      proposedValue: '평일 10:00–20:00',
      currentValue: null,
      origin: 'owner_stated',
      source: { label: '사장님 직접 입력', href: null, observedAt: '2026-10-21T05:00:00.000Z' },
      customerVisible: true,
    },
    {
      key: 'price.cut',
      proposalId: 'preview-memory-2',
      kind: 'price',
      proposedValue: '커트 35,000원',
      currentValue: null,
      origin: 'sohee_inferred',
      source: null,
      customerVisible: false,
    },
    {
      key: 'policy.cancel',
      proposalId: 'preview-memory-3',
      kind: 'policy',
      proposedValue: '예약 24시간 전까지 무료 취소',
      currentValue: '예약 48시간 전까지 무료 취소',
      origin: 'from_source',
      source: {
        label: '가게 예약 안내 페이지',
        href: '/app/sources/preview-policy',
        observedAt: '2026-10-22T03:00:00.000Z',
      },
      customerVisible: false,
    },
  ],
}

/**
 * 프리뷰용 스냅샷 빌더. 정적 예시 데이터에 관측 시각만 주입한다.
 * 서버 조회·외부 요청은 하지 않으므로 화면 확인 중에도 실제 데이터가 바뀌지 않는다.
 */
function buildPreviewCredit(observedAt: string): CreditViewSnapshot {
  return {
    ...PREVIEW_CREDIT,
    checkedAt: observedAt,
    credit: { ...PREVIEW_CREDIT.credit, observedAt },
    customerDeposit: PREVIEW_CREDIT.customerDeposit
      ? { ...PREVIEW_CREDIT.customerDeposit, observedAt }
      : null,
  }
}

function buildPreviewMemoryApproval(observedAt: string): MemoryApprovalViewSnapshot {
  return { ...PREVIEW_MEMORY_APPROVAL, checkedAt: observedAt }
}

/**
 * 작업 탭 허브 예시. 개수는 아래 예시 데이터에서 직접 세어 화면과 어긋나지 않게 한다.
 * 알림은 읽지 않은 것만 '확인할 알림' 으로 센다.
 */
const PREVIEW_WORK_HUB: WorkHubSnapshot = {
  loadState: 'ready',
  checkedAt: PREVIEW_OBSERVED_AT,
  entries: [
    {
      id: 'content',
      label: '작업 목록',
      description: '초안부터 게시 확인까지 모아 봐요.',
      href: '/app/content',
      count: { value: PREVIEW_WORK_ROWS.length, unit: '건' },
      needsAttention: false,
    },
    {
      id: 'notifications',
      label: '알림함',
      description: '새 소식과 확인할 일을 봐요.',
      href: '/app/notifications',
      count: { value: PREVIEW_NOTIFICATIONS.notifications.filter(n => n.readAt === null).length, unit: '건' },
      needsAttention: true,
    },
  ],
  recent: PREVIEW_WORK_ROWS.slice(0, 3),
}

/**
 * 더보기 탭 허브 예시. 채널은 게시 확인까지 끝난 곳만 세고, 크레딧은 사용 가능한 값만 보여준다.
 * 설정은 개수 개념이 없어 count 를 null 로 둔다(0건으로 보이지 않게).
 */
const PREVIEW_MORE_HUB: MoreHubSnapshot = {
  loadState: 'ready',
  checkedAt: PREVIEW_OBSERVED_AT,
  entries: [
    {
      id: 'channels',
      label: '채널 연결',
      description: '인스타그램·블로그 연결 상태를 봐요.',
      href: '/app/channels',
      count: { value: PREVIEW_CHANNELS.channels.filter(c => c.level === 'publish_verified').length, unit: '곳' },
      needsAttention: PREVIEW_CHANNELS.channels.some(c => c.level !== 'publish_verified'),
    },
    {
      id: 'credits',
      label: '크레딧',
      description: '남은 크레딧과 사용 내역을 봐요.',
      href: '/app/account/credits',
      count: { value: PREVIEW_CREDIT.credit.available, unit: '개' },
      needsAttention: false,
    },
    {
      id: 'memory',
      label: '가게 기억',
      description: '소희가 기억할 내용을 확인해요.',
      href: '/app/memory',
      count: { value: PREVIEW_MEMORY_APPROVAL.candidates.length, unit: '건' },
      needsAttention: false,
    },
    {
      id: 'settings',
      label: '설정',
      description: '가게 정보와 계정을 관리해요.',
      href: '/app/account',
      count: null,
      needsAttention: false,
    },
  ],
}
