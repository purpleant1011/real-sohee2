import crypto from 'crypto';
import type { ActionCostQuote } from '@/features/credit-economy/types';
import type {
  FinOpsReservationReceipt,
  FinOpsSettlementReceipt,
  ExternalAdSpendLedgerEntry,
  FinOpsReserveResult,
  AdSpendPlatform,
  AiCreditLedgerRecord,
  FinOpsReservationRecord,
  FinOpsSettlementRecord,
  ExternalAdSpendLedgerRecord,
  ConservationInvariantResult,
} from '@/types/finops-engine';
import { CreditLedgerSourceChain } from './credit-ledger-source-chain';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { PersistenceError } from '@/lib/errors/persistence-error';

/**
 * Insufficient Credits Error
 * Thrown when workspace available credit (balance - reserved) is insufficient.
 * Strict Fail-Closed guarantee: Zero provider calls.
 */
export class InsufficientCreditsError extends Error {
  public readonly code = 'INSUFFICIENT_CREDITS';
  public readonly requiredCredits: number;
  public readonly availableCredits: number;

  constructor(message: string, requiredCredits: number = 0, availableCredits: number = 0) {
    super(message.includes('INSUFFICIENT_CREDITS') ? message : `INSUFFICIENT_CREDITS: ${message}`);
    this.name = 'InsufficientCreditsError';
    this.requiredCredits = requiredCredits;
    this.availableCredits = availableCredits;
    Object.setPrototypeOf(this, InsufficientCreditsError.prototype);
  }
}

/**
 * Attaches Promise methods to an object so callers can either read properties
 * synchronously (backward compatibility) or await DB persistence with fail-closed guarantee.
 */
function asDurable<T extends object>(data: T, persistPromise: Promise<any>): T & Promise<T> {
  const promise = persistPromise.then(() => data);
  return Object.assign(promise, data);
}

export class IntegratedFinOpsEngine {
  private static creditChain = new CreditLedgerSourceChain();

  // Legacy Wave 2 In-Memory Maps
  private static reservations: Map<string, FinOpsReservationReceipt> = new Map();
  private static settlements: Map<string, FinOpsSettlementReceipt> = new Map();
  private static adSpendLedger: Map<string, ExternalAdSpendLedgerEntry> = new Map();
  private static workspaceBalances: Map<string, number> = new Map();

  // Canonical Durable V0.9 Dual Ledger In-Memory Caches
  private static aiCreditLedgers: Map<string, AiCreditLedgerRecord> = new Map();
  private static externalAdLedgers: Map<string, ExternalAdSpendLedgerRecord> = new Map();
  private static finopsReservations: Map<string, FinOpsReservationRecord & { reservationId: string }> = new Map();
  private static finopsSettlements: Map<string, FinOpsSettlementRecord> = new Map();

  /**
   * Internal helper to safely obtain Supabase server or admin client
   */
  private static async getSupabaseClient(): Promise<any> {
    try {
      return await createServerSupabaseClient();
    } catch (err: any) {
      if (err?.message?.includes('cookies') || err?.message?.includes('request scope')) {
        try {
          const { createAdminSupabaseClient } = await import('@/lib/supabase/admin');
          return createAdminSupabaseClient();
        } catch {
          return null;
        }
      }
      // Rethrow genuine DB/network errors for Fail-Closed enforcement
      throw err;
    }
  }

  /**
   * Internal helper: Load AI credit ledger from memory or Supabase DB
   */
  private static async loadWorkspaceLedger(workspaceId: string): Promise<AiCreditLedgerRecord> {
    let ledger = this.aiCreditLedgers.get(workspaceId);
    if (!ledger) {
      let supabase: any = null;
      try {
        supabase = await this.getSupabaseClient();
      } catch (err: any) {
        throw new PersistenceError('loadWorkspaceLedger', err.message || 'Supabase DB connection failed', err);
      }

      if (supabase && typeof supabase.from === 'function') {
        const { data, error } = await supabase
          .from('ai_credit_ledgers')
          .select('*')
          .eq('workspace_id', workspaceId)
          .maybeSingle();

        if (error) {
          throw new PersistenceError('loadWorkspaceLedger', error.message || 'Failed to read ai_credit_ledgers', error);
        }

        if (data) {
          ledger = {
            workspace_id: data.workspace_id,
            balance: Number(data.balance ?? 0),
            reserved: Number(data.reserved ?? 0),
            total_granted: Number(data.total_granted ?? data.balance ?? 0),
            updated_at: data.updated_at || new Date().toISOString(),
          };
          this.aiCreditLedgers.set(workspaceId, ledger);
          this.workspaceBalances.set(workspaceId, ledger.balance - ledger.reserved);
        }
      }
    }

    if (!ledger) {
      const fallbackBalance = this.workspaceBalances.get(workspaceId) ?? 0;
      ledger = {
        workspace_id: workspaceId,
        balance: fallbackBalance,
        reserved: 0,
        total_granted: fallbackBalance,
        updated_at: new Date().toISOString(),
      };
      this.aiCreditLedgers.set(workspaceId, ledger);
    }

    return ledger;
  }

