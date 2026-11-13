/**
 * Booking Recovery Production Gating, Feature Flags, and Safe Error Formatting.
 *
 * Rules:
 * 1. Default OFF for all write operations.
 * 2. Strict workspace allowlist gating.
 * 3. Read operations (get/list) remain accessible under authentication even when kill switches are triggered,
 *    so owners can inspect evidence and reconcile outcomes.
 * 4. Raw DB / provider errors and credentials must never leak to user responses.
 */

import { isEngagementRolloutEnabled, isRecoveryRolloutEnabled } from '@/features/capabilities/registry';

export function isRecoveryEnabled(workspaceId: string): boolean {
  return isRecoveryRolloutEnabled(workspaceId, false);
}

export function isRecoveryWriteEnabled(workspaceId: string): boolean {
  return isRecoveryRolloutEnabled(workspaceId, true);
}

export function isEngagementSendEnabled(workspaceId: string): boolean {
  return isEngagementRolloutEnabled('ENGAGEMENT_SEND_ENABLED', workspaceId);
}

export interface SafeErrorDto {
  ok: false;
  code: string;
  message: string;
}

export function toSafeErrorResponse(error: unknown): SafeErrorDto {
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;
    const code = typeof err.code === 'string' ? err.code : 'UNKNOWN_ERROR';
    const message = typeof err.message === 'string' ? err.message : '';

    if (code === 'FORBIDDEN' || message.includes('권한') || message.includes('FORBIDDEN')) {
      return { ok: false, code: 'FORBIDDEN', message: '접근 권한이 없습니다.' };
    }
    if (code === 'NOT_FOUND' || message.includes('NOT_FOUND')) {
      return { ok: false, code: 'NOT_FOUND', message: '요청한 정보를 찾을 수 없습니다.' };
    }
    if (code === 'VERSION_CONFLICT' || message.includes('VERSION_CONFLICT')) {
      return {
        ok: false,
        code: 'VERSION_CONFLICT',
        message: '케이스 상태가 변경되었습니다. 최신 정보를 다시 확인해 주세요.',
      };
    }
    if (code === 'CONTEXT_REQUIRED' || message.includes('CONTEXT_REQUIRED')) {
      return {
        ok: false,
        code: 'CONTEXT_REQUIRED',
        message: '예약 슬롯 또는 카탈로그 정보 확인이 필요합니다.',
      };
    }
    if (code === 'SLOT_CONFLICT' || message.includes('SLOT_')) {
      return {
        ok: false,
        code: 'SLOT_CONFLICT',
        message: '선택하신 예약 시간이 이미 마감되었거나 유효하지 않습니다.',
      };
    }
  }

  return {
    ok: false,
    code: 'INTERNAL_ERROR',
    message: '처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
  };
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { BookingRecoveryRepository } from './repository';
import { BookingRecoveryService } from './service';
import { loadChannelCredential } from '@/features/channels/credential-repository';
import { sendInstagramDirectMessage, getInstagramDirectMessageReadback, type MetaFetch } from '@/lib/providers/meta-api';
import type { ApproveAndSendReplyDependencies } from './dm-adapter';

/**
 * Creates a fully wired production BookingRecoveryService instance.
 * Connects authoritative persistence, channel credentials, and Meta provider send.
 * Operating gates default to fail-closed OFF.
 */
export function createProductionBookingRecoveryService(
  client: SupabaseClient<any>,
  deps?: Partial<ApproveAndSendReplyDependencies>
): BookingRecoveryService {
  const repository = new BookingRecoveryRepository(client);

  return new BookingRecoveryService(repository, client, {
    getChannelCredential: deps?.getChannelCredential || ((workspaceId, channelConnectionId, channel) =>
      loadChannelCredential(workspaceId, channelConnectionId, channel)),
    sendProviderDm: deps?.sendProviderDm || ((payload) => sendInstagramDirectMessage(payload)),
    readbackFetcher: deps?.readbackFetcher || ((payload) => getInstagramDirectMessageReadback(payload)),
    loadCurrentFingerprint: deps?.loadCurrentFingerprint,
    loadCurrentDraft: deps?.loadCurrentDraft,
    fetcher: deps?.fetcher,
    ...deps,
  });
}
