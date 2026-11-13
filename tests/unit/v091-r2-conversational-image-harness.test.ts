import { describe, it, expect } from 'vitest'
import {
  extractConversationalVisualRules,
  createConversationalImageHarness,
  transitionToTesting,
  recordTestFeedback,
  selectGoldenImages,
  confirmConversationalImageHarness,
  createMediaHarnessLineage,
  type StructuredVisualRules,
  type ConversationalImageReferenceAsset,
  type ConversationalImageHarnessState,
} from '@/features/image-harness/conversational-image-harness'

describe('ANI-1431: Conversational Image Harness · Reference→Test→Golden→CONFIRMED', () => {
  describe('1. Natural Language Visual Rule Extraction (9 Dimensions)', () => {
    it('extracts all 9 structured visual dimensions from conversational owner utterance', () => {
      const utterance = `
        사진은 얼굴이 직접 나오지 않고 손이나 시술 디테일 위주로 찍어줘. 매장 내부 원목 인테리어가 배경으로 보이면 좋겠고,
        구도는 45도 각도나 1:1 정사각 인스타 비율과 4:5 세로 비율 둘 다 지원해줘.
        조명은 은은한 자연광과 따뜻한 웜톤 색감으로, 노출은 자연스럽고 화사하게 맞춰줘.
        타사 상표나 인위적인 텍스트 워터마크, 네온사인 같은 AI 왜곡은 절대 넣지 마.
      `

      const rules = extractConversationalVisualRules(utterance)

      expect(rules.modelPresence).toBe('HAND_OR_DETAIL_ONLY')
      expect(rules.location).toContain('매장 내부')
      expect(rules.background).toContain('원목')
      expect(rules.composition).toContain('45도')
      expect(rules.channelRatio).toBe('DUAL_RATIO')
      expect(rules.lighting).toContain('자연광')
      expect(rules.colorTone).toContain('웜톤')
      expect(rules.exposure).toContain('화사')
      expect(rules.forbiddenElements).toContain('타사 상표')
      expect(rules.forbiddenElements).toContain('워터마크')
      expect(rules.forbiddenElements).toContain('네온사인')
    })

    it('provides sensible safe defaults when partial utterance is given', () => {
      const partial = '따뜻한 감성으로 깔끔하게 찍어줘'
      const rules = extractConversationalVisualRules(partial)

      expect(rules.colorTone).toContain('따뜻')
      expect(rules.channelRatio).toBe('SQUARE_1_1')
      expect(rules.modelPresence).toBe('MODEL_ABSENT')
      expect(rules.forbiddenElements.length).toBeGreaterThan(0)
    })
  })

  describe('2. Lifecycle State Transitions: DRAFT → TESTING → GOLDEN_SELECTED → CONFIRMED', () => {
    const mockAssets: ConversationalImageReferenceAsset[] = [
      {
        id: 'ref-1',
        url: 'https://cdn.example.com/ref1.jpg',
        category: 'STORE_INTERIOR',
        caption: '따뜻한 매장 원목 카운터',
        positivePoints: ['자연광', '정돈된 원목 질감'],
        rightsStatus: 'OWNED',
        consentStatus: 'NOT_APPLICABLE',
        rightsConfirmedAt: '2026-09-14T00:00:00.000Z',
      },
      {
        id: 'ref-2',
        url: 'https://cdn.example.com/ref2.jpg',
        category: 'SIGNATURE_MENU',
        caption: '시그니처 사워도우 단면',
        positivePoints: ['바삭한 크러스트 질감'],
        rightsStatus: 'OWNED',
        consentStatus: 'NOT_APPLICABLE',
        rightsConfirmedAt: '2026-09-14T00:00:00.000Z',
      },
      {
        id: 'ref-3',
        url: 'https://cdn.example.com/ref3.jpg',
        category: 'ATMOSPHERE',
        caption: '오후 햇살이 비치는 창가 테이블',
        positivePoints: ['따뜻한 채광'],
        rightsStatus: 'USER_CONFIRMED',
        consentStatus: 'NOT_APPLICABLE',
        rightsConfirmedAt: '2026-09-14T00:00:00.000Z',
      },
    ]

    it('initializes in DRAFT state with reference assets', () => {
      const harness = createConversationalImageHarness({
        workspaceId: 'ws-photo-1',
        referenceAssets: mockAssets,
      })

      expect(harness.lifecycleStatus).toBe('DRAFT')
      expect(harness.referenceAssets.length).toBe(3)
      expect(harness.testRunsCount).toBe(0)
      expect(harness.goldenImageIds).toEqual([])
    })

    it('transitions to TESTING state and increments testRunsCount upon test batch run', () => {
      const initial = createConversationalImageHarness({
        workspaceId: 'ws-photo-1',
        referenceAssets: mockAssets,
      })

      const testing = transitionToTesting(initial)
      expect(testing.lifecycleStatus).toBe('TESTING')
      expect(testing.testRunsCount).toBe(1)
      expect(testing.testBatch.length).toBeGreaterThanOrEqual(2)
    })

    it('records user feedback evidence on test variations', () => {
      const testing = transitionToTesting(
        createConversationalImageHarness({
          workspaceId: 'ws-photo-1',
          referenceAssets: mockAssets,
        })
      )

      const variationId = testing.testBatch[0].id
      const withFeedback = recordTestFeedback(testing, variationId, 'THUMBS_UP', '원목 색감이 아주 마음에 들어요')

      expect(withFeedback.userFeedbackEvidence.length).toBe(1)
      expect(withFeedback.userFeedbackEvidence[0].variationId).toBe(variationId)
      expect(withFeedback.userFeedbackEvidence[0].feedback).toBe('THUMBS_UP')
      expect(withFeedback.userFeedbackEvidence[0].note).toContain('원목 색감')
    })

    it('transitions to GOLDEN_SELECTED when exactly 3 to 5 golden images are selected', () => {
      const testing = transitionToTesting(
        createConversationalImageHarness({
          workspaceId: 'ws-photo-1',
          referenceAssets: mockAssets,
        })
      )

      const goldenSelected = selectGoldenImages(testing, ['ref-1', 'ref-2', 'ref-3'])
      expect(goldenSelected.lifecycleStatus).toBe('GOLDEN_SELECTED')
      expect(goldenSelected.goldenImageIds).toEqual(['ref-1', 'ref-2', 'ref-3'])
    })
  })

  describe('3. Invariant Guards: Golden Count, Rights/Consent & Explicit Confirm Gate', () => {
    const mockAssets: ConversationalImageReferenceAsset[] = [
      {
        id: 'ref-1',
        url: 'https://cdn.example.com/ref1.jpg',
        category: 'STORE_INTERIOR',
        rightsStatus: 'OWNED',
        consentStatus: 'NOT_APPLICABLE',
        rightsConfirmedAt: '2026-09-14T00:00:00.000Z',
      },
      {
        id: 'ref-2',
        url: 'https://cdn.example.com/ref2.jpg',
        category: 'SIGNATURE_MENU',
        rightsStatus: 'OWNED',
        consentStatus: 'NOT_APPLICABLE',
        rightsConfirmedAt: '2026-09-14T00:00:00.000Z',
      },
      {
        id: 'ref-3',
        url: 'https://cdn.example.com/ref3.jpg',
        category: 'ATMOSPHERE',
        rightsStatus: 'USER_CONFIRMED',
        consentStatus: 'NOT_APPLICABLE',
        rightsConfirmedAt: '2026-09-14T00:00:00.000Z',
      },
      {
        id: 'ref-4',
        url: 'https://cdn.example.com/ref4.jpg',
        category: 'STORE_EXTERIOR',
        rightsStatus: 'OWNED',
        consentStatus: 'NOT_APPLICABLE',
        rightsConfirmedAt: '2026-09-14T00:00:00.000Z',
      },
      {
        id: 'ref-5',
        url: 'https://cdn.example.com/ref5.jpg',
        category: 'PRODUCT',
        rightsStatus: 'OWNED',
        consentStatus: 'NOT_APPLICABLE',
        rightsConfirmedAt: '2026-09-14T00:00:00.000Z',
      },
      {
        id: 'ref-6',
        url: 'https://cdn.example.com/ref6.jpg',
        category: 'STORE_INTERIOR',
        rightsStatus: 'OWNED',
        consentStatus: 'NOT_APPLICABLE',
        rightsConfirmedAt: '2026-09-14T00:00:00.000Z',
      },
    ]

    it('strictly rejects golden selection if less than 3 images are chosen', () => {
      const testing = transitionToTesting(
        createConversationalImageHarness({
          workspaceId: 'ws-photo-1',
          referenceAssets: mockAssets,
        })
      )

      expect(() => selectGoldenImages(testing, ['ref-1', 'ref-2'])).toThrowError(
        /INSUFFICIENT_GOLDEN_IMAGES.*최소 3장/
      )
    })

    it('strictly rejects golden selection if more than 5 images are chosen', () => {
      const testing = transitionToTesting(
        createConversationalImageHarness({
          workspaceId: 'ws-photo-1',
          referenceAssets: mockAssets,
        })
      )

      expect(() =>
        selectGoldenImages(testing, ['ref-1', 'ref-2', 'ref-3', 'ref-4', 'ref-5', 'ref-6'])
      ).toThrowError(/EXCESS_GOLDEN_IMAGES.*최대 5장/)
    })

    it('strictly blocks confirmation if rightsStatus is UNKNOWN or PROHIBITED', () => {
      const unownedAsset: ConversationalImageReferenceAsset = {
        id: 'ref-unowned',
        url: 'https://cdn.example.com/unowned.jpg',
        category: 'STORE_INTERIOR',
        rightsStatus: 'UNKNOWN',
        consentStatus: 'NOT_APPLICABLE',
      }

      const harness = selectGoldenImages(
        transitionToTesting(
          createConversationalImageHarness({
            workspaceId: 'ws-photo-1',
            referenceAssets: [mockAssets[0], mockAssets[1], unownedAsset],
          })
        ),
        ['ref-1', 'ref-2', 'ref-unowned']
      )

      expect(() =>
        confirmConversationalImageHarness({
          harness,
          userId: 'user-1',
          explicitApprovalPhrase: '이 기준으로 사용',
          isExplicitlyApproved: true,
        })
      ).toThrowError(/RIGHTS_UNCONFIRMED/)
    })

    it('strictly blocks confirmation if likeness consent is REQUIRED_MISSING', () => {
      const portraitWithoutConsent: ConversationalImageReferenceAsset = {
        id: 'ref-portrait',
        url: 'https://cdn.example.com/portrait.jpg',
        category: 'STORE_INTERIOR',
        rightsStatus: 'OWNED',
        rightsConfirmedAt: '2026-09-14T00:00:00.000Z',
        consentStatus: 'REQUIRED_MISSING',
      }

      const harness = selectGoldenImages(
        transitionToTesting(
          createConversationalImageHarness({
            workspaceId: 'ws-photo-1',
            referenceAssets: [mockAssets[0], mockAssets[1], portraitWithoutConsent],
          })
        ),
        ['ref-1', 'ref-2', 'ref-portrait']
      )

      expect(() =>
        confirmConversationalImageHarness({
          harness,
          userId: 'user-1',
          explicitApprovalPhrase: '이 기준으로 사용',
          isExplicitlyApproved: true,
        })
      ).toThrowError(/CONSENT_MISSING/)
    })

    it('strictly blocks confirmation without explicit "이 기준으로 사용" confirmation', () => {
      const readyHarness = selectGoldenImages(
        transitionToTesting(
          createConversationalImageHarness({
            workspaceId: 'ws-photo-1',
            referenceAssets: mockAssets,
          })
        ),
        ['ref-1', 'ref-2', 'ref-3']
      )

      expect(() =>
        confirmConversationalImageHarness({
          harness: readyHarness,
          userId: 'user-1',
          explicitApprovalPhrase: '괜찮은 것 같아',
          isExplicitlyApproved: false,
        })
      ).toThrowError(/EXPLICIT_CONFIRMATION_REQUIRED.*이 기준으로 사용/)
    })

    it('successfully confirms into an immutable deep-frozen snapshot when all invariants pass', () => {
      const readyHarness = selectGoldenImages(
        transitionToTesting(
          createConversationalImageHarness({
            workspaceId: 'ws-photo-1',
            referenceAssets: mockAssets,
          })
        ),
        ['ref-1', 'ref-2', 'ref-3']
      )

      const snapshot = confirmConversationalImageHarness({
        harness: readyHarness,
        userId: 'user-owner-1',
        explicitApprovalPhrase: '이 기준으로 사용',
        isExplicitlyApproved: true,
      })

      expect(snapshot.status).toBe('ACTIVE_CONFIRMED')
      expect(snapshot.isImmutable).toBe(true)
      expect(snapshot.confirmedByUserId).toBe('user-owner-1')
      expect(snapshot.goldenImageIds.length).toBe(3)
      expect(Object.isFrozen(snapshot)).toBe(true)
      expect(Object.isFrozen(snapshot.goldenImageIds)).toBe(true)
      expect(Object.isFrozen(snapshot.rules)).toBe(true)
    })
  })

  describe('4. Media Harness Lineage & Provenance Integrity', () => {
    it('creates immutable media harness lineage linking image harness, golden references, and prompt fingerprint', () => {
      const mockAssets: ConversationalImageReferenceAsset[] = [
        {
          id: 'ref-1',
          url: 'https://cdn.example.com/ref1.jpg',
          category: 'STORE_INTERIOR',
          rightsStatus: 'OWNED',
          consentStatus: 'NOT_APPLICABLE',
          rightsConfirmedAt: '2026-09-14T00:00:00.000Z',
        },
        {
          id: 'ref-2',
          url: 'https://cdn.example.com/ref2.jpg',
          category: 'SIGNATURE_MENU',
          rightsStatus: 'OWNED',
          consentStatus: 'NOT_APPLICABLE',
          rightsConfirmedAt: '2026-09-14T00:00:00.000Z',
        },
        {
          id: 'ref-3',
          url: 'https://cdn.example.com/ref3.jpg',
          category: 'ATMOSPHERE',
          rightsStatus: 'USER_CONFIRMED',
          consentStatus: 'NOT_APPLICABLE',
          rightsConfirmedAt: '2026-09-14T00:00:00.000Z',
        },
      ]

      const snapshot = confirmConversationalImageHarness({
        harness: selectGoldenImages(
          transitionToTesting(
            createConversationalImageHarness({
              workspaceId: 'ws-photo-1',
              referenceAssets: mockAssets,
            })
          ),
          ['ref-1', 'ref-2', 'ref-3']
        ),
        userId: 'user-owner-1',
        explicitApprovalPhrase: '이 기준으로 사용',
        isExplicitlyApproved: true,
      })

      const lineage = createMediaHarnessLineage({
        mediaAssetId: 'gen-media-101',
        harnessSnapshot: snapshot,
        prompt: 'Warm natural light, bakery counter with fresh sourdough',
        provider: 'gemini-imagen-3',
      })

      expect(lineage.mediaAssetId).toBe('gen-media-101')
      expect(lineage.workspaceId).toBe('ws-photo-1')
      expect(lineage.imageHarnessVersionId).toBe(snapshot.id)
      expect(lineage.goldenAssetIds).toEqual(['ref-1', 'ref-2', 'ref-3'])
      expect(lineage.rightsStatus).toBe('OWNED')
      expect(lineage.consentStatus).toBe('NOT_APPLICABLE')
      expect(lineage.promptFingerprint).toBeDefined()
      expect(lineage.immutableHash).toMatch(/^[a-f0-9]{32,64}$/)
    })

    it('strictly throws GOLDEN_ASSET_NOT_FOUND when golden ID is missing from reference assets', () => {
      const mockAssets: ConversationalImageReferenceAsset[] = [
        {
          id: 'ref-1',
          url: 'https://cdn.example.com/ref1.jpg',
          category: 'STORE_INTERIOR',
          rightsStatus: 'OWNED',
          consentStatus: 'NOT_APPLICABLE',
          rightsConfirmedAt: '2026-09-14T00:00:00.000Z',
        },
        {
          id: 'ref-2',
          url: 'https://cdn.example.com/ref2.jpg',
          category: 'SIGNATURE_MENU',
          rightsStatus: 'OWNED',
          consentStatus: 'NOT_APPLICABLE',
          rightsConfirmedAt: '2026-09-14T00:00:00.000Z',
        },
      ]

      const harness: ConversationalImageHarnessState = {
        id: 'h-test',
        workspaceId: 'ws-1',
        lifecycleStatus: 'GOLDEN_SELECTED',
        referenceAssets: mockAssets,
        goldenImageIds: ['ref-1', 'ref-2', 'ref-nonexistent'],
        visualRules: {
          modelPresence: 'MODEL_ABSENT',
          location: '매장',
          composition: '정면',
          lighting: '자연광',
          colorTone: '따뜻한',
          background: '원목',
          exposure: '자연스러운',
          forbiddenElements: ['왜곡'],
          channelRatio: 'SQUARE_1_1',
        },
        testRunsCount: 1,
        testBatch: [],
        userFeedbackEvidence: [],
      }

      expect(() =>
        confirmConversationalImageHarness({
          harness,
          userId: 'user-1',
          explicitApprovalPhrase: '이 기준으로 사용',
          isExplicitlyApproved: true,
        })
      ).toThrowError(/GOLDEN_ASSET_NOT_FOUND/)
    })
  })
})
