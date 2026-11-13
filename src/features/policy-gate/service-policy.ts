import { createHash } from 'node:crypto'
import { z } from 'zod'
import { resolveContactConsent } from '@/features/crm/contact-evidence'

const ref = z.string().trim().min(1).max(200)
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const timestamp = z.string().datetime({ offset: true })
const channel = z.enum(['INSTAGRAM', 'THREADS', 'KAKAO', 'SMS', 'EMAIL'])
const refs = z.array(ref).max(1000).refine(values => new Set(values).size === values.length)
const policySchema = z.object({
  workspaceId: ref, serviceId: ref, version: ref, minPriceKrw: count,
  maxDiscountBps: z.number().int().min(0).max(10000), maxDiscountCases: count,
  allowedChannels: z.array(channel).max(16).refine(values => new Set(values).size === values.length),
  perActionBudgetKrw: count, periodBudgetKrw: count, validFrom: timestamp, validUntil: timestamp,
  confirmedBy: ref, evidenceRef: ref,
}).strict().refine(policy => Date.parse(policy.validFrom) < Date.parse(policy.validUntil))
const proposalSchema = z.object({
  workspaceId: ref, serviceId: ref, policyVersion: ref, catalogVersion: ref,
  channel, purpose: z.enum(['PUBLIC_PROMOTION', 'MARKETING']), servicePriceKrw: count, offerPriceKrw: count,
  discountCaseCount: count, quotedCostKrw: count, costQuoteRef: ref,
  costQuoteObservedAt: timestamp, costQuoteValidUntil: timestamp,
  contentRevision: ref, content: z.string().min(1).max(20000), recipientRefs: refs, mediaRefs: refs, expiresAt: timestamp,
}).strict()
const factsSchema = z.object({
  workspaceId: ref, serviceId: ref, version: ref, status: z.literal('VERIFIED'), priceKrw: count,
  observedAt: timestamp, validUntil: timestamp, evidenceRef: ref,
}).strict()
const usageSchema = z.object({
  workspaceId: ref, serviceId: ref, policyVersion: ref, status: z.literal('CURRENT'),
  windowStart: timestamp, windowEnd: timestamp, observedAt: timestamp, validUntil: timestamp,
  discountCasesUsed: count, discountCasesReserved: count, budgetSpentKrw: count, budgetReservedKrw: count, evidenceRef: ref,
}).strict()
const approvalSchema = z.object({
  workspaceId: ref, policyFingerprint: z.string().regex(/^[a-f0-9]{64}$/), proposalFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  approvedBy: ref, approvedAt: timestamp, validUntil: timestamp,
}).strict()
const inputSchema = z.object({
  policy: policySchema, proposal: proposalSchema, facts: factsSchema, usage: usageSchema,
  consents: z.discriminatedUnion('status', [z.object({ status: z.literal('ERROR') }), z.object({ status: z.literal('OK'), events: z.array(z.unknown()) })]),
  approval: approvalSchema.optional(),
}).strict()

export type ServicePolicySnapshot = Readonly<Omit<z.infer<typeof policySchema>, 'allowedChannels'> & {
  allowedChannels: readonly z.infer<typeof channel>[]
}>
export type PolicyGateResult = Readonly<{
  status: 'BLOCKED' | 'OWNER_REVIEW_REQUIRED' | 'REAPPROVAL_REQUIRED' | 'PREPARED'
  reason: string; eligible: boolean; executionAllowed: false; requiresAtomicReservation: boolean
  policyFingerprint: string | null; proposalFingerprint: string | null
}>