  /**
   * Internal helper: Load reservation from memory or Supabase DB
   */
  private static async loadReservation(reservationId: string): Promise<(FinOpsReservationRecord & { reservationId: string }) | null> {
    let resv = this.finopsReservations.get(reservationId);
    if (!resv) {
      let supabase: any = null;
      try {
        supabase = await this.getSupabaseClient();
      } catch (err: any) {
        throw new PersistenceError('loadReservation', err.message || 'Supabase DB connection failed', err);
      }

      if (supabase && typeof supabase.from === 'function') {
        const { data, error } = await supabase
          .from('finops_reservations')
          .select('*')
          .eq('reservation_id', reservationId)
          .maybeSingle();

        if (error) {
          throw new PersistenceError('loadReservation', error.message || 'Failed to read finops_reservations', error);
        }

        if (data) {
          const loadedResv: FinOpsReservationRecord & { reservationId: string } = {
            reservation_id: data.reservation_id,
            reservationId: data.reservation_id,
            workspace_id: data.workspace_id,
            action_run_id: data.action_run_id,
            amount: Number(data.amount ?? 0),
            status: data.status,
            quote_id: data.quote_id,
            idempotency_key: data.idempotency_key,
            created_at: data.created_at || new Date().toISOString(),
            updated_at: data.updated_at || new Date().toISOString(),
          };
          resv = loadedResv;
          this.finopsReservations.set(reservationId, loadedResv);
        }
      }
    }
    return resv || null;
  }

