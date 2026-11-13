import { describe, expect, it } from 'vitest'
import {
  LEDGER_FRESHNESS_TTL_MS,
  resolveLedgerFreshness,
  toLedgerFreshnessView,
} from '../ledger-freshness-view'

const NOW = '2026-10-23T01:00:00.000Z'

describe('ANI-1610 ledger freshness view', () => {
  describe('resolveLedgerFreshness', () => {
    it('reports an unobserved ledger when no external ledger is connected', () => {
      const envelope = resolveLedgerFreshness({
        hasExternalLedgerConnection: false,
        lastConfirmedAt: null,
        now: NOW,
      })
      expect(envelope.freshness).toBe('NOT_OBSERVED')
      expect(envelope.observedAt).toBeNull()
      expect(envelope.requiresOwnerConfirmation).toBe(true)
    })

    it('treats a confirmation older than the TTL as stale', () => {
      // 3 days old confirmation — the ANI-1610 acceptance case.
      const envelope = resolveLedgerFreshness({
        hasExternalLedgerConnection: true,
        lastConfirmedAt: '2026-10-20T01:00:00.000Z',
        now: NOW,
      })
      expect(envelope.freshness).toBe('STALE')
      expect(envelope.observedAt).toBe('2026-10-20T01:00:00.000Z')
      expect(envelope.requiresOwnerConfirmation).toBe(true)
    })

    it('treats a confirmation inside the TTL as current', () => {
      const envelope = resolveLedgerFreshness({
        hasExternalLedgerConnection: true,
        lastConfirmedAt: new Date(Date.parse(NOW) - 60 * 1000).toISOString(),
        now: NOW,
      })
      expect(envelope.freshness).toBe('CURRENT')
      expect(envelope.requiresOwnerConfirmation).toBe(false)
    })

    it('reports an unreadable ledger as an error instead of pretending it is current', () => {
      const envelope = resolveLedgerFreshness({
        hasExternalLedgerConnection: true,
        lastConfirmedAt: 'not-a-date',
        now: NOW,
      })
      expect(envelope.freshness).toBe('ERROR')
      expect(envelope.requiresOwnerConfirmation).toBe(true)
    })

    it('treats a future confirmation time as stale rather than current', () => {
      const envelope = resolveLedgerFreshness({
        hasExternalLedgerConnection: true,
        lastConfirmedAt: '2026-10-24T01:00:00.000Z',
        now: NOW,
      })
      expect(envelope.freshness).toBe('STALE')
    })
  })

  describe('toLedgerFreshnessView', () => {
    it('shows the confirmation time and source for a current ledger', () => {
      const view = toLedgerFreshnessView({
        freshness: 'CURRENT',
        observedAt: '2026-10-23T00:58:00.000Z',
        sourceLabel: '사장님 직접 확인',
      })
      expect(view.tone).toBe('current')
      expect(view.headline).not.toBe('확인 필요')
      expect(view.detail).toContain('2026')
      expect(view.detail).toContain('사장님 직접 확인')
      expect(view.requiresOwnerConfirmation).toBe(false)
    })

    it('labels a stale ledger as 확인 필요 and never as available', () => {
      const view = toLedgerFreshnessView({
        freshness: 'STALE',
        observedAt: '2026-10-20T01:00:00.000Z',
      })
      expect(view.tone).toBe('needs-check')
      expect(view.headline).toBe('확인 필요')
      expect(view.detail).not.toContain('예약 가능')
      expect(view.headline).not.toContain('예약 가능')
      expect(view.requiresOwnerConfirmation).toBe(true)
    })

    it('labels an unobserved ledger as 확인 필요 and never as available', () => {
      const view = toLedgerFreshnessView({ freshness: 'NOT_OBSERVED' })
      expect(view.headline).toBe('확인 필요')
      expect(`${view.headline} ${view.detail}`).not.toContain('예약 가능')
      expect(view.requiresOwnerConfirmation).toBe(true)
    })

    it('labels a failed ledger read as 확인 필요 and never as available', () => {
      const view = toLedgerFreshnessView({ freshness: 'ERROR' })
      expect(view.headline).toBe('확인 필요')
      expect(`${view.headline} ${view.detail}`).not.toContain('예약 가능')
      expect(view.requiresOwnerConfirmation).toBe(true)
    })

    it('keeps the 15 minute TTL contract from ANI-1610', () => {
      expect(LEDGER_FRESHNESS_TTL_MS).toBe(15 * 60 * 1000)
    })
  })
})