export function createServicePolicySnapshot(input: unknown): ServicePolicySnapshot {
  const parsed = policySchema.parse(input)
  return Object.freeze({ ...parsed, allowedChannels: Object.freeze([...parsed.allowedChannels]) })
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** Pure preflight only. PREPARED is never authorization to spend or send. */
export function evaluatePolicyGate(input: unknown, now: string): PolicyGateResult {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success || !timestamp.safeParse(now).success) {
    return { status: 'BLOCKED', reason: 'INVALID_INPUT', eligible: false, executionAllowed: false, requiresAtomicReservation: false, policyFingerprint: null, proposalFingerprint: null }
  }
  const { policy, proposal, facts, usage, consents, approval } = parsed.data
  const policyFingerprint = fingerprint(policy)
  const proposalFingerprint = fingerprint(proposal)
  const result = (status: PolicyGateResult['status'], reason: string): PolicyGateResult => Object.freeze({
    status, reason, eligible: status !== 'BLOCKED', executionAllowed: false,
    requiresAtomicReservation: status !== 'BLOCKED', policyFingerprint, proposalFingerprint,
  })
  const block = (reason: string) => result('BLOCKED', reason)
  const clock = Date.parse(now)
  const fresh = (observedAt: string, validUntil: string) => Date.parse(observedAt) <= clock && clock < Date.parse(validUntil)
  if (proposal.workspaceId !== policy.workspaceId || proposal.serviceId !== policy.serviceId || proposal.policyVersion !== policy.version ||
      facts.workspaceId !== policy.workspaceId || facts.serviceId !== policy.serviceId ||
      usage.workspaceId !== policy.workspaceId || usage.serviceId !== policy.serviceId || usage.policyVersion !== policy.version) {
    return block('SCOPE_OR_VERSION_MISMATCH')
  }
  if (!fresh(policy.validFrom, policy.validUntil) || !fresh(facts.observedAt, facts.validUntil) ||
      !fresh(usage.observedAt, usage.validUntil) || !fresh(proposal.costQuoteObservedAt, proposal.costQuoteValidUntil) || clock >= Date.parse(proposal.expiresAt) ||
      Date.parse(usage.windowStart) !== Date.parse(policy.validFrom) || Date.parse(usage.windowEnd) !== Date.parse(policy.validUntil)) {
    return block('STALE_EVIDENCE')
  }
  if (facts.version !== proposal.catalogVersion || facts.priceKrw !== proposal.servicePriceKrw || proposal.offerPriceKrw > facts.priceKrw) return block('PRICE_FACT_MISMATCH')
  if (proposal.offerPriceKrw < policy.minPriceKrw) return block('MIN_PRICE')
  const discount = BigInt(proposal.servicePriceKrw) - BigInt(proposal.offerPriceKrw)
  if (discount * BigInt(10000) > BigInt(proposal.servicePriceKrw) * BigInt(policy.maxDiscountBps)) return block('DISCOUNT_LIMIT')
  if ((discount > BigInt(0) && proposal.discountCaseCount === 0) || (discount === BigInt(0) && proposal.discountCaseCount !== 0)) return block('INVALID_DISCOUNT_CASES')
  if (BigInt(usage.discountCasesUsed) + BigInt(usage.discountCasesReserved) + BigInt(proposal.discountCaseCount) > BigInt(policy.maxDiscountCases)) return block('DISCOUNT_CASE_LIMIT')
  if (!policy.allowedChannels.includes(proposal.channel)) return block('CHANNEL_NOT_ALLOWED')
  if (proposal.quotedCostKrw > policy.perActionBudgetKrw) return block('ACTION_BUDGET')
  if (BigInt(usage.budgetSpentKrw) + BigInt(usage.budgetReservedKrw) + BigInt(proposal.quotedCostKrw) > BigInt(policy.periodBudgetKrw)) return block('PERIOD_BUDGET')
  if (proposal.purpose === 'PUBLIC_PROMOTION') {
    if (proposal.recipientRefs.length !== 0 || !['INSTAGRAM', 'THREADS'].includes(proposal.channel)) return block('PURPOSE_MISMATCH')
  } else {
    if (proposal.recipientRefs.length === 0) return block('NO_TARGETS')
    for (const customerId of proposal.recipientRefs) {
      if (resolveContactConsent(consents, { workspaceId: policy.workspaceId, customerId, channel: proposal.channel, purpose: 'MARKETING' }, now) !== 'GRANTED') return block('CONSENT_REQUIRED')
    }
  }
  if (!approval) return result('OWNER_REVIEW_REQUIRED', 'OWNER_APPROVAL_REQUIRED')
  if (approval.workspaceId !== policy.workspaceId || approval.policyFingerprint !== policyFingerprint || approval.proposalFingerprint !== proposalFingerprint ||
      !fresh(approval.approvedAt, approval.validUntil)) return result('REAPPROVAL_REQUIRED', 'APPROVAL_CHANGED_OR_EXPIRED')
  return result('PREPARED', 'ATOMIC_RESERVATION_REQUIRED')
}