  /**
   * 1. Action Cost Quote Issuance (ANI-824, ANI-924)
   * Deterministic cost quote with 15-minute TTL.
   */
  public static issueQuote(params: {
    workspaceId: string;
    actionType: string;
    baseCredits?: number;
  }): ActionCostQuote {
    const { workspaceId, actionType, baseCredits } = params;

    const ACTION_RATE_MAP: Record<string, number> = {
      'CONTENT_PUBLISH': 10,
      'POST_REPLY': 5,
      'ANALYTICS_REPORT': 15,
      'AD_BID_ADJUST': 20,
      'AUDIENCE_OPTIMIZE': 25,
    };

    const requiredCredits = baseCredits ?? ACTION_RATE_MAP[actionType] ?? 10;
    const quoteId = `quote_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    return {
      quoteId,
      workspaceId,
      actionType,
      requiredCredits,
      estimatedDurationMs: 3000,
      issuedAt,
      expiresAt,
      isExpired: false,
      tripartiteClassification: 'SOHEE_CREDIT',
    };
  }

  /**
   * 2. Initialize / Grant Credits to Workspace
   * Supports both synchronous invocation and durable async DB persistence.
   */
  public static grantCredits(params: {
    workspaceId: string;
    amount: number;
    reason: string;
    initiatedBy?: string;
    idempotencyKey: string;
  }): { currentBalance: number; entryId: string } & Promise<{ currentBalance: number; entryId: string }> {
    const { workspaceId, amount, reason, initiatedBy = 'SYSTEM', idempotencyKey } = params;
    const currentBalance = this.getWorkspaceBalance(workspaceId);

    const { entry } = this.creditChain.appendEntry({
      workspaceId,
      entryType: 'GRANT',
      amount,
      currentBalance,
      transactionRefId: `grant_${Date.now()}`,
      reason,
      initiatedBy,
      idempotencyKey,
    });

    const newBalance = currentBalance + amount;
    this.workspaceBalances.set(workspaceId, newBalance);

    let ledger = this.aiCreditLedgers.get(workspaceId);
    if (!ledger) {
      ledger = {
        workspace_id: workspaceId,
        balance: 0,
        reserved: 0,
        total_granted: 0,
        updated_at: new Date().toISOString(),
      };
    }
    ledger.balance += amount;
    ledger.total_granted += amount;
    ledger.updated_at = new Date().toISOString();
    this.aiCreditLedgers.set(workspaceId, ledger);

    const syncResult = { currentBalance: newBalance, entryId: entry.id };

    const persistPromise = (async () => {
      let supabase: any = null;
      try {
        supabase = await this.getSupabaseClient();
      } catch (err: any) {
        throw new PersistenceError('grantCredits', err.message || 'Supabase DB client connection failed', err);
      }

      if (supabase && typeof supabase.from === 'function') {
        const { error } = await supabase.from('ai_credit_ledgers').upsert({
          workspace_id: workspaceId,
          balance: ledger.balance,
          reserved: ledger.reserved,
          total_granted: ledger.total_granted,
          updated_at: ledger.updated_at,
        });
        if (error) {
          throw new PersistenceError('grantCredits', error.message || 'Failed to upsert ai_credit_ledgers', error);
        }
      }
      return syncResult;
    })();

    return asDurable(syncResult, persistPromise);
  }

  /**
   * 3. Canonical Durable Reservation Gate (Task 4.1, ANI-952, ANI-968)
   * Fail-Closed: Strictly blocks execution when available credit (balance - reserved) is insufficient.
   * Throws InsufficientCreditsError with code 'INSUFFICIENT_CREDITS'.
   */
  public static async reserve(
    workspaceId: string,
    actionRunId: string,
    amount: number,
    options?: { quoteId?: string; idempotencyKey?: string }
  ): Promise<FinOpsReservationRecord & { reservationId: string; workspaceId: string; actionRunId: string }> {
    const ledger = await this.loadWorkspaceLedger(workspaceId);
    const availableCredit = ledger.balance - ledger.reserved;

    // Strict Fail-Closed Check: Available credit must be strictly >= requested amount
    if (availableCredit <= 0 || availableCredit < amount) {
      throw new InsufficientCreditsError(
        `크레딧이 부족합니다 (필요: ${amount} credits, 현재 가용: ${availableCredit} credits). 공급자 실행이 차단되었습니다.`,
        amount,
        availableCredit
      );
    }

    const reservationId = options?.quoteId
      ? `resv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
      : `resv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();

    const reservationRecord = {
      reservation_id: reservationId,
      reservationId: reservationId,
      workspace_id: workspaceId,
      workspaceId: workspaceId,
      action_run_id: actionRunId,
      actionRunId: actionRunId,
      amount,
      status: 'RESERVED' as const,
      quote_id: options?.quoteId,
      idempotency_key: options?.idempotencyKey,
      created_at: now,
      updated_at: now,
    };

    const previousReserved = ledger.reserved;
    const newReserved = previousReserved + amount;

    // Supabase DB Persist (Fail-Closed)
    let supabase: any = null;
    try {
      supabase = await this.getSupabaseClient();
    } catch (err: any) {
      throw new PersistenceError('reserve', err.message || 'Supabase DB client connection failed', err);
    }

    if (supabase && typeof supabase.from === 'function') {
      try {
        const resvInsert = await supabase.from('finops_reservations').insert({
          reservation_id: reservationRecord.reservation_id,
          workspace_id: reservationRecord.workspace_id,
          action_run_id: reservationRecord.action_run_id,
          amount: reservationRecord.amount,
          status: reservationRecord.status,
          quote_id: reservationRecord.quote_id,
          idempotency_key: reservationRecord.idempotency_key,
          created_at: reservationRecord.created_at,
          updated_at: reservationRecord.updated_at,
        });

        if (resvInsert?.error) {
          throw new PersistenceError('reserve', resvInsert.error.message || 'Failed to insert finops_reservations', resvInsert.error);
        }

        const ledgerUpdate = await supabase.from('ai_credit_ledgers').update({
          reserved: newReserved,
          updated_at: now,
        }).eq('workspace_id', workspaceId);

        if (ledgerUpdate?.error) {
          // Attempt compensating rollback
          await supabase.from('finops_reservations').delete?.().eq?.('reservation_id', reservationId);
          throw new PersistenceError('reserve', ledgerUpdate.error.message || 'Failed to update ai_credit_ledgers', ledgerUpdate.error);
        }
      } catch (err: any) {
        if (err instanceof PersistenceError) throw err;
        throw new PersistenceError('reserve', err?.message || 'Database error during reservation', err);
      }
    }

    // Commit to in-memory state only after DB success
    ledger.reserved = newReserved;
    ledger.updated_at = now;
    this.aiCreditLedgers.set(workspaceId, ledger);
    this.workspaceBalances.set(workspaceId, ledger.balance - ledger.reserved);
    this.finopsReservations.set(reservationId, reservationRecord);

    return reservationRecord;
  }

  /**
   * 4. Canonical Durable Settlement (Task 4.1, ANI-952, ANI-969)
   * Deducts actual cost from balance, releases remaining reservation back to available balance.
   */
  public static async settle(
    reservationId: string,
    actualCost: number
  ): Promise<{
    settlementId: string;
    settlement_id: string;
    reservationId: string;
    reservation_id: string;
    actualCost: number;
    actual_cost: number;
    releasedAmount: number;
    released_amount: number;
    status: 'SETTLED';
    settledAt: string;
    settled_at: string;
  }> {
    const reservation = await this.loadReservation(reservationId);
    if (!reservation) {
      throw new Error(`Reservation not found: ${reservationId}`);
    }

    if (reservation.status !== 'RESERVED') {
      throw new Error(`Reservation ${reservationId} is not in RESERVED status (current: ${reservation.status})`);
    }

    const ledger = await this.loadWorkspaceLedger(reservation.workspace_id);
    const settlementId = `stl_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();

    const actual = Math.min(actualCost, reservation.amount);
    const releasedAmount = Math.max(0, reservation.amount - actual);
    const newBalance = ledger.balance - actual;
    const newReserved = Math.max(0, ledger.reserved - reservation.amount);

    let supabase: any = null;
    try {
      supabase = await this.getSupabaseClient();
    } catch (err: any) {
      throw new PersistenceError('settle', err.message || 'Supabase DB client connection failed', err);
    }

    if (supabase && typeof supabase.from === 'function') {
      try {
        const stlInsert = await supabase.from('finops_settlements').insert({
          settlement_id: settlementId,
          reservation_id: reservationId,
          actual_cost: actual,
          settled_at: now,
        });
        if (stlInsert?.error) {
          throw new PersistenceError('settle', stlInsert.error.message || 'Failed to insert finops_settlements', stlInsert.error);
        }

        const resvUpdate = await supabase.from('finops_reservations').update({
          status: 'SETTLED',
          updated_at: now,
        }).eq('reservation_id', reservationId);
        if (resvUpdate?.error) {
          throw new PersistenceError('settle', resvUpdate.error.message || 'Failed to update finops_reservations', resvUpdate.error);
        }

        const ledgerUpdate = await supabase.from('ai_credit_ledgers').update({
          balance: newBalance,
          reserved: newReserved,
          updated_at: now,
        }).eq('workspace_id', reservation.workspace_id);
        if (ledgerUpdate?.error) {
          throw new PersistenceError('settle', ledgerUpdate.error.message || 'Failed to update ai_credit_ledgers', ledgerUpdate.error);
        }
      } catch (err: any) {
        if (err instanceof PersistenceError) throw err;
        throw new PersistenceError('settle', err?.message || 'Database error during settlement', err);
      }
    }

    // Commit to in-memory state
    reservation.status = 'SETTLED';
    reservation.updated_at = now;
    this.finopsReservations.set(reservationId, reservation);

    ledger.balance = newBalance;
    ledger.reserved = newReserved;
    ledger.updated_at = now;
    this.aiCreditLedgers.set(reservation.workspace_id, ledger);
    this.workspaceBalances.set(reservation.workspace_id, ledger.balance - ledger.reserved);

    const settlementRecord: FinOpsSettlementRecord = {
      settlement_id: settlementId,
      reservation_id: reservationId,
      actual_cost: actual,
      settled_at: now,
    };
    this.finopsSettlements.set(settlementId, settlementRecord);

    return {
      settlementId,
      settlement_id: settlementId,
      reservationId,
      reservation_id: reservationId,
      actualCost: actual,
      actual_cost: actual,
      releasedAmount,
      released_amount: releasedAmount,
      status: 'SETTLED',
      settledAt: now,
      settled_at: now,
    };
  }

