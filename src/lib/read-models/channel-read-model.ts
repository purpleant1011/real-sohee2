export type ChannelExecutionMode = 'api' | 'browser_connector' | 'assisted' | 'unsupported';

export interface ChannelCapabilityItem {
  key: string;
  name: string;
  description: string;
  supported: boolean;
  requiresApproval: boolean;
}

export interface ChannelConnectionReadModel {
  channelKey: string;
  displayName: string;
  logoIcon: string;
  category: 'social' | 'local_search' | 'messaging' | 'community';
  connectionStatus: 'connected' | 'disconnected' | 'needs_reauth' | 'pending';
  executionMode: ChannelExecutionMode;
  accountName?: string;
  accountId?: string;
  grantedScopes: string[];
  missingScopes: string[];
  tokenExpiresAt?: string;
  webhookHealth: 'healthy' | 'degraded' | 'down' | 'not_applicable';
  lastSyncedAt: string;
  lastError?: string;
  capabilities: ChannelCapabilityItem[];
}

export interface GetChannelsParams {
  workspaceId: string;
}

export function getChannelsReadModel(params: GetChannelsParams): ChannelConnectionReadModel[] {
  void params;
  return [
    {
      channelKey: 'instagram',
      displayName: 'Instagram',
      logoIcon: 'instagram',
      category: 'social',
      connectionStatus: 'connected',
      executionMode: 'api',
      accountName: '@byreum_cheongdam',
      accountId: 'ig_act_9041284',
      grantedScopes: ['instagram_basic', 'instagram_content_publish', 'instagram_manage_messages'],
      missingScopes: [],
      tokenExpiresAt: '2026-10-15T00:00:00Z',
      webhookHealth: 'healthy',
      lastSyncedAt: '8분 전',
      capabilities: [
        { key: 'feed_publish', name: '피드 포스팅 발행', description: '이미지/캡션 자동 업로드', supported: true, requiresApproval: true },
        { key: 'story_publish', name: '스토리 발행', description: '당일 타임세일/소식 공유', supported: true, requiresApproval: true },
        { key: 'dm_read', name: 'DM 문의 수신', description: '고객 문의 실시간 감지', supported: true, requiresApproval: false },
        { key: 'dm_reply', name: 'DM 자동/초안 응답', description: 'AI 초안 생성 및 발송', supported: true, requiresApproval: true },
      ],
    },
    {
      channelKey: 'threads',
      displayName: 'Threads',
      logoIcon: 'threads',
      category: 'social',
      connectionStatus: 'connected',
      executionMode: 'api',
      accountName: '@byreum_cheongdam',
      accountId: 'th_act_9041284',
      grantedScopes: ['threads_basic', 'threads_content_publish'],
      missingScopes: [],
      tokenExpiresAt: '2026-10-15T00:00:00Z',
      webhookHealth: 'healthy',
      lastSyncedAt: '15분 전',
      capabilities: [
        { key: 'post_publish', name: '스레드 텍스트/이미지 발행', description: '뷰티 인사이트 및 팁 공유', supported: true, requiresApproval: true },
      ],
    },
    {
      channelKey: 'kakaotalk',
      displayName: '카카오톡 채널',
      logoIcon: 'kakaotalk',
      category: 'messaging',
      connectionStatus: 'connected',
      executionMode: 'api',
      accountName: '바이름 청라 공식채널',
      accountId: '_xkjXlb',
      grantedScopes: ['plus_friend_message', 'channel_chat_read'],
      missingScopes: [],
      tokenExpiresAt: '2027-01-01T00:00:00Z',
      webhookHealth: 'healthy',
      lastSyncedAt: '3분 전',
      capabilities: [
        { key: 'chat_read', name: '1:1 채팅 상담 수신', description: '실시간 예약 문의 감지', supported: true, requiresApproval: false },
        { key: 'chat_reply', name: '1:1 상담 응답', description: 'AI 맞춤 예약 안내 발송', supported: true, requiresApproval: true },
        { key: 'slot_recovery_push', name: '잔여 슬롯 타겟 알림톡', description: '동의 고객 대상 슬롯 제안', supported: true, requiresApproval: true },
      ],
    },
    {
      channelKey: 'naver_place',
      displayName: '네이버 스마트플레이스',
      logoIcon: 'naver_place',
      category: 'local_search',
      connectionStatus: 'needs_reauth',
      executionMode: 'browser_connector',
      accountName: '바이름 청라본점',
      accountId: 'nv_place_1982374',
      grantedScopes: ['place_profile_read'],
      missingScopes: ['place_review_reply_write'],
      tokenExpiresAt: '2026-08-25T00:00:00Z',
      webhookHealth: 'down',
      lastSyncedAt: '3일 전',
      lastError: '네이버 스마트플레이스 세션 토큰 만료 (재로그인 필요)',
      capabilities: [
        { key: 'review_read', name: '영수증/예약 리뷰 감지', description: '새 리뷰 24시간 내 감지', supported: true, requiresApproval: false },
        { key: 'review_reply', name: '리뷰 감사 답글 작성', description: '브랜드 메모리 기반 답글 게재', supported: true, requiresApproval: true },
        { key: 'booking_slot_sync', name: '네이버 예약 캘린더 연동', description: '실시간 잔여 슬롯 조회', supported: true, requiresApproval: false },
      ],
    },
    {
      channelKey: 'naver_blog',
      displayName: '네이버 블로그',
      logoIcon: 'naver_blog',
      category: 'social',
      connectionStatus: 'connected',
      executionMode: 'assisted',
      accountName: '바이름 뷰티 라이프',
      accountId: 'byreum_official',
      grantedScopes: [],
      missingScopes: [],
      webhookHealth: 'not_applicable',
      lastSyncedAt: '어제',
      capabilities: [
        { key: 'blog_draft_gen', name: 'SEO 최적화 시술 후기 초안 생성', description: '키워드 및 사진 배치 원고 완성', supported: true, requiresApproval: true },
        { key: 'assisted_export', name: '원클릭 원고 복사/에디터 전달', description: '스마트에디터 ONE 서식 호환 복사', supported: true, requiresApproval: false },
      ],
    },
    {
      channelKey: 'daangn',
      displayName: '당근 비즈프로필',
      logoIcon: 'daangn',
      category: 'community',
      connectionStatus: 'connected',
      executionMode: 'api',
      accountName: '바이름 청라',
      accountId: 'dg_biz_491028',
      grantedScopes: ['biz_post_publish', 'biz_chat_read'],
      missingScopes: [],
      tokenExpiresAt: '2026-11-30T00:00:00Z',
      webhookHealth: 'healthy',
      lastSyncedAt: '25분 전',
      capabilities: [
        { key: 'local_post_publish', name: '동네 소식/쿠폰 발행', description: '청라 주민 타겟 쿠폰', supported: true, requiresApproval: true },
        { key: 'local_chat_reply', name: '당근 채팅 응답', description: '동네 주민 1:1 상담 안내', supported: true, requiresApproval: true },
      ],
    },
    {
      channelKey: 'google_business',
      displayName: 'Google 비즈니스 프로필',
      logoIcon: 'google_business',
      category: 'local_search',
      connectionStatus: 'connected',
      executionMode: 'api',
      accountName: 'Byreum Beauty Cheongna',
      accountId: 'gbp_loc_8839102',
      grantedScopes: ['business.manage'],
      missingScopes: [],
      tokenExpiresAt: '2026-12-31T00:00:00Z',
      webhookHealth: 'healthy',
      lastSyncedAt: '18분 전',
      capabilities: [
        { key: 'google_review_read', name: 'Google 리뷰 수신', description: '해외/국내 고객 리뷰 감지', supported: true, requiresApproval: false },
        { key: 'google_review_reply', name: 'Google 리뷰 답글 게시', description: '다국어/한국어 정중한 답글 작성', supported: true, requiresApproval: true },
        { key: 'google_posts', name: 'Google 지도 소식 게재', description: '매장 프로모션 업데이트', supported: true, requiresApproval: true },
      ],
    },
  ];
}
