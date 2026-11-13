import { DomainToolHandler, ToolExecutionContext, ToolExecutionResult } from '../types';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { resolveAdAccount } from './ads-dispatcher';

export interface ResultsDateRange {
  startDate: string;
  endDate: string;
  label: string;
}

export function resolveResultsDateRange(args: Record<string, unknown>): ResultsDateRange {
  const now = new Date();

  if (typeof args.startDate === 'string' && typeof args.endDate === 'string') {
    return {
      startDate: new Date(args.startDate).toISOString(),
      endDate: new Date(args.endDate).toISOString(),
      label: `${args.startDate.slice(0, 10)} ~ ${args.endDate.slice(0, 10)}`,
    };
  }

  const periodRaw = String(args.period || args.dateRange || args.since || args.timeRange || '')
    .trim()
    .toLowerCase();

  if (
    periodRaw.includes('지난주') ||
    periodRaw.includes('last_week') ||
    periodRaw.includes('past_week')
  ) {
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      label: '지난 1주일',
    };
  }

  if (periodRaw.includes('이번주') || periodRaw.includes('this_week')) {
    const end = new Date(now);
    const start = new Date(now);
    const day = start.getDay();
    const diff = start.getDate() - day + (day === 0 ? -6 : 1);
    start.setDate(diff);
    start.setHours(0, 0, 0, 0);
    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      label: '이번 주',
    };
  }

  if (periodRaw.includes('이번달') || periodRaw.includes('this_month')) {
    const end = new Date(now);
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      label: '이번 달',
    };
  }

  if (periodRaw.includes('지난달') || periodRaw.includes('last_month')) {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      label: '지난 달',
    };
  }

  if (periodRaw.includes('오늘') || periodRaw.includes('today')) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return {
      startDate: start.toISOString(),
      endDate: now.toISOString(),
      label: '오늘',
    };
  }

  if (periodRaw.includes('어제') || periodRaw.includes('yesterday')) {
    const start = new Date(now);
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      label: '어제',
    };
  }

  if (
    periodRaw.includes('30') ||
    periodRaw.includes('한달') ||
    periodRaw.includes('month')
  ) {
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    start.setHours(0, 0, 0, 0);
    return {
      startDate: start.toISOString(),
      endDate: now.toISOString(),
      label: '최근 30일',
    };
  }

  // Default: 최근 7일
  const start = new Date(now);
  start.setDate(start.getDate() - 7);
  start.setHours(0, 0, 0, 0);
  return {
    startDate: start.toISOString(),
    endDate: now.toISOString(),
    label: '최근 7일',
  };
}

