import { describe, it, expect, vi } from 'vitest';
import {
  fetchGmailMessages,
  fetchGmailHistory,
  parseFromHeader,
  extractBodyText,
  buildGmailQuery,
  GmailError,
  type GmailMessagePayload,
} from './gmail';

describe('Gmail Adapter (MC/M02 - ANI-2166)', () => {
  const validToken = 'ya29.test-access-token';

  describe('buildGmailQuery', () => {
    it('라벨과 기본 30일 기간 쿼리를 생성한다', () => {
      const q = buildGmailQuery({ labelId: 'INBOX' });
      expect(q).toContain('label:INBOX');
      expect(q).toContain('newer_than:30d');
    });

    it('커스텀 기간(newerThanDays)과 추가 쿼리를 안전하게 결합한다', () => {
      const q = buildGmailQuery({
        labelId: 'IMPORTANT',
        newerThanDays: 14,
        query: 'from:client@partner.com',
      });
      expect(q).toContain('label:IMPORTANT');
      expect(q).toContain('newer_than:14d');
      expect(q).toContain('from:client@partner.com');
    });

    it('labelId가 없을 때도 30일 기간 쿼리를 강제한다', () => {
      const q = buildGmailQuery({});
      expect(q).toBe('newer_than:30d');
    });
  });

  describe('parseFromHeader (From 이름만 추출 및 이메일 마스킹)', () => {
    it('이름과 이메일이 함께 있는 경우 이름만 추출하고 이메일은 마스킹한다', () => {
      const result = parseFromHeader('홍길동 <gildong@example.com>');
      expect(result.from).toBe('홍길동');
      expect(result.senderName).toBe('홍길동');
      expect(result.senderEmailMasked).toBe('g***g@example.com');
    });

    it('이름 없이 이메일만 있는 경우 마스킹된 이메일을 from으로 반환한다', () => {
      const result = parseFromHeader('<user@domain.com>');
      expect(result.from).toBe('u***r@domain.com');
      expect(result.senderEmailMasked).toBe('u***r@domain.com');
    });

    it('따옴표로 둘러싸인 이름에서 따옴표를 제거한다', () => {
      const result = parseFromHeader('"김철수 대표" <chulsoo@biz.co.kr>');
      expect(result.from).toBe('김철수 대표');
      expect(result.senderName).toBe('김철수 대표');
      expect(result.senderEmailMasked).toBe('c***o@biz.co.kr');
    });

    it('빈 값이거나 유효하지 않은 경우 대체 텍스트를 반환한다', () => {
      const result = parseFromHeader('');
      expect(result.from).toBe('알 수 없음');
    });
  });

  describe('extractBodyText (본문 평문 추출, HTML 태그/스크립트 제거, 첨부파일 배제, 5000자 절삭)', () => {
    it('text/plain 파트를 우선하여 본문을 추출한다', () => {
      const payload: GmailMessagePayload = {
        mimeType: 'multipart/alternative',
        parts: [
          {
            mimeType: 'text/plain',
            body: {
              data: Buffer.from('안녕하세요. 이번 달 정기 안내문입니다.').toString('base64url'),
            },
          },
          {
            mimeType: 'text/html',
            body: {
              data: Buffer.from('<p>HTML 본문</p>').toString('base64url'),
            },
          },
        ],
      };

      const { text, truncated } = extractBodyText(payload);
      expect(text).toBe('안녕하세요. 이번 달 정기 안내문입니다.');
      expect(truncated).toBe(false);
    });

    it('text/html만 있는 경우 script와 태그를 제거하고 평문만 추출한다', () => {
      const html = `
        <html>
          <head>
            <script>alert("malicious script");</script>
            <style>body { color: red; }</style>
          </head>
          <body>
            <h1>신규 마케팅 공지</h1>
            <p>이벤트가 시작되었습니다.&nbsp;&amp;&nbsp;많은 참여 바랍니다.</p>
          </body>
        </html>
      `;
      const payload: GmailMessagePayload = {
        mimeType: 'text/html',
        body: {
          data: Buffer.from(html).toString('base64url'),
        },
      };

      const { text, truncated } = extractBodyText(payload);
      expect(text).not.toContain('script');
      expect(text).not.toContain('alert');
      expect(text).not.toContain('color: red');
      expect(text).toContain('신규 마케팅 공지');
      expect(text).toContain('이벤트가 시작되었습니다. & 많은 참여 바랍니다.');
      expect(truncated).toBe(false);
    });

    it('첨부파일(filename/attachmentId 존재) 파트는 본문 추출에서 완전히 배제한다', () => {
      const payload: GmailMessagePayload = {
        mimeType: 'multipart/mixed',
        parts: [
          {
            mimeType: 'text/plain',
            body: {
              data: Buffer.from('본문 내용입니다.').toString('base64url'),
            },
          },
          {
            mimeType: 'application/pdf',
            filename: 'contract.pdf',
            body: {
              attachmentId: 'att-12345',
              size: 20480,
            },
          },
        ],
      };

      const { text } = extractBodyText(payload);
      expect(text).toBe('본문 내용입니다.');
      expect(text).not.toContain('contract.pdf');
    });

    it('5,000자를 초과하는 본문은 정확히 5,000자(코드포인트)로 절삭한다', () => {
      const longText = '가'.repeat(6000);
      const payload: GmailMessagePayload = {
        mimeType: 'text/plain',
        body: {
          data: Buffer.from(longText).toString('base64url'),
        },
      };

      const { text, truncated } = extractBodyText(payload);
      expect(text.length).toBe(5000);
      expect(truncated).toBe(true);
    });
  });

  describe('fetchGmailMessages (순수 API 어댑터)', () => {
    it('메시지 목록 조회 후 각 메시지의 세부 정보를 파싱하여 반환한다', async () => {
      const mockFetch = vi.fn();

      // 1. list 호출 응답
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            messages: [
              { id: 'msg-001', threadId: 'thread-001' },
              { id: 'msg-002', threadId: 'thread-002' },
            ],
            nextPageToken: 'next-page-123',
            resultSizeEstimate: 2,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      // 2. msg-001 get 호출 응답
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'msg-001',
            threadId: 'thread-001',
            historyId: 'hist-100',
            internalDate: '1700000000000',
            labelIds: ['INBOX', 'STARRED'],
            payload: {
              headers: [
                { name: 'Subject', value: '11월 마케팅 협력 제안서' },
                { name: 'From', value: '김팀장 <manager@partner.com>' },
                { name: 'Date', value: 'Wed, 15 Nov 2026 10:00:00 +0900' },
              ],
              mimeType: 'text/plain',
              body: {
                data: Buffer.from('협력 제안드립니다.').toString('base64url'),
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      // 3. msg-002 get 호출 응답
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'msg-002',
            threadId: 'thread-002',
            historyId: 'hist-101',
            internalDate: '1700001000000',
            labelIds: ['INBOX'],
            payload: {
              headers: [
                { name: 'Subject', value: '견적서 문의' },
                { name: 'From', value: '고객 <client@example.com>' },
                { name: 'Date', value: 'Wed, 15 Nov 2026 11:00:00 +0900' },
              ],
              mimeType: 'text/plain',
              body: {
                data: Buffer.from('견적 부탁드립니다.').toString('base64url'),
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const result = await fetchGmailMessages(
        {
          accessToken: validToken,
          labelId: 'INBOX',
        },
        { fetch: mockFetch }
      );

      expect(result.messages).toHaveLength(2);
      expect(result.derivedFromGoogle).toBe(true);

      const msg1 = result.messages[0];
      expect(msg1.id).toBe('msg-001');
      expect(msg1.subject).toBe('11월 마케팅 협력 제안서');
      expect(msg1.from).toBe('김팀장');
      expect(msg1.senderEmailMasked).toBe('m***r@partner.com');
      expect(msg1.bodyText).toBe('협력 제안드립니다.');
      expect(result.nextPageToken).toBe('next-page-123');
      expect(result.latestHistoryId).toBe('hist-101');
    });

    it('401 인증 만료 시 INVALID_CREDENTIALS 에러를 던진다', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { message: 'Invalid Credentials', code: 401 } }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
      );

      await expect(
        fetchGmailMessages({ accessToken: validToken }, { fetch: mockFetch })
      ).rejects.toThrowError(GmailError);

      try {
        await fetchGmailMessages({ accessToken: validToken }, { fetch: mockFetch });
      } catch (err: any) {
        expect(err.code).toBe('INVALID_CREDENTIALS');
        expect(err.status).toBe(401);
      }
    });

    it('403 권한 거부 시 ACCESS_DENIED 에러를 던진다', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { message: 'Insufficient Permission', code: 403 } }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        )
      );

      try {
        await fetchGmailMessages({ accessToken: validToken }, { fetch: mockFetch });
      } catch (err: any) {
        expect(err.code).toBe('ACCESS_DENIED');
        expect(err.status).toBe(403);
      }
    });

    it('429 레이트 리밋 시 RATE_LIMITED 에러와 Retry-After ms를 파싱한다', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { message: 'Rate limit exceeded', code: 429 } }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': '5',
            },
          }
        )
      );

      try {
        await fetchGmailMessages({ accessToken: validToken }, { fetch: mockFetch });
      } catch (err: any) {
        expect(err.code).toBe('RATE_LIMITED');
        expect(err.status).toBe(429);
        expect(err.retryAfterMs).toBe(5000);
      }
    });
  });

  describe('fetchGmailHistory (증분 히스토리 어댑터)', () => {
    it('historyId 이후 변경 내역(신규/삭제 메시지)을 파싱하여 반환한다', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            historyId: '2000',
            history: [
              {
                id: 'hist-1',
                messagesAdded: [
                  { message: { id: 'msg-new-1', threadId: 'thread-1', labelIds: ['INBOX'] } },
                ],
                messagesDeleted: [
                  { message: { id: 'msg-del-1', threadId: 'thread-2' } },
                ],
              },
            ],
            nextPageToken: 'hist-next-tok',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const res = await fetchGmailHistory(
        {
          accessToken: validToken,
          startHistoryId: '1000',
          labelId: 'INBOX',
        },
        { fetch: mockFetch }
      );

      expect(res.historyId).toBe('2000');
      expect(res.addedMessageIds).toEqual(['msg-new-1']);
      expect(res.deletedMessageIds).toEqual(['msg-del-1']);
      expect(res.derivedFromGoogle).toBe(true);
    });

    it('404 응답 시 HISTORY_EXPIRED 에러를 던져 Full Resync Fallback을 유도한다', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { message: 'History record not found', code: 404 } }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        )
      );

      try {
        await fetchGmailHistory(
          {
            accessToken: validToken,
            startHistoryId: 'expired-100',
          },
          { fetch: mockFetch }
        );
      } catch (err: any) {
        expect(err.code).toBe('HISTORY_EXPIRED');
        expect(err.status).toBe(404);
      }
    });
  });
});
