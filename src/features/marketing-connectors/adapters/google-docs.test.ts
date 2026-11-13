import { describe, it, expect, vi } from 'vitest';
import {
  fetchGoogleDocument,
  GoogleDocError,
  extractGoogleDocId,
} from './google-docs';

describe('MC/D02 Google Docs 탭·본문·표 제한 읽기 어댑터 (ANI-2161)', () => {
  const dummyAccessToken = 'ya29.test-valid-access-token';
  const dummyDocId = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';

  describe('extractGoogleDocId 유틸리티', () => {
    it('순수 documentId를 그대로 반환한다', () => {
      expect(extractGoogleDocId(dummyDocId)).toBe(dummyDocId);
    });

    it('Google Docs URL에서 documentId를 정확히 추출한다', () => {
      const url = `https://docs.google.com/document/d/${dummyDocId}/edit?tab=t.0#heading=h.abc`;
      expect(extractGoogleDocId(url)).toBe(dummyDocId);
    });

    it('잘못된 입력인 경우 null을 반환한다', () => {
      expect(extractGoogleDocId('')).toBeNull();
      expect(extractGoogleDocId('invalid url')).toBeNull();
      expect(extractGoogleDocId('https://google.com')).toBeNull();
    });
  });

  describe('입력 유효성 검증 (Fail-Closed)', () => {
    it('documentId가 비어있으면 INVALID_INPUT 에러를 던진다', async () => {
      await expect(
        fetchGoogleDocument({ documentId: '', accessToken: dummyAccessToken })
      ).rejects.toThrow(GoogleDocError);

      try {
        await fetchGoogleDocument({ documentId: '   ', accessToken: dummyAccessToken });
      } catch (err) {
        expect(err).toBeInstanceOf(GoogleDocError);
        expect((err as GoogleDocError).code).toBe('INVALID_INPUT');
      }
    });

    it('documentId에 경로 탐색 문자나 슬래시가 포함되면 INVALID_INPUT 에러를 던진다', async () => {
      await expect(
        fetchGoogleDocument({ documentId: '../secret/doc', accessToken: dummyAccessToken })
      ).rejects.toThrow(GoogleDocError);
      await expect(
        fetchGoogleDocument({ documentId: 'doc/with/slash', accessToken: dummyAccessToken })
      ).rejects.toThrow(GoogleDocError);
    });

    it('accessToken이 비어있으면 INVALID_INPUT 에러를 던진다', async () => {
      await expect(
        fetchGoogleDocument({ documentId: dummyDocId, accessToken: '' })
      ).rejects.toThrow(GoogleDocError);

      try {
        await fetchGoogleDocument({ documentId: dummyDocId, accessToken: '  ' });
      } catch (err) {
        expect(err).toBeInstanceOf(GoogleDocError);
        expect((err as GoogleDocError).code).toBe('INVALID_INPUT');
      }
    });
  });

  describe('기본 단락 텍스트 추출 (최상위 body 폴백)', () => {
    it('tabs가 없는 단일 문서 본문에서 단락 텍스트를 정상 추출한다', async () => {
      const mockDocResponse = {
        documentId: dummyDocId,
        title: '신메뉴 마케팅 기획서',
        revisionId: 'rev_12345',
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  { textRun: { content: '2026 여름 시즌 신메뉴 안내\n' } },
                  { textRun: { content: '신선한 생과일 주스 3종 출시\n' } },
                ],
              },
            },
          ],
        },
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockDocResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await fetchGoogleDocument(
        { documentId: dummyDocId, accessToken: dummyAccessToken },
        { fetch: mockFetch }
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callUrl = mockFetch.mock.calls[0][0];
      const callInit = mockFetch.mock.calls[0][1];
      expect(callUrl).toBe(
        `https://docs.googleapis.com/v1/documents/${dummyDocId}?includeTabsContent=true`
      );
      expect(callInit.headers['Authorization']).toBe(`Bearer ${dummyAccessToken}`);

      expect(result.derivedFromGoogle).toBe(true);
      expect(result.documentId).toBe(dummyDocId);
      expect(result.title).toBe('신메뉴 마케팅 기획서');
      expect(result.revisionId).toBe('rev_12345');
      expect(result.tabs).toHaveLength(1);
      expect(result.tabs[0].tabId).toBe('root');
      expect(result.tabs[0].title).toBe('신메뉴 마케팅 기획서');
      expect(result.tabs[0].text).toBe(
        '2026 여름 시즌 신메뉴 안내\n신선한 생과일 주스 3종 출시\n'
      );
      expect(result.totalCharCount).toBe(result.tabs[0].text.length);
      expect(result.truncated).toBe(false);
      expect(result.warnings).toEqual([]);
    });
  });

  describe('다중 탭(tabs) 파싱 및 계층 구조', () => {
    it('tabs 배열이 제공될 경우 각 탭의 documentTab.body.content를 순회하여 텍스트를 추출한다', async () => {
      const mockDocResponse = {
        documentId: dummyDocId,
        title: '통합 마케팅 전략',
        revisionId: 'rev_tab_001',
        tabs: [
          {
            tabProperties: {
              tabId: 't.0',
              title: '개요 및 목표',
            },
            documentTab: {
              body: {
                content: [
                  {
                    paragraph: {
                      elements: [{ textRun: { content: '목표: 인스타 유입 30% 증대\n' } }],
                    },
                  },
                ],
              },
            },
          },
          {
            tabProperties: {
              tabId: 't.1',
              title: '예산 및 일정',
            },
            documentTab: {
              body: {
                content: [
                  {
                    paragraph: {
                      elements: [{ textRun: { content: '예산: 총 500만원\n' } }],
                    },
                  },
                ],
              },
            },
            childTabs: [
              {
                tabProperties: {
                  tabId: 't.1_1',
                  title: '세부 집행 내역',
                },
                documentTab: {
                  body: {
                    content: [
                      {
                        paragraph: {
                          elements: [{ textRun: { content: '인플루언서 섭외: 200만원\n' } }],
                        },
                      },
                    ],
                  },
                },
              },
            ],
          },
        ],
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockDocResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await fetchGoogleDocument(
        { documentId: dummyDocId, accessToken: dummyAccessToken },
        { fetch: mockFetch }
      );

      expect(result.tabs).toHaveLength(3);
      expect(result.tabs[0]).toEqual({
        tabId: 't.0',
        title: '개요 및 목표',
        text: '목표: 인스타 유입 30% 증대\n',
        charCount: '목표: 인스타 유입 30% 증대\n'.length,
      });
      expect(result.tabs[1]).toEqual({
        tabId: 't.1',
        title: '예산 및 일정',
        text: '예산: 총 500만원\n',
        charCount: '예산: 총 500만원\n'.length,
      });
      expect(result.tabs[2]).toEqual({
        tabId: 't.1_1',
        title: '세부 집행 내역',
        text: '인플루언서 섭외: 200만원\n',
        charCount: '인플루언서 섭외: 200만원\n'.length,
      });
      expect(result.totalCharCount).toBe(
        result.tabs[0].charCount + result.tabs[1].charCount + result.tabs[2].charCount
      );
      expect(result.truncated).toBe(false);
    });
  });

  describe('표(Table) 구조 텍스트 추출', () => {
    it('tableRows와 tableCells의 내용을 탭(\\t)과 줄바꿈(\\n)으로 정돈하여 추출한다', async () => {
      const mockDocResponse = {
        documentId: dummyDocId,
        title: '단가표 문서',
        body: {
          content: [
            {
              paragraph: {
                elements: [{ textRun: { content: '상세 가격 목록:\n' } }],
              },
            },
            {
              table: {
                tableRows: [
                  {
                    tableCells: [
                      {
                        content: [
                          {
                            paragraph: {
                              elements: [{ textRun: { content: '항목\n' } }],
                            },
                          },
                        ],
                      },
                      {
                        content: [
                          {
                            paragraph: {
                              elements: [{ textRun: { content: '가격\n' } }],
                            },
                          },
                        ],
                      },
                    ],
                  },
                  {
                    tableCells: [
                      {
                        content: [
                          {
                            paragraph: {
                              elements: [{ textRun: { content: '아메리카노\n' } }],
                            },
                          },
                        ],
                      },
                      {
                        content: [
                          {
                            paragraph: {
                              elements: [{ textRun: { content: '4,500원\n' } }],
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockDocResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await fetchGoogleDocument(
        { documentId: dummyDocId, accessToken: dummyAccessToken },
        { fetch: mockFetch }
      );

      expect(result.tabs[0].text).toContain('상세 가격 목록:\n');
      expect(result.tabs[0].text).toContain('항목\t가격\n아메리카노\t4,500원');
    });
  });

  describe('비정형 요소(차트, 이미지, 방정식, 목차 등) 스킵 및 경고 기록', () => {
    it('inlineObjectElement, equation, tableOfContents 등 비정형 요소를 건너뛰고 warnings에 알림을 남긴다', async () => {
      const mockDocResponse = {
        documentId: dummyDocId,
        title: '비정형 요소 포함 문서',
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  { textRun: { content: '텍스트 본문 1\n' } },
                  { inlineObjectElement: { inlineObjectId: 'kix.img123' } },
                  { equation: {} },
                ],
              },
            },
            {
              tableOfContents: {
                content: [],
              },
            },
          ],
        },
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockDocResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await fetchGoogleDocument(
        { documentId: dummyDocId, accessToken: dummyAccessToken },
        { fetch: mockFetch }
      );

      expect(result.tabs[0].text).toBe('텍스트 본문 1\n');
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes('inlineObjectElement'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('equation'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('tableOfContents'))).toBe(true);
    });
  });

  describe('최대 탭 수 및 글자 수 예산 제한 (Truncation)', () => {
    it('탭 수가 maxTabs(기본 20)를 초과하면 초과분을 생략하고 truncated=true 및 경고를 반환한다', async () => {
      const tabs = Array.from({ length: 25 }, (_, i) => ({
        tabProperties: { tabId: `t.${i}`, title: `Tab ${i}` },
        documentTab: {
          body: {
            content: [
              {
                paragraph: {
                  elements: [{ textRun: { content: `Tab content ${i}\n` } }],
                },
              },
            ],
          },
        },
      }));

      const mockDocResponse = {
        documentId: dummyDocId,
        title: '대량 탭 문서',
        tabs,
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockDocResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await fetchGoogleDocument(
        { documentId: dummyDocId, accessToken: dummyAccessToken, maxTabs: 20 },
        { fetch: mockFetch }
      );

      expect(result.tabs).toHaveLength(20);
      expect(result.truncated).toBe(true);
      expect(result.warnings.some((w) => w.includes('maxTabs') || w.includes('tabs limit'))).toBe(
        true
      );
    });

    it('누적 글자 수가 maxChars 예산을 초과하면 즉시 절삭하고 truncated=true 및 경고를 반환한다', async () => {
      const mockDocResponse = {
        documentId: dummyDocId,
        title: '장문 문서',
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  { textRun: { content: '가나다라마바사아자차카타파하' } }, // 14자
                ],
              },
            },
          ],
        },
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockDocResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await fetchGoogleDocument(
        {
          documentId: dummyDocId,
          accessToken: dummyAccessToken,
          maxChars: 5,
        },
        { fetch: mockFetch }
      );

      expect(result.tabs[0].text).toBe('가나다라마');
      expect(result.tabs[0].charCount).toBe(5);
      expect(result.totalCharCount).toBe(5);
      expect(result.truncated).toBe(true);
      expect(result.warnings.some((w) => w.includes('maxChars') || w.includes('budget'))).toBe(
        true
      );
    });
  });

  describe('에러 처리 (HTTP 상태 코드 매핑)', () => {
    it('401 응답 시 INVALID_CREDENTIALS 에러를 던진다', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Invalid credentials' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await expect(
        fetchGoogleDocument(
          { documentId: dummyDocId, accessToken: dummyAccessToken },
          { fetch: mockFetch }
        )
      ).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
        status: 401,
      });
    });

    it('403 응답 시 ACCESS_DENIED 에러를 던진다', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'The caller does not have permission' } }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await expect(
        fetchGoogleDocument(
          { documentId: dummyDocId, accessToken: dummyAccessToken },
          { fetch: mockFetch }
        )
      ).rejects.toMatchObject({
        code: 'ACCESS_DENIED',
        status: 403,
      });
    });

    it('404 응답 시 DOCUMENT_NOT_FOUND 에러를 던진다', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Document not found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await expect(
        fetchGoogleDocument(
          { documentId: dummyDocId, accessToken: dummyAccessToken },
          { fetch: mockFetch }
        )
      ).rejects.toMatchObject({
        code: 'DOCUMENT_NOT_FOUND',
        status: 404,
      });
    });

    it('429 응답 시 RATE_LIMITED 에러를 던진다', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Too many requests' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await expect(
        fetchGoogleDocument(
          { documentId: dummyDocId, accessToken: dummyAccessToken },
          { fetch: mockFetch }
        )
      ).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        status: 429,
      });
    });

    it('500 응답 시 SERVER_ERROR 에러를 던진다', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('Internal Server Error', {
          status: 500,
        })
      );

      await expect(
        fetchGoogleDocument(
          { documentId: dummyDocId, accessToken: dummyAccessToken },
          { fetch: mockFetch }
        )
      ).rejects.toMatchObject({
        code: 'SERVER_ERROR',
        status: 500,
      });
    });
  });

  describe('타임아웃 및 AbortSignal 처리', () => {
    it('외부 AbortSignal이 이미 취소된 경우 즉시 에러를 발생시킨다', async () => {
      const controller = new AbortController();
      controller.abort();

      const mockFetch = vi.fn();

      await expect(
        fetchGoogleDocument(
          {
            documentId: dummyDocId,
            accessToken: dummyAccessToken,
            signal: controller.signal,
          },
          { fetch: mockFetch }
        )
      ).rejects.toThrow();
    });

    it('타임아웃 발생 시 TIMEOUT 에러를 던진다', async () => {
      const mockFetch = vi.fn().mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => {
              const err = new Error('Request timed out');
              err.name = 'TimeoutError';
              reject(err);
            }, 50);
          })
      );

      await expect(
        fetchGoogleDocument(
          {
            documentId: dummyDocId,
            accessToken: dummyAccessToken,
            timeoutMs: 10,
          },
          { fetch: mockFetch }
        )
      ).rejects.toMatchObject({
        code: 'TIMEOUT',
      });
    });
  });
});
