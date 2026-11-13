import React from 'react';
import type { LedgerFreshness } from '../availability';
import { toLedgerFreshnessView } from '../ledger-freshness-view';

interface LedgerFreshnessNoticeProps {
  freshness: LedgerFreshness;
  observedAt?: string | null;
  sourceLabel?: string | null;
  timezone?: string;
}

/**
 * ANI-1610 — single owner-facing statement of how fresh the booking ledger is.
 * A ledger that is stale, unobserved, or unreadable always reads 확인 필요;
 * this component never renders an availability claim for those states.
 */
export function LedgerFreshnessNotice({
  freshness,
  observedAt = null,
  sourceLabel = null,
  timezone = 'Asia/Seoul',
}: LedgerFreshnessNoticeProps) {
  const view = toLedgerFreshnessView({ freshness, observedAt, sourceLabel, timezone });
  const isCurrent = view.tone === 'current';

  return (
    <div
      role="status"
      aria-live="polite"
      data-ledger-freshness-tone={view.tone}
      className={
        isCurrent
          ? 'rounded-xl border border-[var(--state-ok-line)] bg-state-ok-soft p-3 text-sm text-state-ok'
          : 'rounded-xl border border-[var(--state-warn-line)] bg-state-warn-soft p-3 text-sm text-state-warn'
      }
    >
      <p className="font-semibold">{view.headline}</p>
      <p className="mt-1 text-xs leading-relaxed">{view.detail}</p>
      {view.requiresOwnerConfirmation ? (
        <p className="mt-1 text-xs text-state-warn">
          사장님이 실제 장부를 확인하기 전에는 고객에게 시간을 확정해 안내하지 않아요.
        </p>
      ) : null}
    </div>
  );
}
