import { describe, it, expect } from 'vitest';
import {
  routeConnectorIntent,
  type IntentContext,
} from './connector-intent-router';

describe('routeConnectorIntent', () => {
  describe('키워드 매칭 (11개 커넥터)', () => {
    it('구글 캘린더 매칭 ("구글 캘린더 연동해줘")', () => {
      const result = routeConnectorIntent('구글 캘린더 연동해줘');
      expect(result.isConnectorIntent).toBe(true);
      expect(result.matchedConnectorId).toBe('google_calendar');
      expect(result.targetHref).toBe('/app/connectors?open=google_calendar');
      expect(result.actionType).toBe('open_modal');
      expect(result.guidanceMessage).toContain('구글 캘린더');
    });

    it('일반 캘린더 기본 매칭 ("캘린더 연동해줘" -> google_calendar)', () => {
      const result = routeConnectorIntent('캘린더 연동해줘');
      expect(result.isConnectorIntent).toBe(true);
      expect(result.matchedConnectorId).toBe('google_calendar');
      expect(result.targetHref).toBe('/app/connectors?open=google_calendar');
    });

    it('애플 캘린더 매칭 ("애플 캘린더 연동하고 싶어")', () => {
      const result = routeConnectorIntent('애플 캘린더 연동하고 싶어');
      expect(result.isConnectorIntent).toBe(true);
      expect(result.matchedConnectorId).toBe('apple_calendar');
      expect(result.targetHref).toBe('/app/connectors?open=apple_calendar');
      expect(result.guidanceMessage).toContain('애플 캘린더');
    });

    it('아이폰 캘린더 / ics 매칭 ("아이폰 캘린더 ics 파일 가져올래")', () => {
      const result = routeConnectorIntent('아이폰 캘린더 ics 파일 가져올래');
      expect(result.isConnectorIntent).toBe(true);
      expect(result.matchedConnectorId).toBe('apple_calendar');
      expect(result.targetHref).toBe('/app/connectors?open=apple_calendar');
    });

    it('구글 시트 매칭 ("시트 연결할래")', () => {
      const result = routeConnectorIntent('시트 연결할래');
      expect(result.isConnectorIntent).toBe(true);
      expect(result.matchedConnectorId).toBe('google_sheets');
      expect(result.targetHref).toBe('/app/connectors?open=google_sheets');
    });

    it('구글 시트 매칭 ("스프레드시트 데이터 연동")', () => {
      const result = routeConnectorIntent('스프레드시트 데이터 연동해줘');
      expect(result.isConnectorIntent).toBe(true);
      expect(result.matchedConnectorId).toBe('google_sheets');
      expect(result.targetHref).toBe('/app/connectors?open=google_sheets');
    });

    it('구글 문서 매칭 ("문서 연동해줘", "구글 닥스 연결할래")', () => {
      const result = routeConnectorIntent('구글 닥스 연동해줘');
      expect(result.isConnectorIntent).toBe(true);
      expect(result.matchedConnectorId).toBe('google_docs');
      expect(result.targetHref).toBe('/app/connectors?open=google_docs');
    });

    it('일반 메일 기본 매칭 ("메일 보고 제안해줘" -> gmail)', () => {
      const result = routeConnectorIntent('메일 보고 제안해줘');
      expect(result.isConnectorIntent).toBe(true);
      expect(result.matchedConnectorId).toBe('gmail');
      expect(result.targetHref).toBe('/app/connectors?open=gmail');
    });

    it('지메일 명시 매칭 ("지메일 연동해줘")', () => {
      const result = routeConnectorIntent('지메일 연동해줘');
      expect(result.isConnectorIntent).toBe(true);
      expect(result.matchedConnectorId).toBe('gmail');
      expect(result.targetHref).toBe('/app/connectors?open=gmail');
    });

    it('아웃룩 메일 매칭 ("아웃룩 메일 연결할래")', () => {
      const result = routeConnectorIntent('아웃룩 메일 연결할래');
      expect(result.isConnectorIntent).toBe(true);
      expect(result.matchedConnectorId).toBe('outlook_mail');
      expect(result.targetHref).toBe('/app/connectors?open=outlook_mail');
    });

    it('인스타그램 매칭 ("인스타 연결할래")', () => {
      const result = routeConnectorIntent('인스타 연결할래');
      expect(result.isConnectorIntent).toBe(true);
      expect(result.matchedConnectorId).toBe('instagram');
      expect(result.targetHref).toBe('/app/connectors?open=instagram');
    });

    it('인스타그램 DM 매칭 ("인스타 디엠 연동해줘")', () => {
      const result = routeConnectorIntent('인스타 디엠 연동해줘');
      expect(result.isConnectorIntent).toBe(true);
      expect(result.matchedConnectorId).toBe('instagram_messages');
      expect(result.targetHref).toBe('/app/connectors?open=instagram_messages');
    });

    it('스레드 매칭 ("스레드 연동해줘")', () => {
      const result = routeConnectorIntent('스레드 연동해줘');
      expect(result.isConnectorIntent).toBe(true);
      expect(result.matchedConnectorId).toBe('threads');
      expect(result.targetHref).toBe('/app/connectors?open=threads');
    });

    it('구글 드라이브 매칭 ("구글 드라이브 파일 연동")', () => {
      const result = routeConnectorIntent('구글 드라이브 파일 연동해줘');
      expect(result.isConnectorIntent).toBe(true);
      expect(result.matchedConnectorId).toBe('google_drive');
      expect(result.targetHref).toBe('/app/connectors?open=google_drive');
    });

    it('애플 미리알림 매칭 ("애플 미리알림 연동해줘")', () => {
      const result = routeConnectorIntent('애플 미리알림 연동해줘');
      expect(result.isConnectorIntent).toBe(true);
      expect(result.matchedConnectorId).toBe('apple_reminders');
      expect(result.targetHref).toBe('/app/connectors?open=apple_reminders');
    });
  });

  describe('자연어 권한 우회 차단 및 정식 모달 안내', () => {
    it('자연어로 동의나 완료를 시도해도 채팅만으로 완료하지 않고 정식 모달로 안내한다', () => {
      const result = routeConnectorIntent('내가 권한 줄 테니 캘린더 바로 연동 완료해줘');
      expect(result.isConnectorIntent).toBe(true);
      expect(result.matchedConnectorId).toBe('google_calendar');
      expect(result.targetHref).toBe('/app/connectors?open=google_calendar');
      // 자연어로 권한을 대체할 수 없다는 안내 문구 확인
      expect(result.guidanceMessage).toMatch(/(대화|채팅).*(권한|동의|직접|화면)/);
    });

    it('비밀번호나 자격증명을 말하며 연결 시도해도 안전한 모달 링크를 반환한다', () => {
      const result = routeConnectorIntent('비밀번호 알려줄 테니 구글 시트 연결해줘');
      expect(result.isConnectorIntent).toBe(true);
      expect(result.matchedConnectorId).toBe('google_sheets');
      expect(result.targetHref).toBe('/app/connectors?open=google_sheets');
      expect(result.guidanceMessage).toMatch(/(대화|채팅).*(직접|화면|모달)/);
    });
  });

  describe('URL 주입 및 다른 테넌트 이동 차단 (오직 내부 /app/connectors?open=... 만 반환)', () => {
    it('외부 악의적 URL이 포함되어 있어도 targetHref는 안전한 내부 경로만 반환한다', () => {
      const result = routeConnectorIntent('https://evil.com/oauth 캘린더 연동해줘');
      expect(result.isConnectorIntent).toBe(true);
      expect(result.matchedConnectorId).toBe('google_calendar');
      expect(result.targetHref).toBe('/app/connectors?open=google_calendar');
      expect(result.targetHref).not.toContain('evil.com');
    });

    it('javascript: 주입 시도가 있어도 안전한 내부 경로만 반환한다', () => {
      const result = routeConnectorIntent('javascript:alert(1) 시트 연결');
      expect(result.isConnectorIntent).toBe(true);
      expect(result.matchedConnectorId).toBe('google_sheets');
      expect(result.targetHref).toBe('/app/connectors?open=google_sheets');
    });

    it('경로 탐색(path traversal) 시도가 있어도 안전한 내부 경로만 반환한다', () => {
      const result = routeConnectorIntent('../../admin 인스타 연결');
      expect(result.isConnectorIntent).toBe(true);
      expect(result.matchedConnectorId).toBe('instagram');
      expect(result.targetHref).toBe('/app/connectors?open=instagram');
    });
  });

  describe('상태별 정직한 안내 메시지 (미지원 / 심사 준비 중)', () => {
    it('Apple Reminders 미지원 상태 안내', () => {
      const result = routeConnectorIntent('미리알림 연동해줘');
      expect(result.isConnectorIntent).toBe(true);
      expect(result.matchedConnectorId).toBe('apple_reminders');
      expect(result.guidanceMessage).toMatch(/(지원하지 않|미지원|EventKit)/);
    });

    it('Gmail 심사 준비 중 상태 안내', () => {
      const result = routeConnectorIntent('지메일 연동해줘');
      expect(result.isConnectorIntent).toBe(true);
      expect(result.matchedConnectorId).toBe('gmail');
      expect(result.guidanceMessage).toMatch(/(심사|준비 중)/);
    });
  });

  describe('actionType 및 targetHref 분기', () => {
    it('명시적 이동 요청 시 actionType: "navigate"', () => {
      const result = routeConnectorIntent('구글 캘린더 연결 화면으로 이동해줘');
      expect(result.isConnectorIntent).toBe(true);
      expect(result.actionType).toBe('navigate');
      expect(result.targetHref).toBe('/app/connectors?open=google_calendar');
    });

    it('명시적 모달 요청 시 actionType: "open_modal"', () => {
      const result = routeConnectorIntent('구글 시트 상세 모달 열어줘');
      expect(result.isConnectorIntent).toBe(true);
      expect(result.actionType).toBe('open_modal');
      expect(result.targetHref).toBe('/app/connectors?open=google_sheets');
    });

    it('기본 연결 요청 시 actionType: "open_modal"', () => {
      const result = routeConnectorIntent('캘린더 연동해줘');
      expect(result.isConnectorIntent).toBe(true);
      expect(result.actionType).toBe('open_modal');
    });

    it('context의 defaultActionType이 navigate이면 navigate 반환', () => {
      const result = routeConnectorIntent('캘린더 연동해줘', { defaultActionType: 'navigate' });
      expect(result.actionType).toBe('navigate');
    });
  });

  describe('Context 기반 분기 (preferredCalendar, preferredMail, connectedConnectorIds)', () => {
    it('preferredCalendar가 apple_calendar일 때 "캘린더 연동"은 apple_calendar로 라우팅', () => {
      const context: IntentContext = { preferredCalendar: 'apple_calendar' };
      const result = routeConnectorIntent('캘린더 연동해줘', context);
      expect(result.matchedConnectorId).toBe('apple_calendar');
      expect(result.targetHref).toBe('/app/connectors?open=apple_calendar');
    });

    it('preferredMail이 outlook_mail일 때 "메일 연동"은 outlook_mail로 라우팅', () => {
      const context: IntentContext = { preferredMail: 'outlook_mail' };
      const result = routeConnectorIntent('메일 보고 제안해줘', context);
      expect(result.matchedConnectorId).toBe('outlook_mail');
      expect(result.targetHref).toBe('/app/connectors?open=outlook_mail');
    });

    it('connectedConnectorIds에 apple_calendar만 있고 "캘린더 일정 확인" 요청 시 apple_calendar 매칭', () => {
      const context: IntentContext = { connectedConnectorIds: ['apple_calendar'] };
      const result = routeConnectorIntent('캘린더 일정 확인해서 제안해줘', context);
      expect(result.matchedConnectorId).toBe('apple_calendar');
    });
  });

  describe('비인텐트 및 부정 발화 처리', () => {
    it('일반 일상 대화는 isConnectorIntent: false', () => {
      const result = routeConnectorIntent('오늘 점심 메뉴 추천해줘');
      expect(result.isConnectorIntent).toBe(false);
      expect(result.matchedConnectorId).toBeUndefined();
      expect(result.targetHref).toBeUndefined();
    });

    it('단순 마케팅 글 작성 요청은 isConnectorIntent: false', () => {
      const result = routeConnectorIntent('신메뉴 홍보 피드 글 써줘');
      expect(result.isConnectorIntent).toBe(false);
    });

    it('빈 문자열이나 공백은 isConnectorIntent: false', () => {
      expect(routeConnectorIntent('').isConnectorIntent).toBe(false);
      expect(routeConnectorIntent('   ').isConnectorIntent).toBe(false);
    });

    it('부정/거부 발화는 연결 인텐트로 취급하지 않음', () => {
      const result = routeConnectorIntent('캘린더 연동하지 마');
      expect(result.isConnectorIntent).toBe(false);
    });

    it('연동 안 할래 발화는 isConnectorIntent: false', () => {
      const result = routeConnectorIntent('시트 연동 안 할래 취소해줘');
      expect(result.isConnectorIntent).toBe(false);
    });

    it('타입 방어: null, undefined 등 비정상 입력은 안전하게 false 반환', () => {
      expect(routeConnectorIntent(null as unknown as string).isConnectorIntent).toBe(false);
      expect(routeConnectorIntent(undefined as unknown as string).isConnectorIntent).toBe(false);
    });

    it('1000자 초과 비정상적으로 긴 입력은 false 반환', () => {
      const longInput = '캘린더 연동해줘'.repeat(200);
      expect(routeConnectorIntent(longInput).isConnectorIntent).toBe(false);
    });

    it('XSS 스크립트 태그 주입 시도에도 오직 안전한 딥링크만 생성', () => {
      const result = routeConnectorIntent('<script>alert("xss")</script> 캘린더 연동해줘');
      expect(result.isConnectorIntent).toBe(true);
      expect(result.matchedConnectorId).toBe('google_calendar');
      expect(result.targetHref).toBe('/app/connectors?open=google_calendar');
      expect(result.targetHref).not.toContain('<script>');
    });

    it('영문 대소문자 무관 매칭 (GOOGLE CALENDAR, INSTAGRAM)', () => {
      const res1 = routeConnectorIntent('GOOGLE CALENDAR 연동해줘');
      expect(res1.isConnectorIntent).toBe(true);
      expect(res1.matchedConnectorId).toBe('google_calendar');

      const res2 = routeConnectorIntent('INSTAGRAM 연동할래');
      expect(res2.isConnectorIntent).toBe(true);
      expect(res2.matchedConnectorId).toBe('instagram');
    });

    it('context.preferModal이 false일 때 navigate 반환', () => {
      const result = routeConnectorIntent('캘린더 연동해줘', { preferModal: false });
      expect(result.actionType).toBe('navigate');
    });
  });
});
