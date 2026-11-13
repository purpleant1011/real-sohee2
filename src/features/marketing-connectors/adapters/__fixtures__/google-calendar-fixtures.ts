/**
 * Google Calendar API 테스트 픽스처
 *
 * 민감정보(attendees, organizer, description 등) 포함 원본 모의 응답 데이터
 */

export const mockCalendarEventTimed = {
  id: 'evt_timed_001',
  status: 'confirmed',
  summary: '여름 시즌 신메뉴 론칭 행사',
  description: '민감한 매장 내부 기획 메모 및 연락처: 010-1234-5678',
  location: '서울시 강남구 테헤란로 123',
  creator: { email: 'manager@example.com', displayName: '매장 매니저' },
  organizer: { email: 'organizer@example.com', displayName: '기획팀' },
  attendees: [
    { email: 'vip@customer.com', displayName: 'VIP 고객', responseStatus: 'accepted' },
    { email: 'staff@example.com', displayName: '담당 직원', responseStatus: 'accepted' },
  ],
  conferenceData: {
    entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }],
  },
  start: {
    dateTime: '2026-06-01T10:00:00+09:00',
    timeZone: 'Asia/Seoul',
  },
  end: {
    dateTime: '2026-06-01T12:00:00+09:00',
    timeZone: 'Asia/Seoul',
  },
};

export const mockCalendarEventAllDay = {
  id: 'evt_allday_002',
  status: 'tentative',
  summary: '매장 정기 휴무일',
  description: '개인적인 사유로 휴무 예정 (PII: 김철수 사장 개인 일정)',
  location: '본점',
  start: {
    date: '2026-06-15',
  },
  end: {
    date: '2026-06-16',
  },
};

export const mockCalendarEventCancelled = {
  id: 'evt_cancelled_003',
  status: 'cancelled',
  summary: '취소된 이벤트',
  description: '취소 사유 및 고객 환불 계좌 정보 123-456-789',
};

export function createMockGoogleCalendarResponse(options: {
  items?: unknown[];
  nextPageToken?: string;
  nextSyncToken?: string;
}) {
  return {
    kind: 'calendar#events',
    etag: '"etag12345"',
    summary: '업무 캘린더',
    updated: '2026-06-01T00:00:00.000Z',
    timeZone: 'Asia/Seoul',
    accessRole: 'reader',
    nextPageToken: options.nextPageToken,
    nextSyncToken:
      options.nextSyncToken !== undefined
        ? options.nextSyncToken
        : options.nextPageToken
          ? undefined
          : 'default_sync_token_123',
    items: options.items ?? [
      mockCalendarEventTimed,
      mockCalendarEventAllDay,
      mockCalendarEventCancelled,
    ],
  };
}