export const resultsDispatcher: DomainToolHandler = {
  toolId: 'results.domain',
  domain: 'RESULTS',

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const rawToolName = String(args._toolName || args.toolName || 'performance.summary');
    const range = resolveResultsDateRange(args);

    context.signal?.throwIfAborted();
    const read = async (query: any) => {
      context.signal?.throwIfAborted();
      const result = await (context.signal ? query.abortSignal(context.signal) : query);
      context.signal?.throwIfAborted();
      return result;
    };
    let supabase: any;
    try {
      supabase = context.readClient ?? await createServerSupabaseClient();
      context.signal?.throwIfAborted();
    } catch {
      context.signal?.throwIfAborted();
      return {
        success: false,
        toolId: rawToolName,
        status: 'FAILED',
        error: {
          code: 'DATABASE_CONNECTION_ERROR',
          message: '데이터베이스 연결을 초기화하지 못했습니다.',
        },
      };
    }

    try {
      // 1. Published posts verification (from external_action_requests)
      const { data: publishRows, error: publishErr } = await read(supabase
        .from('external_action_requests')
        .select('id, channel, action_kind, status, created_at')
        .eq('workspace_id', context.workspaceId)
        .eq('status', 'succeeded')
        .in('action_kind', ['feed_publish', 'thread_publish', 'blog_post', 'business_news_post'])
        .gte('created_at', range.startDate)
        .lte('created_at', range.endDate));

      if (publishErr) {
        throw new Error(`게시물 발행 확인 내역 조회 실패: ${publishErr.message}`);
      }

      // 2. Drafts created (from channel_drafts)
      const { data: draftRows, error: draftErr } = await read(supabase
        .from('channel_drafts')
        .select('id, created_at')
        .eq('workspace_id', context.workspaceId)
        .gte('created_at', range.startDate)
        .lte('created_at', range.endDate));

      if (draftErr) {
        throw new Error(`초안 작성 내역 조회 실패: ${draftErr.message}`);
      }

      // 3. Vault saved items (from vault_items)
      const { data: vaultRows, error: vaultErr } = await read(supabase
        .from('vault_items')
        .select('id, created_at, deleted_at')
        .eq('workspace_id', context.workspaceId)
        .is('deleted_at', null)
        .gte('created_at', range.startDate)
        .lte('created_at', range.endDate));

      if (vaultErr) {
        throw new Error(`보관함 저장 내역 조회 실패: ${vaultErr.message}`);
      }

      // 4. Credits used (from credit_ledger_entries)
      const { data: creditRows, error: creditErr } = await read(supabase
        .from('credit_ledger_entries')
        .select('id, amount, kind, occurred_at')
        .eq('workspace_id', context.workspaceId)
        .eq('kind', 'consume')
        .gte('occurred_at', range.startDate)
        .lte('occurred_at', range.endDate));

      if (creditErr) {
        throw new Error(`크레딧 사용 내역 조회 실패: ${creditErr.message}`);
      }

      // 5. Confirmed reservations (from reservations)
      const { data: reservationRows, error: resErr } = await read(supabase
        .from('reservations')
        .select('id, status, confirmed_at, created_at')
        .eq('workspace_id', context.workspaceId)
        .eq('status', 'CONFIRMED')
        .gte('confirmed_at', range.startDate)
        .lte('confirmed_at', range.endDate));

      if (resErr) {
        throw new Error(`예약 확정 내역 조회 실패: ${resErr.message}`);
      }

      if (![publishRows, draftRows, vaultRows, creditRows, reservationRows].every(Array.isArray)) {
        throw new Error('RESULTS_READ_UNAVAILABLE');
      }

      // Aggregate published posts by channel
      const byChannel: Record<string, number> = {};
      for (const row of publishRows || []) {
        const ch = String(row.channel || 'unknown').toLowerCase();
        byChannel[ch] = (byChannel[ch] || 0) + 1;
      }
      const publishedTotal = (publishRows || []).length;
      const draftsTotal = (draftRows || []).length;
      const vaultTotal = (vaultRows || []).length;

      let creditsUsedTotal = 0;
      for (const row of creditRows || []) {
        creditsUsedTotal += Math.abs(Number(row.amount) || 0);
      }
      const reservationsTotal = (reservationRows || []).length;

      // 6. Ad spend: 이 도구는 합계를 만들지 않는다. 캠페인 단위 실측은 광고 성과 조회(ads.list)가 담당한다.
      //    연동 여부만 확인하고, 지출 숫자는 만들어내지 않는다.
      let adSpend: {
        value: number | null;
        state: 'OK' | 'EMPTY' | 'UNAVAILABLE';
        reason?: string;
      } = {
        value: null,
        state: 'UNAVAILABLE',
        reason: '광고 계정이 연동되어 있지 않아요',
      };

      try {
        const adAccount = context.readClient
          ? await resolveAdAccount(context.workspaceId, context.signal, context.readClient)
          : await resolveAdAccount(context.workspaceId, context.signal);
        if (adAccount.connected) {
          adSpend = {
            value: null,
            state: 'UNAVAILABLE',
            reason: '광고 지출은 "광고 성과 알려줘"로 캠페인별 실측을 따로 확인해 드려요',
          };
        }
      } catch {
        context.signal?.throwIfAborted();
        // 연동 여부를 알 수 없으면 기본 문구 유지
      }

      // 7. Revenue: No verified settlement ledger exists
      const revenue = {
        value: null,
        state: 'UNAVAILABLE' as const,
        reason: '매출 데이터가 연동되어 있지 않아요',
      };

      // Summary text in natural Korean without internal status codes
      const channelLabels: Record<string, string> = {
        instagram: '인스타그램',
        threads: '스레드',
        naver_blog: '네이버 블로그',
        daangn_business: '당근 비즈니스',
      };

      const channelDetails = Object.entries(byChannel)
        .map(([ch, cnt]) => `${channelLabels[ch] || ch} ${cnt}건`)
        .join(', ');

      const publishSummary = publishedTotal > 0
        ? `게시 완료로 기록된 글 ${publishedTotal}건${channelDetails ? ` (${channelDetails})` : ''}`
        : '게시 완료로 기록된 글 0건';

      const adSpendSummary = adSpend.state === 'OK'
        ? `₩${(adSpend.value || 0).toLocaleString()}`
        : (adSpend.reason || '확인할 수 없어요');

      const summaryLines = [
        `${range.label} 동안 소희에 기록된 매장 활동이에요:`,
        `• SNS 게시: ${publishSummary}`,
        `• 콘텐츠 작성: 초안 ${draftsTotal}건, 보관함 저장 ${vaultTotal}건`,
        `• 소희 크레딧 사용: ${creditsUsedTotal.toLocaleString()} SC`,
        `• 고객 예약: ${reservationsTotal > 0 ? `${reservationsTotal}건 확정` : '0건'}`,
        `• 광고 지출: ${adSpendSummary}`,
        `• 매출: ${revenue.reason}`,
      ];

      return {
        success: true,
        toolId: rawToolName,
        status: 'COMPLETED',
        data: {
          period: range,
          metrics: {
            publishedPosts: {
              total: publishedTotal,
              byChannel,
              state: publishedTotal > 0 ? 'OK' : 'EMPTY',
            },
            draftsCreated: {
              total: draftsTotal,
              state: draftsTotal > 0 ? 'OK' : 'EMPTY',
            },
            vaultSaved: {
              total: vaultTotal,
              state: vaultTotal > 0 ? 'OK' : 'EMPTY',
            },
            creditsUsed: {
              total: creditsUsedTotal,
              state: creditsUsedTotal > 0 ? 'OK' : 'EMPTY',
            },
            reservationsCount: {
              total: reservationsTotal,
              state: reservationsTotal > 0 ? 'OK' : 'EMPTY',
            },
            adSpendKrw: adSpend,
            revenueKrw: revenue,
          },
          summaryText: summaryLines.join('\n'),
        },
        logs: [
          `실측 성과 원장 조회 완료 (게시: ${publishedTotal}건, 초안: ${draftsTotal}건, 보관: ${vaultTotal}건, 크레딧: ${creditsUsedTotal} SC, 예약: ${reservationsTotal}건)`,
        ],
      };
    } catch (err: unknown) {
      context.signal?.throwIfAborted();
      console.error('[results-dispatcher] query failed:', err instanceof Error ? err.message : 'unknown');
      return {
        success: false,
        toolId: rawToolName,
        status: 'FAILED',
        error: {
          code: 'PERFORMANCE_QUERY_FAILED',
          message: '성과 데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
        },
      };
    }
  },
};
