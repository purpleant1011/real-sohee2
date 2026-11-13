/**
 * SOHEE Harness Knowledge OS — Platform Capability Registry (v1.1)
 * Enforces:
 * 1. Separation between Harness (HOW) and Connector Capability (WHAT CAN BE EXECUTED)
 * 2. OAuth Scope & Session Degradation Guard (AC-21, AC-22)
 * 3. Naver Blog BROWSER_AUTOMATION / Non-official Risk Model
 */

import { PlatformType, AcquisitionMethod, AutonomyMode } from '@/types/harness'

export type ChannelAction =
  | 'analyze_public_profile'
  | 'read_own_posts'
  | 'read_comments'
  | 'reply_comment'
  | 'receive_dm'
  | 'send_dm'
  | 'publish_text'
  | 'publish_image'
  | 'publish_carousel'
  | 'publish_reel'
  | 'read_insights'

export interface CapabilityRule {
  platform: PlatformType
  connectorType: AcquisitionMethod
  requiredScopes: string[]
  supportedActions: ChannelAction[]
  riskTier: 'LOW' | 'MEDIUM' | 'HIGH'
  isOfficialApi: boolean
  rateLimitPerDay: number
}

export class PlatformCapabilityRegistry {
  private capabilities: Map<PlatformType, CapabilityRule> = new Map([
    [
      'instagram',
      {
        platform: 'instagram',
        connectorType: 'OFFICIAL_API',
        requiredScopes: ['instagram_basic', 'instagram_content_publish', 'pages_show_list'],
        supportedActions: [
          'analyze_public_profile',
          'read_own_posts',
          'read_comments',
          'reply_comment',
          'publish_image',
          'publish_carousel',
          'publish_reel',
          'read_insights'
        ],
        riskTier: 'LOW',
        isOfficialApi: true,
        rateLimitPerDay: 50
      }
    ],
    [
      'threads',
      {
        platform: 'threads',
        connectorType: 'OFFICIAL_API',
        requiredScopes: ['threads_basic', 'threads_content_publish'],
        supportedActions: [
          'read_own_posts',
          'read_comments',
          'reply_comment',
          'publish_text',
          'publish_image',
          'read_insights'
        ],
        riskTier: 'LOW',
        isOfficialApi: true,
        rateLimitPerDay: 100
      }
    ],
    [
      'naver_blog',
      {
        platform: 'naver_blog',
        connectorType: 'BROWSER_AUTOMATION',
        requiredScopes: ['browser_session'],
        supportedActions: ['publish_text', 'publish_image'],
        riskTier: 'HIGH',
        isOfficialApi: false, // Closed since May 6, 2020
        rateLimitPerDay: 10
      }
    ]
  ])

  public checkCapability(
    platform: PlatformType,
    action: ChannelAction,
    isSessionActive: boolean = true
  ): {
    canExecute: boolean
    reason?: string
  } {
    if (!isSessionActive) {
      return { canExecute: false, reason: 'SESSION_OR_OAUTH_EXPIRED' }
    }

    const rule = this.capabilities.get(platform)
    if (!rule) {
      return { canExecute: false, reason: `UNSUPPORTED_PLATFORM: ${platform}` }
    }

    if (!rule.supportedActions.includes(action)) {
      return {
        canExecute: false,
        reason: `ACTION_NOT_SUPPORTED_ON_PLATFORM: ${action} on ${platform}`
      }
    }

    return { canExecute: true }
  }
}

export const platformCapabilityRegistry = new PlatformCapabilityRegistry()