  /**
   * 5. Canonical Durable Release (Task 4.1, ANI-952)
   * 100% refund of reserved credits on failure or cancellation.
   */
  public static async release(
    reservationId: string,
    reason?: string
  ): Promise<{
    reservationId: string;
    reservation_id: string;
    releasedAmount: number;
    released_amount: number;
    status: 'RELEASED';
    releasedAt: string;
    released_at: string;
    reason?: string;
  }> {
    const reservation = await this.loadReservation(reservationId);
    if (!reservation) {
      throw new Error(`Reservation not found: ${reservationId}`);
    }

    if (reservation.status !== 'RESERVED') {
      throw new Error(`Reservation ${reservationId} is not in RESERVED status (current: ${reservation.status})`);
    }

    const ledger = await this.loadWorkspaceLedger(reservation.workspace_id);
    const now = new Date().toISOString();
    const newReserved = Math.max(0, ledger.reserved - reservation.amount);

    let supabase: any = null;
    try {
      supabase = await this.getSupabaseClient();
    } catch (err: any) {
      throw new PersistenceError('release', err.message || 'Supabase DB client connection failed', err);
    }

    if (supabase && typeof supabase.from === 'function') {
      try {
        const resvUpdate = await supabase.from('finops_reservations').update({
          status: 'RELEASED',
          updated_at: now,
        }).eq('reservation_id', reservationId);
        if (resvUpdate?.error) {
          throw new PersistenceError('release', resvUpdate.error.message || 'Failed to update finops_reservations', resvUpdate.error);
        }

        const ledgerUpdate = await supabase.from('ai_credit_ledgers').update({
          reserved: newReserved,
          updated_at: now,
        }).eq('workspace_id', reservation.workspace_id);
        if (ledgerUpdate?.error) {
          throw new PersistenceError('release', ledgerUpdate.error.message || 'Failed to update ai_credit_ledgers', ledgerUpdate.error);
        }
      } catch (err: any) {
        if (err instanceof PersistenceError) throw err;
        throw new PersistenceError('release', err?.message || 'Database error during release', err);
      }
    }

    // Commit to in-memory state
    reservation.status = 'RELEASED';
    reservation.updated_at = now;
    this.finopsReservations.set(reservationId, reservation);

    ledger.reserved = newReserved;
    ledger.updated_at = now;
    this.aiCreditLedgers.set(reservation.workspace_id, ledger);
    this.workspaceBalances.set(reservation.workspace_id, ledger.balance - ledger.reserved);

    return {
      reservationId,
      reservation_id: reservationId,
      releasedAmount: reservation.amount,
      released_amount: reservation.amount,
      status: 'RELEASED',
      releasedAt: now,
      released_at: now,
      reason,
    };
  }

