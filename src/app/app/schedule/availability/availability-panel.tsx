'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AvailabilityForm } from '@/features/booking-recovery/components/availability-form';
import { LedgerFreshnessNotice } from '@/features/booking-recovery/components/ledger-freshness-notice';
import {
  OWNER_CONFIRMATION_SOURCE,
  resolveLedgerFreshness,
} from '@/features/booking-recovery/ledger-freshness-view';
import type {
  AvailabilitySlotInput,
  CatalogService,
  OwnerConfirmedSlot,
} from '@/features/booking-recovery/availability';

interface AvailabilityPanelProps {
  workspaceId: string;
  timezone?: string;
}

type PanelState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; services: CatalogService[]; slots: OwnerConfirmedSlot[] };

function latestConfirmation(slots: OwnerConfirmedSlot[]): string | null {
  let latestMs = Number.NEGATIVE_INFINITY;
  let latest: string | null = null;
  for (const slot of slots) {
    const ms = Date.parse(slot.confirmedAt);
    if (Number.isNaN(ms)) continue;
    if (ms > latestMs) {
      latestMs = ms;
      latest = slot.confirmedAt;
    }
  }
  return latest;
}

/**
 * ANI-1610 — mounts the owner-facing availability form behind the booking-recovery
 * capability gate (the gate itself is enforced by the parent server page).
 * Reads and writes go through the existing booking-recovery availability API only.
 */
export function AvailabilityPanel({ workspaceId, timezone = 'Asia/Seoul' }: AvailabilityPanelProps) {
  const [state, setState] = useState<PanelState>({ status: 'loading' });
  const endpoint = `/api/workspaces/${workspaceId}/booking-recovery/availability`;

  const load = useCallback(async () => {
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setState({ status: 'error', message: payload?.error || '가용 시간 정보를 불러오지 못했어요.' });
        return;
      }
      setState({
        status: 'ready',
        services: Array.isArray(payload?.services) ? payload.services : [],
        slots: Array.isArray(payload?.slots) ? payload.slots : [],
      });
    } catch {
      setState({ status: 'error', message: '가용 시간 정보를 불러오지 못했어요.' });
    }
  }, [endpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSubmit = useCallback(
    async (input: AvailabilitySlotInput) => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || '가용 시간 등록에 실패했습니다.');
      }
      await load();
    },
    [endpoint, load],
  );

  if (state.status === 'loading') {
    return <p className="text-sm text-neutral-600">예약 장부 상태를 확인하고 있어요.</p>;
  }

  if (state.status === 'error') {
    return (
      <div className="space-y-4">
        <LedgerFreshnessNotice freshness="ERROR" timezone={timezone} />
        <p className="text-sm text-neutral-700" role="alert">
          {state.message}
        </p>
      </div>
    );
  }

  // No external booking ledger is integrated yet, so the only observation we can honestly
  // report is the most recent owner confirmation. Never upgrade that to a live ledger read.
  const envelope = resolveLedgerFreshness({
    hasExternalLedgerConnection: false,
    lastConfirmedAt: latestConfirmation(state.slots),
  });

  return (
    <div className="space-y-4">
      <LedgerFreshnessNotice
        freshness={envelope.freshness}
        observedAt={envelope.observedAt}
        sourceLabel={envelope.freshness === 'CURRENT' ? OWNER_CONFIRMATION_SOURCE : null}
        timezone={timezone}
      />
      {state.services.length === 0 ? (
        <p className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
          등록된 서비스가 없어요. 설정 &gt; 서비스에서 예약할 서비스와 소요시간을 먼저 등록해 주세요.
        </p>
      ) : (
        <AvailabilityForm
          services={state.services}
          workspaceTimezone={timezone}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}
