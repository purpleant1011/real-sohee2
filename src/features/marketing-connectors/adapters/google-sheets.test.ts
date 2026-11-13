import { describe, it, expect, vi } from 'vitest';
import {
  fetchGoogleSheetValues,
  GoogleSheetError,
  extractGoogleSpreadsheetId,
} from './google-sheets';

describe('MC/S01 Google Sheets 명시 A1 범위 읽기 어댑터 (ANI-2163)', () => {
  const dummyAccessToken = 'ya29.test-valid-access-token';
  const dummySpreadsheetId = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
  const dummyRange = "'시트1'!A1:D50";

  describe('extractGoogleSpreadsheetId 유틸리티', () => {
    it('순수 spreadsheetId를 그대로 반환한다', () => {
      expect(extractGoogleSpreadsheetId(dummySpreadsheetId)).toBe(dummySpreadsheetId);
    });

    it('Google Sheets URL에서 spreadsheetId를 정확히 추출한다', () => {
      const url = `https://docs.google.com/spreadsheets/d/${dummySpreadsheetId}/edit?gid=12345#gid=12345`;
      expect(extractGoogleSpreadsheetId(url)).toBe(dummySpreadsheetId);
    });

    it('잘못된 입력인 경우 null을 반환한다', () => {
      expect(extractGoogleSpreadsheetId('')).toBeNull();
      expect(extractGoogleSpreadsheetId('invalid id with spaces')).toBeNull();
      expect(extractGoogleSpreadsheetId('https://google.com')).toBeNull();
      expect(extractGoogleSpreadsheetId(null)).toBeNull();
    });
  });

  describe('입력 유효성 검증 (Fail-Closed)', () => {
    it('spreadsheetId가 비어있거나 공백이면 INVALID_INPUT 에러를 던진다', async () => {
      await expect(
        fetchGoogleSheetValues({ spreadsheetId: '', range: dummyRange, accessToken: dummyAccessToken })
      ).rejects.toThrow(GoogleSheetError);

      await expect(
        fetchGoogleSheetValues({ spreadsheetId: '', range: dummyRange, accessToken: dummyAccessToken })
      ).rejects.toMatchObject({
        name: 'GoogleSheetError',
        code: 'INVALID_INPUT',
      });

      await expect(
        fetchGoogleSheetValues({ spreadsheetId: '   ', range: dummyRange, accessToken: dummyAccessToken })
      ).rejects.toMatchObject({
        name: 'GoogleSheetError',
        code: 'INVALID_INPUT',
      });
    });

    it('spreadsheetId가 256자를 초과하면 INVALID_INPUT 에러를 던진다', async () => {
      const longId = 'a'.repeat(257);
      await expect(
        fetchGoogleSheetValues({ spreadsheetId: longId, range: dummyRange, accessToken: dummyAccessToken })
      ).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
    });

    it('spreadsheetId에 경로 탐색이나 슬래시가 포함되면 INVALID_INPUT 에러를 던진다', async () => {
      await expect(
        fetchGoogleSheetValues({ spreadsheetId: '../etc/passwd', range: dummyRange, accessToken: dummyAccessToken })
      ).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });

      await expect(
        fetchGoogleSheetValues({ spreadsheetId: 'sheet/slash', range: dummyRange, accessToken: dummyAccessToken })
      ).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
    });

    it('range가 누락되거나 빈 문자열이면 INVALID_INPUT 에러를 던진다 (첫 시트 자동 fallback 엄격 금지)', async () => {
      await expect(
        fetchGoogleSheetValues({ spreadsheetId: dummySpreadsheetId, range: '', accessToken: dummyAccessToken })
      ).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });

      await expect(
        fetchGoogleSheetValues({ spreadsheetId: dummySpreadsheetId, range: '   ', accessToken: dummyAccessToken })
      ).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
    });

    it('accessToken이 비어있으면 INVALID_INPUT 에러를 던진다', async () => {
      await expect(
        fetchGoogleSheetValues({ spreadsheetId: dummySpreadsheetId, range: dummyRange, accessToken: '' })
      ).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });

      await expect(
        fetchGoogleSheetValues({ spreadsheetId: dummySpreadsheetId, range: dummyRange, accessToken: '   ' })
      ).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
    });
  });

  describe('HTTP 에러 매핑 및 상태 코드 처리', () => {
    it('401 응답 시 INVALID_CREDENTIALS 에러를 던진다', async () => {
      const mockFetch: typeof fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      } as Response);

      await expect(
        fetchGoogleSheetValues(
          { spreadsheetId: dummySpreadsheetId, range: dummyRange, accessToken: dummyAccessToken },
          { fetch: mockFetch }
        )
      ).rejects.toMatchObject({
        name: 'GoogleSheetError',
        code: 'INVALID_CREDENTIALS',
        status: 401,
      });
    });

    it('403 응답 시 ACCESS_DENIED 에러를 던진다', async () => {
      const mockFetch: typeof fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      } as Response);

      await expect(
        fetchGoogleSheetValues(
          { spreadsheetId: dummySpreadsheetId, range: dummyRange, accessToken: dummyAccessToken },
          { fetch: mockFetch }
        )
      ).rejects.toMatchObject({
        code: 'ACCESS_DENIED',
        status: 403,
      });
    });

    it('404 응답 시 SPREADSHEET_NOT_FOUND 에러를 던진다', async () => {
      const mockFetch: typeof fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response);

      await expect(
        fetchGoogleSheetValues(
          { spreadsheetId: dummySpreadsheetId, range: dummyRange, accessToken: dummyAccessToken },
          { fetch: mockFetch }
        )
      ).rejects.toMatchObject({
        code: 'SPREADSHEET_NOT_FOUND',
        status: 404,
      });
    });

    it('429 응답 시 RATE_LIMITED 에러를 던진다', async () => {
      const mockFetch: typeof fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      } as Response);

      await expect(
        fetchGoogleSheetValues(
          { spreadsheetId: dummySpreadsheetId, range: dummyRange, accessToken: dummyAccessToken },
          { fetch: mockFetch }
        )
      ).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        status: 429,
      });
    });

    it('500 서버 에러 응답 시 SERVER_ERROR를 던진다', async () => {
      const mockFetch: typeof fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      await expect(
        fetchGoogleSheetValues(
          { spreadsheetId: dummySpreadsheetId, range: dummyRange, accessToken: dummyAccessToken },
          { fetch: mockFetch }
        )
      ).rejects.toMatchObject({
        code: 'SERVER_ERROR',
        status: 500,
      });
    });

    it('JSON 파싱 실패 시 INVALID_JSON 에러를 던진다', async () => {
      const mockFetch: typeof fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(new Error('SyntaxError: Unexpected token')),
      } as unknown as Response);

      await expect(
        fetchGoogleSheetValues(
          { spreadsheetId: dummySpreadsheetId, range: dummyRange, accessToken: dummyAccessToken },
          { fetch: mockFetch }
        )
      ).rejects.toMatchObject({
        code: 'INVALID_JSON',
      });
    });
  });

  describe('타임아웃 및 Abort 레이스 처리', () => {
    it('요청이 timeoutMs를 초과하면 TIMEOUT 에러를 던지고 중단한다', async () => {
      const mockFetch: typeof fetch = vi.fn().mockImplementation(
        (_url, init?: RequestInit) =>
          new Promise((_, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new Error('AbortError'));
            });
          })
      );

      await expect(
        fetchGoogleSheetValues(
          {
            spreadsheetId: dummySpreadsheetId,
            range: dummyRange,
            accessToken: dummyAccessToken,
            timeoutMs: 30,
          },
          { fetch: mockFetch }
        )
      ).rejects.toMatchObject({
        code: 'TIMEOUT',
      });
    });

    it('외부 signal이 abort되면 해당 reason으로 중단된다', async () => {
      const controller = new AbortController();
      controller.abort(new Error('User cancelled'));

      await expect(
        fetchGoogleSheetValues({
          spreadsheetId: dummySpreadsheetId,
          range: dummyRange,
          accessToken: dummyAccessToken,
          signal: controller.signal,
        })
      ).rejects.toThrow('User cancelled');
    });
  });

  describe('정상 데이터 파싱 및 셀 원형 보존', () => {
    it('Google Sheets API v4 규격 URL 및 FORMATTED_VALUE 쿼리로 호출한다', async () => {
      let requestedUrl = '';
      let requestedHeaders: Record<string, string> = {};

      const mockFetch: typeof fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        requestedUrl = url;
        requestedHeaders = (init?.headers as Record<string, string>) || {};
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              range: "'시트1'!A1:C3",
              majorDimension: 'ROWS',
              values: [
                ['상품명', '가격', '출시일'],
                ['딸기 스무디', '₩15,000', '2026-11-11'],
                ['블루베리 주스', '₩12,500', '2026-11-12'],
              ],
            }),
        } as Response);
      });

      const result = await fetchGoogleSheetValues(
        { spreadsheetId: dummySpreadsheetId, range: dummyRange, accessToken: dummyAccessToken },
        { fetch: mockFetch }
      );

      expect(requestedUrl).toBe(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(dummySpreadsheetId)}/values/${encodeURIComponent(dummyRange)}?valueRenderOption=FORMATTED_VALUE`
      );
      expect(requestedHeaders['Authorization']).toBe(`Bearer ${dummyAccessToken}`);
      expect(result.derivedFromGoogle).toBe(true);
      expect(result.spreadsheetId).toBe(dummySpreadsheetId);
      expect(result.range).toBe(dummyRange);
      expect(result.rowCount).toBe(3);
      expect(result.columnCount).toBe(3);
      expect(result.headers).toEqual(['상품명', '가격', '출시일']);
      expect(result.rows).toEqual([
        ['딸기 스무디', '₩15,000', '2026-11-11'],
        ['블루베리 주스', '₩12,500', '2026-11-12'],
      ]);
      expect(result.truncated).toBe(false);
      expect(result.warnings).toEqual([]);
    });

    it('가격(₩), 날짜, 빈 셀(null, "")의 원형을 파괴하지 않고 보존한다', async () => {
      const mockFetch: typeof fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            range: 'Sheet1!A1:D3',
            values: [
              ['메뉴', '가격', '할인율', '비고'],
              ['아메리카노', '₩4,500', '10%', null],
              ['카페라떼', '₩5,000', '', '인기 메뉴'],
            ],
          }),
      } as Response);

      const result = await fetchGoogleSheetValues(
        { spreadsheetId: dummySpreadsheetId, range: 'Sheet1!A1:D3', accessToken: dummyAccessToken },
        { fetch: mockFetch }
      );

      expect(result.headers).toEqual(['메뉴', '가격', '할인율', '비고']);
      expect(result.rows).toEqual([
        ['아메리카노', '₩4,500', '10%', ''],
        ['카페라떼', '₩5,000', '', '인기 메뉴'],
      ]);
      expect(result.rowCount).toBe(3);
      expect(result.columnCount).toBe(4);
    });

    it('values가 비어있거나 누락된 경우 빈 결과를 반환한다', async () => {
      const mockFetch: typeof fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            range: 'Sheet1!A1:B1',
          }),
      } as Response);

      const result = await fetchGoogleSheetValues(
        { spreadsheetId: dummySpreadsheetId, range: 'Sheet1!A1:B1', accessToken: dummyAccessToken },
        { fetch: mockFetch }
      );

      expect(result.headers).toEqual([]);
      expect(result.rows).toEqual([]);
      expect(result.rowCount).toBe(0);
      expect(result.columnCount).toBe(0);
      expect(result.totalCharCount).toBe(0);
      expect(result.truncated).toBe(false);
    });
  });

  describe('수식 인젝션 (Formula Injection) 방어', () => {
    it('셀이 =, +, -, @ 로 시작할 경우 앞에 따옴표를 붙여 살균하고 경고를 기록한다', async () => {
      const mockFetch: typeof fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            range: 'Sheet1!A1:D2',
            values: [
              ['=SUM(A1:A10)', '+cmd|"/C calc"!A0', '-1+2', '@attack'],
              ['일반 텍스트', '₩15,000', '2026-11-11', '정상 데이터'],
            ],
          }),
      } as Response);

      const result = await fetchGoogleSheetValues(
        { spreadsheetId: dummySpreadsheetId, range: 'Sheet1!A1:D2', accessToken: dummyAccessToken },
        { fetch: mockFetch }
      );

      // 앞에 따옴표가 붙어야 함
      expect(result.headers[0]).toBe("'=SUM(A1:A10)");
      expect(result.headers[1]).toBe("'+cmd|\"/C calc\"!A0");
      expect(result.headers[2]).toBe("'-1+2");
      expect(result.headers[3]).toBe("'@attack");

      // 일반 데이터는 그대로 유지
      expect(result.rows[0]).toEqual(['일반 텍스트', '₩15,000', '2026-11-11', '정상 데이터']);

      // 경고가 남아야 함
      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
      expect(result.warnings.some((w) => w.includes('Formula injection'))).toBe(true);
    });
  });

  describe('예산 제한 및 절삭 (Truncation)', () => {
    it('500행 초과 시 최대 500행으로 절삭하고 truncated 플래그 및 경고를 반환한다', async () => {
      // 505행 생성
      const values = Array.from({ length: 505 }, (_, i) => [`R${i}C0`, `R${i}C1`]);

      const mockFetch: typeof fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ values }),
      } as Response);

      const result = await fetchGoogleSheetValues(
        { spreadsheetId: dummySpreadsheetId, range: dummyRange, accessToken: dummyAccessToken, maxRows: 500 },
        { fetch: mockFetch }
      );

      expect(result.rowCount).toBe(500);
      expect(result.headers).toEqual(['R0C0', 'R0C1']);
      expect(result.rows.length).toBe(499); // headers 1행 + rows 499행 = 500행
      expect(result.truncated).toBe(true);
      expect(result.warnings.some((w) => w.includes('row'))).toBe(true);
    });

    it('50열 초과 시 최대 50열로 절삭하고 truncated 플래그 및 경고를 반환한다', async () => {
      // 60열 생성
      const row = Array.from({ length: 60 }, (_, i) => `Col${i}`);

      const mockFetch: typeof fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ values: [row] }),
      } as Response);

      const result = await fetchGoogleSheetValues(
        { spreadsheetId: dummySpreadsheetId, range: dummyRange, accessToken: dummyAccessToken, maxCols: 50 },
        { fetch: mockFetch }
      );

      expect(result.columnCount).toBe(50);
      expect(result.headers.length).toBe(50);
      expect(result.truncated).toBe(true);
      expect(result.warnings.some((w) => w.includes('column'))).toBe(true);
    });

    it('500,000자 초과 시 문자열을 안전하게 절삭하고 truncated 플래그 및 경고를 반환한다', async () => {
      const longCell = 'x'.repeat(1000);
      // 5개 셀 = 5000자, maxChars를 3000으로 제한
      const mockFetch: typeof fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            values: [
              ['H1', 'H2'],
              [longCell, longCell],
              [longCell, longCell],
            ],
          }),
      } as Response);

      const result = await fetchGoogleSheetValues(
        {
          spreadsheetId: dummySpreadsheetId,
          range: dummyRange,
          accessToken: dummyAccessToken,
          maxChars: 3000,
        },
        { fetch: mockFetch }
      );

      expect(result.totalCharCount).toBeLessThanOrEqual(3000);
      expect(result.truncated).toBe(true);
      expect(result.warnings.some((w) => w.includes('character') || w.includes('char'))).toBe(true);
    });
  });
});