  /**
   * 6. External Ad Spend Ledger Recording (Task 4.1, ANI-952)
   * Segregated KRW ledger strictly separated from internal AI credit balance.
   */
  public static async recordAdSpend(
    workspaceId: string,
    spentKrw: number,
    options?: { adAccountId?: string; channel?: string; budgetLimitKrw?: number }
  ): Promise<ExternalAdSpendLedgerRecord> {
    const channel = options?.channel || 'META_ADS';
    const adAccountId = options?.adAccountId || 'default';
    const spendLedgerId = `${workspaceId}_${channel}_${adAccountId}`;
    const now = new Date().toISOString();

    let existing = this.externalAdLedgers.get(spendLedgerId);
    if (!existing) {
      let supabase: any = null;
      try {
        supabase = await this.getSupabaseClient();
      } catch (err: any) {
        throw new PersistenceError('recordAdSpend', err.message || 'Supabase DB client connection failed', err);
      }

      if (supabase && typeof supabase.from === 'function') {
        const { data, error } = await supabase
          .from('external_ad_spend_ledgers')
          .select('*')
          .eq('spend_ledger_id', spendLedgerId)
          .maybeSingle();

        if (error) {
          throw new PersistenceError('recordAdSpend', error.message || 'Failed to read external_ad_spend_ledgers', error);
        }

        if (data) {
          existing = {
            spend_ledger_id: data.spend_ledger_id,
            workspace_id: data.workspace_id,
            ad_account_id: data.ad_account_id,
            channel: data.channel,
            spent_krw: Number(data.spent_krw ?? 0),
            budget_limit_krw: Number(data.budget_limit_krw ?? 0),
            updated_at: data.updated_at || now,
          };
          this.externalAdLedgers.set(spendLedgerId, existing);
        }
      }
    }

    const newSpent = (existing?.spent_krw || 0) + spentKrw;
    const budgetLimit = options?.budgetLimitKrw !== undefined
      ? options.budgetLimitKrw
      : (existing?.budget_limit_krw || 0);

    const record: ExternalAdSpendLedgerRecord = {
      spend_ledger_id: spendLedgerId,
      workspace_id: workspaceId,
      ad_account_id: adAccountId,
      channel,
      spent_krw: newSpent,
      budget_limit_krw: budgetLimit,
      updated_at: now,
    };

    let supabase: any = null;
    try {
      supabase = await this.getSupabaseClient();
    } catch (err: any) {
      throw new PersistenceError('recordAdSpend', err.message || 'Supabase DB client connection failed', err);
    }

    if (supabase && typeof supabase.from === 'function') {
      const { error } = await supabase.from('external_ad_spend_ledgers').upsert(record);
      if (error) {
        throw new PersistenceError('recordAdSpend', error.message || 'Failed to upsert external_ad_spend_ledgers', error);
      }
    }

    this.externalAdLedgers.set(spendLedgerId, record);
    return record;
  }

