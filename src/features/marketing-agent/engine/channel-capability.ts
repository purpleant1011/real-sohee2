import { ChannelCapability, ChannelKey } from "../types";

export const DEFAULT_CHANNEL_REGISTRY: Record<ChannelKey, ChannelCapability> = {
  instagram: {
    channelKey: "instagram",
    channelDisplayName: "Instagram",
    connected: true,
    isTokenExpiringSoon: false,
    webhookActive: true,
    capabilities: {
      publishPost: "api_direct",
      schedulePost: "api_direct",
      replyComments: "api_direct",
      sendDirectMessage: "assisted_export", // 메타 정책상 DM 발송은 승인 및 사용자 보조
      replyReviews: "unsupported",
      collectAnalytics: "api_direct",
      manageProfile: "api_direct",
    },
    lastHealthCheck: new Date().toISOString(),
    healthStatus: "healthy",
    statusMessage: "정상 연동 중",
  },
  threads: {
    channelKey: "threads",
    channelDisplayName: "Threads",
    connected: true,
    isTokenExpiringSoon: false,
    webhookActive: true,
    capabilities: {
      publishPost: "api_direct",
      schedulePost: "api_direct",
      replyComments: "api_direct",
      sendDirectMessage: "unsupported",
      replyReviews: "unsupported",
      collectAnalytics: "api_direct",
      manageProfile: "api_direct",
    },
    lastHealthCheck: new Date().toISOString(),
    healthStatus: "healthy",
    statusMessage: "정상 연동 중",
  },
  naver_blog: {
    channelKey: "naver_blog",
    channelDisplayName: "Naver Blog",
    connected: true,
    isTokenExpiringSoon: false,
    webhookActive: false,
    capabilities: {
      publishPost: "browser_connector",
      schedulePost: "browser_connector",
      replyComments: "assisted_export",
      sendDirectMessage: "unsupported",
      replyReviews: "unsupported",
      collectAnalytics: "browser_connector",
      manageProfile: "unsupported",
    },
    lastHealthCheck: new Date().toISOString(),
    healthStatus: "healthy",
    statusMessage: "로컬 커넥터 연동됨",
  },
  naver_place: {
    channelKey: "naver_place",
    channelDisplayName: "Naver Place",
    connected: true,
    tokenExpiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    isTokenExpiringSoon: true, // 2일 후 만료
    webhookActive: true,
    capabilities: {
      publishPost: "browser_connector",
      schedulePost: "unsupported",
      replyComments: "unsupported",
      sendDirectMessage: "unsupported",
      replyReviews: "assisted_export",
      collectAnalytics: "browser_connector",
      manageProfile: "assisted_export",
    },
    lastHealthCheck: new Date().toISOString(),
    healthStatus: "warning",
    statusMessage: "권한이 2일 뒤 만료돼요 (재인증 필요)",
  },
  daangn: {
    channelKey: "daangn",
    channelDisplayName: "당근 비즈프로필",
    connected: true,
    isTokenExpiringSoon: false,
    webhookActive: false,
    capabilities: {
      publishPost: "browser_connector",
      schedulePost: "assisted_export",
      replyComments: "assisted_export",
      sendDirectMessage: "assisted_export",
      replyReviews: "assisted_export",
      collectAnalytics: "browser_connector",
      manageProfile: "unsupported",
    },
    lastHealthCheck: new Date().toISOString(),
    healthStatus: "healthy",
    statusMessage: "정상 연동 중",
  },
  kakaotalk_channel: {
    channelKey: "kakaotalk_channel",
    channelDisplayName: "카카오톡 채널",
    connected: true,
    isTokenExpiringSoon: false,
    webhookActive: true,
    capabilities: {
      publishPost: "assisted_export",
      schedulePost: "assisted_export",
      replyComments: "unsupported",
      sendDirectMessage: "api_direct", // 알림톡/친구톡 API
      replyReviews: "unsupported",
      collectAnalytics: "api_direct",
      manageProfile: "assisted_export",
    },
    lastHealthCheck: new Date().toISOString(),
    healthStatus: "healthy",
    statusMessage: "메시지 발송 채널 연동됨",
  },
  google_business: {
    channelKey: "google_business",
    channelDisplayName: "Google Business Profile",
    connected: true,
    isTokenExpiringSoon: false,
    webhookActive: true,
    capabilities: {
      publishPost: "api_direct",
      schedulePost: "unsupported",
      replyComments: "unsupported",
      sendDirectMessage: "unsupported",
      replyReviews: "api_direct",
      collectAnalytics: "api_direct",
      manageProfile: "api_direct",
    },
    lastHealthCheck: new Date().toISOString(),
    healthStatus: "healthy",
    statusMessage: "리뷰 1건 답글 승인 대기",
  },
};

export function getChannelCapability(key: ChannelKey): ChannelCapability {
  return DEFAULT_CHANNEL_REGISTRY[key];
}

export function getAllChannels(): ChannelCapability[] {
  return Object.values(DEFAULT_CHANNEL_REGISTRY);
}
