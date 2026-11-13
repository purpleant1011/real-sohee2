import { describe, it, expect } from 'vitest'
import {
  createExternalActionReceipt,
  transitionReceiptState,
  mapOutcomeToReceiptState,
  ReceiptStateTransitionError,
} from '@/features/publishing/external-action-receipt-engine'

describe('ExternalActionReceipt & State Machine (ANI-1085)', () => {
  const baseReceiptInput = {
    workspaceId: 'ws-bakery',
    scheduleId: 'sched-1',
    creativeBundleId: 'bundle-1',
    creativeFingerprint: 'f'.repeat(64),
    channel: 'instagram' as const,
    orderedMediaSha256: ['m1'.repeat(32)],
    providerPayloadDigest: 'p1'.repeat(32),
    idempotencyKey: 'idem-key-1',
  }

  it('creates initial receipt with state REQUESTED and exact evidence metadata', () => {
    const receipt = createExternalActionReceipt(baseReceiptInput)

    expect(receipt.state).toBe('REQUESTED')
    expect(receipt.workspaceId).toBe('ws-bakery')
    expect(receipt.creativeBundleId).toBe('bundle-1')
    expect(receipt.orderedMediaSha256.length).toBe(1)
  })

  it('progresses legally through lifecycle: REQUESTED -> PROVIDER_ACCEPTED -> VERIFICATION_PENDING -> VERIFIED', () => {
    let receipt = createExternalActionReceipt(baseReceiptInput)

    receipt = transitionReceiptState(receipt, 'PROVIDER_ACCEPTED', {
      providerPostId: 'ig-12345',
      permalink: 'https://instagram.com/p/12345',
    })
    expect(receipt.state).toBe('PROVIDER_ACCEPTED')
    expect(receipt.providerPostId).toBe('ig-12345')

    receipt = transitionReceiptState(receipt, 'VERIFICATION_PENDING')
    expect(receipt.state).toBe('VERIFICATION_PENDING')

    receipt = transitionReceiptState(receipt, 'VERIFIED', {
      reasonCode: 'HIGH_CONFIDENCE_VISUAL_MATCH',
    })
    expect(receipt.state).toBe('VERIFIED')
    expect(receipt.reasonCode).toBe('HIGH_CONFIDENCE_VISUAL_MATCH')
  })

  it('strictly forbids setting VERIFIED without a provider post ID', () => {
    let receipt = createExternalActionReceipt(baseReceiptInput)

    expect(() => {
      receipt = transitionReceiptState(receipt, 'PROVIDER_ACCEPTED')
      receipt = transitionReceiptState(receipt, 'VERIFICATION_PENDING')
      transitionReceiptState(receipt, 'VERIFIED')
    }).toThrow('Cannot mark receipt as VERIFIED without provider post ID')
  })

  it('disallows illegal backwards transitions from terminal states', () => {
    let receipt = createExternalActionReceipt(baseReceiptInput)
    receipt = transitionReceiptState(receipt, 'PROVIDER_ACCEPTED', { providerPostId: 'ig-1' })
    receipt = transitionReceiptState(receipt, 'VERIFICATION_PENDING')
    receipt = transitionReceiptState(receipt, 'VERIFIED')

    expect(() => {
      transitionReceiptState(receipt, 'REQUESTED')
    }).toThrow(ReceiptStateTransitionError)
  })

  it('maps readback verification outcomes accurately to receipt states', () => {
    expect(mapOutcomeToReceiptState('VERIFIED')).toBe('VERIFIED')
    expect(mapOutcomeToReceiptState('VERIFICATION_PENDING')).toBe('VERIFICATION_PENDING')
    expect(mapOutcomeToReceiptState('RESULT_UNKNOWN')).toBe('RESULT_UNKNOWN')
    expect(mapOutcomeToReceiptState('MANUAL_REVIEW_REQUIRED')).toBe('VERIFICATION_PENDING')
    expect(mapOutcomeToReceiptState('VISUAL_MISMATCH')).toBe('FAILED')
  })
})