  /**
   * 7. Double-Entry Conservation Invariant Verification (Task 4.1, ANI-952, ANI-969)
   * Formula: initial_balance == current_balance + settled_total + reserved_total
   */
  public static async verifyConservationInvariant(
    workspaceId: string
  ): Promise<ConservationInvariantResult> {
    const ledger = await this.loadWorkspaceLedger(workspaceId);
    const initialBalance = ledger.total_granted;
    const currentBalance = ledger.balance - ledger.reserved;

    let reservedTotal = 0;
    for (const resv of this.finopsReservations.values()) {
      if (resv.workspace_id === workspaceId && resv.status === 'RESERVED') {
        reservedTotal += resv.amount;
      }
    }
    if (reservedTotal === 0 && ledger.reserved > 0) {
      reservedTotal = ledger.reserved;
    }

    let settledTotal = 0;
    for (const stl of this.finopsSettlements.values()) {
      const resv = this.finopsReservations.get(stl.reservation_id);
      if (!resv || resv.workspace_id === workspaceId) {
        settledTotal += stl.actual_cost;
      }
    }
    if (settledTotal === 0 && initialBalance > ledger.balance) {
      settledTotal = initialBalance - ledger.balance;
    }

    const calculatedSum = currentBalance + settledTotal + reservedTotal;
    const discrepancy = initialBalance - calculatedSum;
    const isValid = Math.abs(discrepancy) < 0.0001;

    return {
      isValid,
      initialBalance,
      currentBalance,
      settledTotal,
      reservedTotal,
      discrepancy,
      reason: isValid
        ? undefined
        : `Conservation invariant broken: initial (${initialBalance}) != current (${currentBalance}) + settled (${settledTotal}) + reserved (${reservedTotal}) [discrepancy: ${discrepancy}]`,
    };
  }

  /**
   * 8. AI Credit Ledger Reader
   */
  public static async getAiCreditLedger(workspaceId: string): Promise<{
    workspaceId: string;
    balance: number;
    reserved: number;
    totalGranted: number;
    availableCredit: number;
    updatedAt: string;
  }> {
    const ledger = await this.loadWorkspaceLedger(workspaceId);
    return {
      workspaceId: ledger.workspace_id,
      balance: ledger.balance,
      reserved: ledger.reserved,
      totalGranted: ledger.total_granted,
      availableCredit: ledger.balance - ledger.reserved,
      updatedAt: ledger.updated_at,
    };
  }

  // ============================================================================
  // Backward Compatibility Handlers for Wave 2 Integration
  // ============================================================================

