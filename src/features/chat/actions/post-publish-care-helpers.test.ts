import { describe, expect, it } from 'vitest'
import {
  loadPostPublishCareInputSchema,
  mapPostPublishCareState,
  updatePostPublishCareInputSchema,
} from './post-publish-care-helpers'

describe('post-publish-care-helpers', () => {
  const workspaceId = '00000000-0000-4000-8000-000000000001'

  describe('mapPostPublishCareState', () => {
    it('maps null policy, empty rules, and null credential to truthful contract', () => {
      const state = mapPostPublishCareState({
        workspaceId,
        channel: 'instagram',
        policy: null,
        rules: [],
        credential: null,
      })

      expect(state.workspaceId).toBe(workspaceId)
      expect(state.channel).toBe('instagram')
      expect(state.comment_watch).toEqual({
        enabled: false,
        available: true,
        reason: null,
      })
      expect(state.reaction_report).toEqual({
        enabled: false,
        available: false,
        reason: '자동화 설정(/app/account/automation)에서 성과 보고 규칙을 먼저 등록해 주세요',
        needsSetup: true,
      })
      expect(state.always_on.dm).toEqual({
        active: false,
        reason: '인스타그램 계정이 연동되어 있지 않아요',
      })
      expect(state.always_on.booking_inquiry).toEqual({
        active: false,
        reason: '인스타그램 계정이 연동되어 있지 않아요',
      })
    })

    it('threads channel sets always_on.dm to active: false with exact explanation', () => {
      const state = mapPostPublishCareState({
        workspaceId,
        channel: 'threads',
        policy: { is_paused: false },
        rules: [],
        credential: {
          status: 'active',
          granted_scopes: ['threads_basic', 'threads_read_replies'],
        },
      })

      expect(state.always_on.dm).toEqual({
        active: false,
        reason: '스레드는 DM 기능을 지원하지 않아요',
      })
      expect(state.always_on.booking_inquiry).toEqual({
        active: true,
        reason: null,
      })
      expect(state.comment_watch.enabled).toBe(true)
    })

    it('derives always_on.dm and booking_inquiry from real instagram credential evidence', () => {
      const stateWithScopes = mapPostPublishCareState({
        workspaceId,
        channel: 'instagram',
        policy: { is_paused: false },
        rules: [{ kind: 'daily_performance_report', active: true }],
        credential: {
          status: 'active',
          granted_scopes: [
            'instagram_business_basic',
            'instagram_business_manage_messages',
            'instagram_business_manage_comments',
          ],
        },
      })

      expect(stateWithScopes.always_on.dm).toEqual({
        active: true,
        reason: null,
      })
      expect(stateWithScopes.always_on.booking_inquiry).toEqual({
        active: true,
        reason: null,
      })
      expect(stateWithScopes.reaction_report).toEqual({
        enabled: true,
        available: true,
        reason: null,
        needsSetup: false,
      })
    })

    it('sets always_on.dm to inactive when manage_messages scope is missing', () => {
      const stateWithoutDmScope = mapPostPublishCareState({
        workspaceId,
        channel: 'instagram',
        policy: { is_paused: false },
        rules: [],
        credential: {
          status: 'active',
          granted_scopes: ['instagram_business_basic', 'instagram_business_manage_comments'],
        },
      })

      expect(stateWithoutDmScope.always_on.dm).toEqual({
        active: false,
        reason: '인스타그램 DM 관리 권한(instagram_business_manage_messages)이 연동되어 있지 않아요',
      })
      // booking inquiry is still active via comments scope
      expect(stateWithoutDmScope.always_on.booking_inquiry).toEqual({
        active: true,
        reason: null,
      })
    })
  })

  describe('schema validation', () => {
    it('validates load input', () => {
      expect(
        loadPostPublishCareInputSchema.safeParse({
          workspaceId,
          channel: 'instagram',
        }).success,
      ).toBe(true)

      expect(
        loadPostPublishCareInputSchema.safeParse({
          workspaceId,
          channel: 'threads',
        }).success,
      ).toBe(true)

      expect(
        loadPostPublishCareInputSchema.safeParse({
          workspaceId: 'bad-id',
          channel: 'instagram',
        }).success,
      ).toBe(false)
    })

    it('validates update input for allowed keys (comment_watch, reaction_report)', () => {
      expect(
        updatePostPublishCareInputSchema.safeParse({
          workspaceId,
          channel: 'instagram',
          key: 'comment_watch',
          enabled: true,
        }).success,
      ).toBe(true)

      expect(
        updatePostPublishCareInputSchema.safeParse({
          workspaceId,
          channel: 'instagram',
          key: 'reaction_report',
          enabled: true,
        }).success,
      ).toBe(true)
    })

    it('strictly rejects write attempts for dm_watch and booking_inquiry_watch', () => {
      expect(
        updatePostPublishCareInputSchema.safeParse({
          workspaceId,
          channel: 'instagram',
          key: 'dm_watch',
          enabled: true,
        }).success,
      ).toBe(false)

      expect(
        updatePostPublishCareInputSchema.safeParse({
          workspaceId,
          channel: 'instagram',
          key: 'booking_inquiry_watch',
          enabled: true,
        }).success,
      ).toBe(false)
    })

    it('strictly rejects unexpected fields', () => {
      expect(
        updatePostPublishCareInputSchema.safeParse({
          workspaceId,
          channel: 'instagram',
          key: 'comment_watch',
          enabled: true,
          autonomy_level: 'L3_AUTONOMOUS',
        }).success,
      ).toBe(false)
    })
  })
})
