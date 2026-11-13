import { describe, it, expect, beforeEach } from 'vitest'
import {
  HomeCommandCenterService,
  type RawOwnerCenterInput,
  type OwnerCommandCenterSnapshot,
} from '@/features/owner-dashboard/home-command-center'
import {
  PersistentWorkConsoleState,
  type ConsoleEntityContext,
} from '@/features/agent-dock/persistent-work-console'
import {
  scanForbiddenTechnicalTerms,
  toBusinessLanguage,
  formatThreeStepErrorCopy,
} from '@/lib/ux-copy/business-language-dictionary'
import {
  resolveAdaptiveShellLayout,
  validateTouchTargetSize,
} from '@/components/layout/adaptive-owner-shell-types'

describe('V0.91 Wave 1 · Owner Daily Command Center (ANI-1237, ANI-1238, ANI-1239, ANI-1240)', () => {
  const workspaceId = '00000000-0000-4000-8000-0000000000a2'

  // --------------------------------------------------------------------------
  // 1. ANI-1237: Home 30-Second Command Center
  // --------------------------------------------------------------------------
  describe('1. ANI-1237: Home 30-Second Command Center · 6대 필수 IA 및 우선순위 정렬', () => {
    let service: HomeCommandCenterService

    beforeEach(() => {
      service = new HomeCommandCenterService()
    })

    it('MUST resolve all 6 essential IA sections accurately with same-truth', () => {
      const input: RawOwnerCenterInput = {
        workspaceId,
        businessName: '바이름 뷰티',
        dailyGoal: { targetRevenueKrw: 500000, currentRevenueKrw: 360000, progressPercent: 72 },
        activeMission: {
          missionId: 'msn-001',
          title: '주말 1:1 맞춤 자연눈썹 인스타 피드 게시',
          canonicalStatus: 'EXECUTING',
          updatedAt: '2026-09-10T10:00:00.000Z',
        },
        pendingApproval: {
          approvalId: 'appr-001',
          title: '가을 네일 이벤트 피드 발행 승인',
          actionType: 'PUBLISH_FEED',
          deadline: '18:00',
        },
        customerChange: {
          newInquiriesCount: 2,
          pendingBookingsCount: 1,
          latestCustomerName: '김민지',
        },
        recentOutcome: {
          verifiedRevenueKrw: 180000,
          verifiedBookingsCount: 1,
          evidenceClass: 'VERIFIED',
        },
        nextBestAction: {
          actionId: 'nba-001',
          title: '주말 잔여 슬롯 숏폼 릴스 발행 제안',
          confidence: 92,
        },
      }

      const snapshot: OwnerCommandCenterSnapshot = service.buildSnapshot(input)

      // Verify all 6 core IA sections
      expect(snapshot.businessName).toBe('바이름 뷰티')
      expect(snapshot.todayGoal.progressPercent).toBe(72)
      expect(snapshot.currentMission?.businessStatusText).toContain('소희가 업무를 진행하고 있어요')
      expect(snapshot.pendingDecision?.title).toBe('가을 네일 이벤트 피드 발행 승인')
      expect(snapshot.customerChanges.newInquiriesCount).toBe(2)
      expect(snapshot.recentOutcome?.formattedRevenue).toBe('₩180,000')
      expect(snapshot.nextBestAction?.title).toContain('주말 잔여 슬롯')
    })

    it('MUST sort actionable items by strict priority: Emergency Customer > Approval > Failure Recovery > Marketing', () => {
      const items = service.prioritizeActionItems([
        { id: 'item-mkt', priorityTier: 'TODAY_MARKETING', title: '인스타 스토리 초안 확인' },
        { id: 'item-emg', priorityTier: 'EMERGENCY_CUSTOMER', title: '고객 예약 충돌 긴급 확인' },
        { id: 'item-appr', priorityTier: 'PENDING_APPROVAL', title: '유료 광고 집행 5초 승인' },
        { id: 'item-rec', priorityTier: 'FAILURE_RECOVERY', title: '외부 발행 실패 복구' },
      ])

      expect(items[0].id).toBe('item-emg')
      expect(items[1].id).toBe('item-appr')
      expect(items[2].id).toBe('item-rec')
      expect(items[3].id).toBe('item-mkt')
    })

    it('MUST NOT fabricate 0 for missing outcome, retaining NOT_OBSERVED status', () => {
      const input: RawOwnerCenterInput = {
        workspaceId,
        businessName: '바이름 뷰티',
        dailyGoal: { targetRevenueKrw: 500000, currentRevenueKrw: 0, progressPercent: 0 },
        activeMission: null,
        pendingApproval: null,
        customerChange: { newInquiriesCount: 0, pendingBookingsCount: 0 },
        recentOutcome: null, // No outcome yet!
        nextBestAction: null,
      }

      const snapshot = service.buildSnapshot(input)
      expect(snapshot.recentOutcome).toBeNull()
      expect(snapshot.outcomeStatusText).toBe('성과 확인 대기 중')
    })
  })

  // --------------------------------------------------------------------------
  // 2. ANI-1238: Persistent Sohee Work Console
  // --------------------------------------------------------------------------
  describe('2. ANI-1238: Persistent Sohee Work Console · 화면 이동 시 컨텍스트 유지 & Same-Truth', () => {
    let consoleState: PersistentWorkConsoleState

    beforeEach(() => {
      consoleState = new PersistentWorkConsoleState()
    })

    it('MUST maintain and restore active mission context across route transitions', () => {
      const initialContext: ConsoleEntityContext = {
        workspaceId,
        activeMissionId: 'msn-dock-001',
        activeCustomerId: 'cust-dock-001',
        currentRoute: '/app',
        canonicalStatus: 'AWAITING_APPROVAL',
        lastUpdated: '2026-09-10T10:00:00.000Z',
      }

      consoleState.setContext(initialContext)

      // Navigate to /app/content
      consoleState.navigateRoute('/app/content')
      expect(consoleState.getContext()?.activeMissionId).toBe('msn-dock-001')
      expect(consoleState.getContext()?.currentRoute).toBe('/app/content')

      // Navigate to /app/customers
      consoleState.navigateRoute('/app/customers')
      expect(consoleState.getContext()?.activeMissionId).toBe('msn-dock-001')
      expect(consoleState.getContext()?.activeCustomerId).toBe('cust-dock-001')

      // Serialized state restore test (simulating page reload F5)
      const serialized = consoleState.serialize()
      const restoredConsole = new PersistentWorkConsoleState()
      restoredConsole.restore(serialized)

      expect(restoredConsole.getContext()?.activeMissionId).toBe('msn-dock-001')
      expect(restoredConsole.getContext()?.canonicalStatus).toBe('AWAITING_APPROVAL')
    })

    it('MUST map natural language owner commands to canonical actions on the current entity', () => {
      consoleState.setContext({
        workspaceId,
        activeMissionId: 'msn-dock-002',
        canonicalStatus: 'AWAITING_APPROVAL',
        currentRoute: '/app',
      })

      // 1. "지금 올려" -> APPROVE_AND_EXECUTE
      const cmd1 = consoleState.interpretNaturalCommand('지금 올려줘')
      expect(cmd1.canonicalAction).toBe('APPROVE_AND_EXECUTE')
      expect(cmd1.targetEntityId).toBe('msn-dock-002')

      // 2. "멈춰" -> PAUSE_MISSION
      const cmd2 = consoleState.interpretNaturalCommand('잠깐 멈춰봐')
      expect(cmd2.canonicalAction).toBe('PAUSE_MISSION')
      expect(cmd2.targetEntityId).toBe('msn-dock-002')

      // 3. "수정해줘" -> REQUEST_REVISION
      const cmd3 = consoleState.interpretNaturalCommand('문구 조금만 수정해줘')
      expect(cmd3.canonicalAction).toBe('REQUEST_REVISION')
      expect(cmd3.targetEntityId).toBe('msn-dock-002')
    })
  })

  // --------------------------------------------------------------------------
  // 3. ANI-1239: UX Copy & Technical Console Language Removal
  // --------------------------------------------------------------------------
  describe('3. ANI-1239: UX Copy · 기술 콘솔 언어 제거 및 소상공인 업무언어 표준화', () => {
    it('MUST detect forbidden technical words in Owner-facing text', () => {
      const technicalText = 'Provider Webhook이 Receipt를 발급하지 않아 Ingress Readback에 실패했습니다.'
      const scanResult = scanForbiddenTechnicalTerms(technicalText)

      expect(scanResult.hasForbiddenTerms).toBe(true)
      expect(scanResult.detectedTerms).toContain('Webhook')
      expect(scanResult.detectedTerms).toContain('Receipt')
      expect(scanResult.detectedTerms).toContain('Readback')
      expect(scanResult.detectedTerms).toContain('Ingress')
      expect(scanResult.detectedTerms).toContain('Provider')
    })

    it('MUST map technical status codes to friendly Korean business language', () => {
      expect(toBusinessLanguage('EXECUTING')).toBe('소희가 업무를 진행하고 있어요')
      expect(toBusinessLanguage('AWAITING_APPROVAL')).toBe('사장님의 확인을 기다리고 있어요')
      expect(toBusinessLanguage('PUBLISHED_VERIFIED')).toBe('게시 및 발행 확인 완료')
      expect(toBusinessLanguage('RESULT_UNKNOWN')).toBe('외부 채널 확인 중 (잠시 후 다시 안내해 드릴게요)')
      expect(toBusinessLanguage('BOOKED')).toBe('고객 예약 확정 완료')
    })

    it('MUST format errors into 3-step actionable structure: What happened + What Sohee did + What Owner should do', () => {
      const formatted = formatThreeStepErrorCopy({
        whatHappened: '인스타그램 일시 연결 지연이 발생했습니다.',
        whatSoheeDid: '중복 게시를 방지하기 위해 발행을 안전하게 일시정지했습니다.',
        whatOwnerShouldDo: '채널 연결 상태를 확인 후 [다시 시도] 버튼을 눌러주세요.',
      })

      expect(formatted.whatHappened).toBe('인스타그램 일시 연결 지연이 발생했습니다.')
      expect(formatted.whatSoheeDid).toContain('중복 게시를 방지하기 위해')
      expect(formatted.whatOwnerShouldDo).toContain('채널 연결 상태를 확인')
      expect(formatted.fullSummary).toContain('1. 상황:')
      expect(formatted.fullSummary).toContain('2. 소희의 조치:')
      expect(formatted.fullSummary).toContain('3. 사장님 확인:')
    })
  })

  // --------------------------------------------------------------------------
  // 4. ANI-1240: Responsive UX & Adaptive Owner Shell
  // --------------------------------------------------------------------------
  describe('4. ANI-1240: Responsive UX · 1440/1024/768/375 Adaptive Owner Shell', () => {
    it('MUST resolve correct adaptive layout modes across all 4 responsive breakpoints', () => {
      // 1. Desktop (>= 1440px): 3-Pane Full
      expect(resolveAdaptiveShellLayout(1440)).toEqual({
        breakpoint: 'DESKTOP_3PANE',
        navMode: 'EXPANDED_SIDEBAR',
        dockMode: 'PERSISTENT_RIGHT_PANE',
        navWidthPx: 240,
        dockWidthPx: 380,
      })

      // 2. Laptop (1024 ~ 1439px): Compact Nav + Collapsible Dock
      expect(resolveAdaptiveShellLayout(1200)).toEqual({
        breakpoint: 'LAPTOP_COMPACT',
        navMode: 'COMPACT_ICON_RAIL',
        dockMode: 'COLLAPSIBLE_DRAWER',
        navWidthPx: 64,
        dockWidthPx: 360,
      })

      // 3. Tablet (768 ~ 1023px): Center-First + Sticky Action Rail + Dock Sheet
      expect(resolveAdaptiveShellLayout(800)).toEqual({
        breakpoint: 'TABLET_CENTER_FIRST',
        navMode: 'COMPACT_ICON_RAIL',
        dockMode: 'BOTTOM_SHEET',
        hasStickyDecisionRail: true,
      })

      // 4. Mobile (375 ~ 767px): Bottom Nav + Full Width Cards + Floating Bottom Sheet
      expect(resolveAdaptiveShellLayout(375)).toEqual({
        breakpoint: 'MOBILE_BOTTOM_NAV',
        navMode: 'BOTTOM_TAB_BAR',
        dockMode: 'FLOATING_BOTTOM_SHEET',
        isFullWidthCards: true,
      })
    })

    it('MUST enforce touch target minimum of 44px for accessibility', () => {
      expect(validateTouchTargetSize(44, 44)).toBe(true)
      expect(validateTouchTargetSize(48, 48)).toBe(true)
      expect(validateTouchTargetSize(32, 32)).toBe(false)
    })
  })
})