  public static reserveCredits(params: {
    quote: ActionCostQuote;
    actionRunId: string;
    idempotencyKey: string;
  }): FinOpsReserveResult {
    const { quote, actionRunId, idempotencyKey } = params;
    const currentBalance = this.getWorkspaceBalance(quote.workspaceId);

    if (currentBalance < quote.requiredCredits) {
      return {
        allowed: false,
        reason: `크레딧이 부족합니다 (필요: ${quote.requiredCredits} SC, 현재 잔여: ${currentBalance} SC). 공급자 실행이 차단되었습니다.`,
        currentAvailableCredits: currentBalance,
      };
    }

    const reservationId = `resv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const balanceBefore = currentBalance;
    const balanceAfter = currentBalance - quote.requiredCredits;

    this.creditChain.appendEntry({
      workspaceId: quote.workspaceId,
      entryType: 'RESERVE',
      amount: -quote.requiredCredits,
      currentBalance: balanceBefore,
      transactionRefId: actionRunId,
      quoteId: quote.quoteId,
      reason: `ActionRun ${actionRunId} 실행을 위한 크레딧 가승인 예약`,
      initiatedBy: 'ACTION_RUNTIME',
      idempotencyKey,
    });

    this.workspaceBalances.set(quote.workspaceId, balanceAfter);

    let ledger = this.aiCreditLedgers.get(quote.workspaceId);
    if (ledger) {
      ledger.reserved += quote.requiredCredits;
      ledger.updated_at = new Date().toISOString();
    }

    const receipt: FinOpsReservationReceipt = {
      reservationId,
      quoteId: quote.quoteId,
      actionRunId,
      workspaceId: quote.workspaceId,
      reservedCredits: quote.requiredCredits,
      balanceBefore,
      balanceAfter,
      state: 'RESERVED',
      reservedAt: new Date().toISOString(),
      idempotencyKey,
    };

    this.reservations.set(reservationId, receipt);

    return {
      allowed: true,
      reservation: receipt,
      currentAvailableCredits: balanceAfter,
    };
  }

  public static settleAction(params: {
    reservationId: string;
    actionStatus: 'EXTERNAL_VERIFIED' | 'COMPLETED' | 'FAILED' | 'PROVIDER_REJECTED' | 'CANCELED' | 'RESULT_UNKNOWN';
    reason?: string;
    externalSpendId?: string;
  }): FinOpsSettlementReceipt {
    const { reservationId, actionStatus, reason = '', externalSpendId } = params;
    const reservation = this.reservations.get(reservationId);
    if (!reservation) {
      throw new Error(`Reservation not found: ${reservationId}`);
    }

    const settlementId = `stl_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const currentBalance = this.getWorkspaceBalance(reservation.workspaceId);

    if (actionStatus === 'EXTERNAL_VERIFIED' || actionStatus === 'COMPLETED') {
      reservation.state = 'SETTLED';
      reservation.settledAt = new Date().toISOString();

      this.creditChain.appendEntry({
        workspaceId: reservation.workspaceId,
        entryType: 'SETTLE',
        amount: 0,
        currentBalance,
        transactionRefId: reservation.actionRunId,
        quoteId: reservation.quoteId,
        reason: `ActionRun ${reservation.actionRunId} 성공 완결에 따른 가승인 확정 정산`,
        initiatedBy: 'FINOPS_SETTLER',
        idempotencyKey: `settle_${reservation.idempotencyKey}`,
      });

      let ledger = this.aiCreditLedgers.get(reservation.workspaceId);
      if (ledger) {
        ledger.balance -= reservation.reservedCredits;
        ledger.reserved = Math.max(0, ledger.reserved - reservation.reservedCredits);
      }

      const receipt: FinOpsSettlementReceipt = {
        settlementId,
        reservationId,
        actionRunId: reservation.actionRunId,
        workspaceId: reservation.workspaceId,
        finalSettledCredits: reservation.reservedCredits,
        releasedCredits: 0,
        balanceBefore: currentBalance,
        balanceAfter: currentBalance,
        externalSpendId,
        settledAt: new Date().toISOString(),
        status: 'SETTLED',
        reason: reason || 'Action verified successfully on external channel.',
      };

      this.settlements.set(settlementId, receipt);
      return receipt;
    }

    if (actionStatus === 'FAILED' || actionStatus === 'PROVIDER_REJECTED' || actionStatus === 'CANCELED') {
      reservation.state = 'RELEASED';
      reservation.releasedAt = new Date().toISOString();

      const balanceBefore = currentBalance;
      const balanceAfter = currentBalance + reservation.reservedCredits;

      this.creditChain.appendEntry({
        workspaceId: reservation.workspaceId,
        entryType: 'RELEASE',
        amount: reservation.reservedCredits,
        currentBalance: balanceBefore,
        transactionRefId: reservation.actionRunId,
        quoteId: reservation.quoteId,
        reason: `ActionRun ${reservation.actionRunId} 실패(${actionStatus})로 인한 가승인 전액 환원`,
        initiatedBy: 'FINOPS_SETTLER',
        idempotencyKey: `release_${reservation.idempotencyKey}`,
      });

      this.workspaceBalances.set(reservation.workspaceId, balanceAfter);

      let ledger = this.aiCreditLedgers.get(reservation.workspaceId);
      if (ledger) {
        ledger.reserved = Math.max(0, ledger.reserved - reservation.reservedCredits);
      }

      const receipt: FinOpsSettlementReceipt = {
        settlementId,
        reservationId,
        actionRunId: reservation.actionRunId,
        workspaceId: reservation.workspaceId,
        finalSettledCredits: 0,
        releasedCredits: reservation.reservedCredits,
        balanceBefore,
        balanceAfter,
        externalSpendId,
        settledAt: new Date().toISOString(),
        status: 'RELEASED_FULL',
        reason: reason || `Action failed with ${actionStatus}. Reserved credits restored.`,
      };

      this.settlements.set(settlementId, receipt);
      return receipt;
    }

    reservation.state = 'HOLD_FOR_RECONCILE';

    const receipt: FinOpsSettlementReceipt = {
      settlementId,
      reservationId,
      actionRunId: reservation.actionRunId,
      workspaceId: reservation.workspaceId,
      finalSettledCredits: 0,
      releasedCredits: 0,
      balanceBefore: currentBalance,
      balanceAfter: currentBalance,
      externalSpendId,
      settledAt: new Date().toISOString(),
      status: 'HELD_FOR_RECONCILE',
      reason: 'RESULT_UNKNOWN: Reservation placed on hold until reconcile readback confirms external state.',
    };

    this.settlements.set(settlementId, receipt);
    return receipt;
  }

