/**
 * Supabase 기반 알림톡 발송 원장 어댑터 (KAPI-ledger)
 *
 * 멱등키(idempotencyKey) 기준 중복 발송을 방지하고
 * canTransition 규칙에 따른 상태 전이(Compare-And-Swap 조건부 update)를 보장한다.
 * 개인정보 보호: 전화번호 원문은 저장하지 않으며 phoneLast4 만 영속화한다.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  type LedgerPort,
  type LedgerRecord,
  type LedgerStatus,
  canTransition,
} from './ledger-port'

interface DbLedgerRow {
  idempotency_key: string
  workspace_id: string
  booking_id: string
  event: string
  template_code: string
  phone_last4: string
  status: LedgerStatus
  provider_message_id: string | null
  error: string | null
  created_at: string
  updated_at: string
}

const ALL_STATUSES: readonly LedgerStatus[] = [
  'PENDING',
  'DRY_RUN',
  'REJECTED',
  'SENT',
  'FAILED',
  'DELIVERED',
]

function toLedgerRecord(row: DbLedgerRow): LedgerRecord {
  return {
    idempotencyKey: row.idempotency_key,
    workspaceId: row.workspace_id,
    bookingId: row.booking_id,
    event: row.event,
    templateCode: row.template_code,
    phoneLast4: row.phone_last4,
    status: row.status,
    ...(row.provider_message_id ? { providerMessageId: row.provider_message_id } : {}),
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class SupabaseAlimtalkLedger implements LedgerPort {
  constructor(private readonly client: SupabaseClient | any) {}

  /**
   * 멱등키가 없으면 PENDING 으로 레코드를 생성하고 true 반환.
   * 이미 존재하는 경우 삽입을 무시하고 false 반환 (중복 발송 방지).
   */
  async claim(
    record: Pick<
      LedgerRecord,
      'idempotencyKey' | 'workspaceId' | 'bookingId' | 'event' | 'templateCode' | 'phoneLast4'
    >,
    nowIso: string,
  ): Promise<boolean> {
    try {
      const { data, error } = await this.client
        .from('kakao_alimtalk_ledger')
        .upsert(
          {
            idempotency_key: record.idempotencyKey,
            workspace_id: record.workspaceId,
            booking_id: record.bookingId,
            event: record.event,
            template_code: record.templateCode,
            phone_last4: record.phoneLast4,
            status: 'PENDING',
            created_at: nowIso,
            updated_at: nowIso,
          },
          { onConflict: 'idempotency_key', ignoreDuplicates: true },
        )
        .select('idempotency_key')

      if (error) {
        if (
          error.code === '23505' ||
          error.message?.includes('duplicate key') ||
          error.message?.includes('conflict')
        ) {
          return false
        }
        throw error
      }

      return Array.isArray(data) && data.length > 0
    } catch (err: any) {
      if (
        err?.code === '23505' ||
        err?.message?.includes('duplicate key') ||
        err?.message?.includes('conflict')
      ) {
        return false
      }
      throw err
    }
  }

  /**
   * 상태 전이 (Compare-And-Swap).
   * canTransition(현재상태, next) 규칙을 만족하는 상태일 때만 조건부 update.
   * 역방향 전이이거나 일치하는 레코드가 없으면 false 반환.
   */
  async transition(
    idempotencyKey: string,
    next: LedgerStatus,
    patch: { providerMessageId?: string; error?: string },
    nowIso: string,
  ): Promise<boolean> {
    const allowedPriorStatuses = ALL_STATUSES.filter((status) => canTransition(status, next))
    if (allowedPriorStatuses.length === 0) {
      return false
    }

    const updatePayload: Record<string, any> = {
      status: next,
      updated_at: nowIso,
    }

    if (patch.providerMessageId !== undefined) {
      updatePayload.provider_message_id = patch.providerMessageId
    }
    if (patch.error !== undefined) {
      updatePayload.error = patch.error
    }

    const { data, error } = await this.client
      .from('kakao_alimtalk_ledger')
      .update(updatePayload)
      .eq('idempotency_key', idempotencyKey)
      .in('status', allowedPriorStatuses)
      .select('idempotency_key')

    if (error) {
      throw error
    }

    return Array.isArray(data) && data.length > 0
  }

  /**
   * 멱등키로 레코드 조회
   */
  async get(idempotencyKey: string): Promise<LedgerRecord | null> {
    const { data, error } = await this.client
      .from('kakao_alimtalk_ledger')
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle()

    if (error) {
      throw error
    }
    if (!data) {
      return null
    }

    return toLedgerRecord(data as DbLedgerRow)
  }

  /**
   * 솔라피 messageId로 레코드 조회 (웹훅 수신 시 사용)
   */
  async findByProviderMessageId(providerMessageId: string): Promise<LedgerRecord | null> {
    const { data, error } = await this.client
      .from('kakao_alimtalk_ledger')
      .select('*')
      .eq('provider_message_id', providerMessageId)
      .maybeSingle()

    if (error) {
      throw error
    }
    if (!data) {
      return null
    }

    return toLedgerRecord(data as DbLedgerRow)
  }
}
