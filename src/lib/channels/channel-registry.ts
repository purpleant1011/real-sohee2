/**
 * Sohee V0.8.9 Channel Registry & Capability Matrix
 * 
 * Defines:
 * 1. The 4 official marketing channels: Instagram, Threads, Naver Blog, Daangn.
 * 2. Execution planes: Meta API Gateway vs Cloud Browser Agent.
 * 3. Granular action capabilities and delegation permissions.
 */

export type ChannelId = 'INSTAGRAM' | 'THREADS' | 'NAVER_BLOG' | 'DAANGN';

export type ExecutionPlaneType = 'META_API_GATEWAY' | 'CLOUD_BROWSER_AGENT';

export type ChannelActionCapability =
  | 'PUBLISH_FEED'
  | 'PUBLISH_CAROUSEL'
  | 'PUBLISH_ARTICLE'
  | 'REPLY_COMMENT'
  | 'REPLY_DM'
  | 'REPLY_CHAT'
  | 'FETCH_INSIGHTS'
  | 'FETCH_INBOX';

export type ChannelConnectionStatus =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'REAUTH_REQUIRED'
  | 'SUSPENDED'
  | 'RATE_LIMITED';

export interface ChannelDefinition {
  id: ChannelId;
  displayName: string;
  category: 'SNS' | 'BLOG' | 'COMMUNITY';
  executionPlane: ExecutionPlaneType;
  supportedCapabilities: ChannelActionCapability[];
  requiresOAuth: boolean;
  requiresBrowserSession: boolean;
  officialApiAvailable: boolean;
  description: string;
}

export const OFFICIAL_CHANNELS: Record<ChannelId, ChannelDefinition> = {
  INSTAGRAM: {
    id: 'INSTAGRAM',
    displayName: '인스타그램 (Instagram)',
    category: 'SNS',
    executionPlane: 'META_API_GATEWAY',
    supportedCapabilities: [
      'PUBLISH_FEED',
      'PUBLISH_CAROUSEL',
      'REPLY_COMMENT',
      'REPLY_DM',
      'FETCH_INSIGHTS',
      'FETCH_INBOX'
    ],
    requiresOAuth: true,
    requiresBrowserSession: false,
    officialApiAvailable: true,
    description: 'Meta Graph API를 통한 피드/릴스/캐러셀 공식 발행 및 댓글·DM 응대 지원'
  },
  THREADS: {
    id: 'THREADS',
    displayName: '스레드 (Threads)',
    category: 'SNS',
    executionPlane: 'META_API_GATEWAY',
    supportedCapabilities: [
      'PUBLISH_FEED',
      'REPLY_COMMENT',
      'FETCH_INSIGHTS'
    ],
    requiresOAuth: true,
    requiresBrowserSession: false,
    officialApiAvailable: true,
    description: 'Threads API를 통한 빠른 단문 소통, 실시간 트렌드 포스팅 및 답글 소통'
  },
  NAVER_BLOG: {
    id: 'NAVER_BLOG',
    displayName: '네이버 블로그 (Naver Blog)',
    category: 'BLOG',
    executionPlane: 'CLOUD_BROWSER_AGENT',
    supportedCapabilities: [
      'PUBLISH_ARTICLE',
      'FETCH_INSIGHTS'
    ],
    requiresOAuth: false,
    requiresBrowserSession: true,
    officialApiAvailable: false,
    description: 'SEO 최적화 장문 원고 준비 및 네이버 블로그 포스팅 지원'
  },
  DAANGN: {
    id: 'DAANGN',
    displayName: '당근 비즈프로필 (Daangn)',
    category: 'COMMUNITY',
    executionPlane: 'CLOUD_BROWSER_AGENT',
    supportedCapabilities: [
      'PUBLISH_FEED',
      'REPLY_CHAT',
      'FETCH_INSIGHTS'
    ],
    requiresOAuth: false,
    requiresBrowserSession: true,
    officialApiAvailable: false,
    description: '동네 상권 타깃팅 소식 원고 준비 및 당근 비즈프로필 고객 소통 지원'
  }
};

export interface WorkspaceChannelState {
  channelId: ChannelId;
  workspaceId: string;
  status: ChannelConnectionStatus;
  externalAccountId?: string;
  externalAccountName?: string;
  connectedAt?: string;
  lastVerifiedAt?: string;
  lastActionAt?: string;
  delegatedCapabilities: ChannelActionCapability[];
  isAutonomyEnabled: boolean;
  healthScore: number; // 0 ~ 100
}