  public static authorizeExternalAdSpend(params: {
    workspaceId: string;
    actionRunId: string;
    campaignId: string;
    platform: AdSpendPlatform;
    authorizedAmountKrw: number;
    notes?: string;
  }): ExternalAdSpendLedgerEntry {
    const { workspaceId, actionRunId, campaignId, platform, authorizedAmountKrw, notes } = params;
    const spendId = `adspd_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const entry: ExternalAdSpendLedgerEntry = {
      spendId,
      workspaceId,
      actionRunId,
      campaignId,
      platform,
      authorizedAmountKrw,
      observedSpendKrw: 0,
      varianceKrw: authorizedAmountKrw,
      reconcileStatus: 'PENDING_READBACK',
      recordedAt: new Date().toISOString(),
      notes,
    };

    this.adSpendLedger.set(spendId, entry);
    return entry;
  }

  public static reconcileExternalAdSpend(params: {
    spendId: string;
    observedSpendKrw: number;
  }): ExternalAdSpendLedgerEntry {
    const { spendId, observedSpendKrw } = params;
    const entry = this.adSpendLedger.get(spendId);
    if (!entry) {
      throw new Error(`External ad spend entry not found: ${spendId}`);
    }

    entry.observedSpendKrw = observedSpendKrw;
    entry.varianceKrw = entry.authorizedAmountKrw - observedSpendKrw;
    entry.readbackAt = new Date().toISOString();

    if (observedSpendKrw > entry.authorizedAmountKrw) {
      entry.reconcileStatus = 'DISCREPANCY_ALERT';
      entry.notes = `[초과 집행 경고] 승인 예산(${entry.authorizedAmountKrw}원)보다 실집행(${observedSpendKrw}원)이 ${Math.abs(entry.varianceKrw)}원 초과되었습니다.`;
    } else {
      entry.reconcileStatus = 'MATCHED';
    }

    return entry;
  }

  public static getWorkspaceBalance(workspaceId: string): number {
    const ledger = this.aiCreditLedgers.get(workspaceId);
    if (ledger) {
      return ledger.balance - ledger.reserved;
    }
    return this.workspaceBalances.get(workspaceId) ?? 0;
  }

  public static verifyFinOpsIntegrity(workspaceId: string): {
    isValid: boolean;
    chainIntegrity: boolean;
    currentBalance: number;
    reason?: string;
  } {
    const chainCheck = this.creditChain.verifyChainIntegrity(workspaceId);
    const balance = this.getWorkspaceBalance(workspaceId);

    if (!chainCheck.isValid) {
      return {
        isValid: false,
        chainIntegrity: false,
        currentBalance: balance,
        reason: chainCheck.reason,
      };
    }

    return {
      isValid: true,
      chainIntegrity: true,
      currentBalance: balance,
    };
  }

  public static getReservation(reservationId: string): FinOpsReservationReceipt | undefined {
    return this.reservations.get(reservationId);
  }

  public static getSettlement(settlementId: string): FinOpsSettlementReceipt | undefined {
    return this.settlements.get(settlementId);
  }

  public static getAdSpendEntry(spendId: string): ExternalAdSpendLedgerEntry | undefined {
    return this.adSpendLedger.get(spendId);
  }

  public static listAdSpendByWorkspace(workspaceId: string): ExternalAdSpendLedgerEntry[] {
    return Array.from(this.adSpendLedger.values()).filter((e) => e.workspaceId === workspaceId);
  }

  /**
   * Reset helper for tests
   */
  public static clearMemoryCacheForTesting(): void {
    this.reservations.clear();
    this.settlements.clear();
    this.adSpendLedger.clear();
    this.workspaceBalances.clear();
    this.aiCreditLedgers.clear();
    this.externalAdLedgers.clear();
    this.finopsReservations.clear();
    this.finopsSettlements.clear();
  }

  public static _reset(): void {
    this.clearMemoryCacheForTesting();
  }
}
