import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  REQUIRED_PUBLISH_SCOPES,
  missingPublishScopes,
} from './required-publish-scopes'
import { evaluateCapability } from '@/features/capabilities/registry'
import {
  CANONICAL_META_CAPABILITIES,
  evaluateCapabilityState,
  type CapabilityEvaluationContext,
} from './meta-capability-registry'

describe('required-publish-scopes', () => {
  it('defines the required scopes for Instagram and Threads', () => {
    expect(REQUIRED_PUBLISH_SCOPES.instagram).toEqual([
      'instagram_business_basic',
      'instagram_business_content_publish',
    ])
    expect(REQUIRED_PUBLISH_SCOPES.threads).toEqual([
      'threads_basic',
      'threads_content_publish',
    ])
  })

  it('missingPublishScopes returns empty array when all scopes are granted', () => {
    expect(
      missingPublishScopes('threads', [
        'threads_basic',
        'threads_content_publish',
      ]),
    ).toEqual([])
    expect(
      missingPublishScopes('instagram', [
        'instagram_business_basic',
        'instagram_business_content_publish',
      ]),
    ).toEqual([])
  })

  it('missingPublishScopes detects missing publish scopes (e.g. content_publish missing)', () => {
    expect(missingPublishScopes('threads', ['threads_basic'])).toEqual(['threads_content_publish'])
    expect(missingPublishScopes('instagram', ['instagram_business_basic'])).toEqual([
      'instagram_business_content_publish',
    ])
  })

  it('missingPublishScopes returns all required scopes when grantedScopes is null or empty', () => {
    expect(missingPublishScopes('threads', null)).toEqual([...REQUIRED_PUBLISH_SCOPES.threads])
    expect(missingPublishScopes('threads', [])).toEqual([...REQUIRED_PUBLISH_SCOPES.threads])
    expect(missingPublishScopes('instagram', undefined)).toEqual([...REQUIRED_PUBLISH_SCOPES.instagram])
  })

  it('missingPublishScopes returns empty array for other channels', () => {
    expect(missingPublishScopes('naver_blog', [])).toEqual([])
    expect(missingPublishScopes('unknown', [])).toEqual([])
  })

  it('matches the SQL function text in supabase/migrations to prevent drift', () => {
    const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations')
    const files = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort()

    // Find the latest migration defining claim_publish_schedule
    const claimScheduleMigrations = files.filter((file) => {
      const content = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
      return content.includes('claim_publish_schedule')
    })
    expect(claimScheduleMigrations.length).toBeGreaterThan(0)
    const latestScheduleMigration = claimScheduleMigrations[claimScheduleMigrations.length - 1]!
    const sqlContent = fs.readFileSync(path.join(migrationsDir, latestScheduleMigration), 'utf-8')

    // Parse: when 'instagram' then array['...']
    const igMatch = sqlContent.match(/when\s+'instagram'\s+then\s+array\[([^\]]+)\]/i)
    expect(igMatch).not.toBeNull()
    const igScopes = igMatch![1]!
      .split(',')
      .map((s) => s.replace(/['"\s]/g, ''))
      .filter(Boolean)
    expect(igScopes).toEqual([...REQUIRED_PUBLISH_SCOPES.instagram])

    // Parse: when 'threads' then array['...']
    const threadsMatch = sqlContent.match(/when\s+'threads'\s+then\s+array\[([^\]]+)\]/i)
    expect(threadsMatch).not.toBeNull()
    const threadsScopes = threadsMatch![1]!
      .split(',')
      .map((s) => s.replace(/['"\s]/g, ''))
      .filter(Boolean)
    expect(threadsScopes).toEqual([...REQUIRED_PUBLISH_SCOPES.threads])
  })

  describe('regression: credential with only 2 publish scopes can publish but cannot access replies/insights', () => {
    const workspaceId = '30000000-0000-4000-8000-000000000001'
    const now = new Date('2026-11-04T12:00:00Z')
    const env = {
      NODE_ENV: 'production',
      META_LIVE_WORKSPACE_ALLOWLIST: workspaceId,
      ENGAGEMENT_WORKSPACE_ALLOWLIST: workspaceId,
      ENGAGEMENT_SEND_ENABLED: '1',
    }

    const baseContext: CapabilityEvaluationContext = {
      hasConnection: true,
      connectionStatus: 'connected',
      tokenScopes: [],
      hasWebhookSubscription: true,
      hasConsent: true,
      hasAutonomousConsent: false,
      hasRuntimeTool: true,
      isKillSwitchBlocked: false,
      accessGateAllowed: true,
      proofCount: 0,
      lastReceiptAt: null,
    }

    it('Threads: credential with only [threads_basic, threads_content_publish] can publish but reply/insights remain blocked', () => {
      const threadsScopes = ['threads_basic', 'threads_content_publish']
      // 1. Publish scopes are fully satisfied
      expect(missingPublishScopes('threads', threadsScopes)).toEqual([])

      // 2. Action capability registry: publish is ready
      const publishDecision = evaluateCapability({
        workspaceId,
        provider: 'threads',
        action: 'publish',
        permission: {
          workspaceId,
          provider: 'threads',
          connected: true,
          grantedScopes: threadsScopes,
          verifiedAt: '2026-11-04T10:00:00Z',
          expiresAt: '2026-11-05T10:00:00Z',
        },
        env,
        now,
      })
      expect(publishDecision.ready).toBe(true)

      // 3. Action capability registry: reply is blocked due to SCOPE_MISSING (needs threads_manage_replies)
      const replyDecision = evaluateCapability({
        workspaceId,
        provider: 'threads',
        action: 'reply',
        permission: {
          workspaceId,
          provider: 'threads',
          connected: true,
          grantedScopes: threadsScopes,
          verifiedAt: '2026-11-04T10:00:00Z',
          expiresAt: '2026-11-05T10:00:00Z',
        },
        env,
        now,
      })
      expect(replyDecision.ready).toBe(false)
      expect(replyDecision.reason).toBe('SCOPE_MISSING')

      // 4. Meta capability registry: individual capability states
      const threadsPostPublish = CANONICAL_META_CAPABILITIES.find((c) => c.id === 'threads_post_publish')!
      const threadsReply = CANONICAL_META_CAPABILITIES.find((c) => c.id === 'threads_reply')!
      const threadsMentions = CANONICAL_META_CAPABILITIES.find((c) => c.id === 'threads_mentions')!
      const threadsInsights = CANONICAL_META_CAPABILITIES.find((c) => c.id === 'threads_insights')!

      const contextWithPublishScopes = { ...baseContext, tokenScopes: threadsScopes }

      expect(evaluateCapabilityState(threadsPostPublish, contextWithPublishScopes).isExecutable).toBe(true)
      expect(evaluateCapabilityState(threadsReply, contextWithPublishScopes)).toMatchObject({
        isExecutable: false,
        failureCode: 'SCOPE_DRIFT',
      })
      expect(evaluateCapabilityState(threadsMentions, contextWithPublishScopes)).toMatchObject({
        isExecutable: false,
        failureCode: 'SCOPE_DRIFT',
      })
      expect(evaluateCapabilityState(threadsInsights, contextWithPublishScopes)).toMatchObject({
        isExecutable: false,
        failureCode: 'SCOPE_DRIFT',
      })
    })

    it('Instagram: credential with only [instagram_business_basic, instagram_business_content_publish] can publish but comments/DMs/insights remain blocked', () => {
      const igScopes = ['instagram_business_basic', 'instagram_business_content_publish']
      // 1. Publish scopes are fully satisfied
      expect(missingPublishScopes('instagram', igScopes)).toEqual([])

      // 2. Action capability registry: publish is ready
      const publishDecision = evaluateCapability({
        workspaceId,
        provider: 'instagram',
        action: 'publish',
        permission: {
          workspaceId,
          provider: 'instagram',
          connected: true,
          grantedScopes: igScopes,
          verifiedAt: '2026-11-04T10:00:00Z',
          expiresAt: '2026-11-05T10:00:00Z',
        },
        env,
        now,
      })
      expect(publishDecision.ready).toBe(true)

      // 3. Action capability registry: reply & message are blocked due to SCOPE_MISSING
      const replyDecision = evaluateCapability({
        workspaceId,
        provider: 'instagram',
        action: 'reply',
        permission: {
          workspaceId,
          provider: 'instagram',
          connected: true,
          grantedScopes: igScopes,
          verifiedAt: '2026-11-04T10:00:00Z',
          expiresAt: '2026-11-05T10:00:00Z',
        },
        env,
        now,
      })
      expect(replyDecision.ready).toBe(false)
      expect(replyDecision.reason).toBe('SCOPE_MISSING')

      const messageDecision = evaluateCapability({
        workspaceId,
        provider: 'instagram',
        action: 'message',
        permission: {
          workspaceId,
          provider: 'instagram',
          connected: true,
          grantedScopes: igScopes,
          verifiedAt: '2026-11-04T10:00:00Z',
          expiresAt: '2026-11-05T10:00:00Z',
        },
        env,
        now,
      })
      expect(messageDecision.ready).toBe(false)
      expect(messageDecision.reason).toBe('SCOPE_MISSING')

      // 4. Meta capability registry: individual capability states
      const igPublish = CANONICAL_META_CAPABILITIES.find((c) => c.id === 'instagram_feed_publish')!
      const igCommentReply = CANONICAL_META_CAPABILITIES.find((c) => c.id === 'instagram_comment_reply')!
      const igDmReply = CANONICAL_META_CAPABILITIES.find((c) => c.id === 'instagram_dm_reply')!
      const igInsights = CANONICAL_META_CAPABILITIES.find((c) => c.id === 'instagram_insights')!

      const contextWithPublishScopes = { ...baseContext, tokenScopes: igScopes }

      expect(evaluateCapabilityState(igPublish, contextWithPublishScopes).isExecutable).toBe(true)
      expect(evaluateCapabilityState(igCommentReply, contextWithPublishScopes)).toMatchObject({
        isExecutable: false,
        failureCode: 'SCOPE_DRIFT',
      })
      expect(evaluateCapabilityState(igDmReply, contextWithPublishScopes)).toMatchObject({
        isExecutable: false,
        failureCode: 'SCOPE_DRIFT',
      })
      expect(evaluateCapabilityState(igInsights, contextWithPublishScopes)).toMatchObject({
        isExecutable: false,
        failureCode: 'SCOPE_DRIFT',
      })
    })
  })
})
