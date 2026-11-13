import { describe, expect, it } from 'vitest'
import {
  connectorClaimBodySchema, executionScopeSelectionSchema, executionScopeRefSchema,
  deviceExecutionScopeSchema, checkpointRecoverySchema, executionCandidateSchema,
} from './execution-scope'

const actionId='91000000-0000-4000-8000-000000000001'
const scopeId='91000000-0000-4000-8000-000000000002'
const requestId='91000000-0000-4000-8000-000000000003'
const connectionId='91000000-0000-4000-8000-000000000004'

describe('exact-action execution scope contracts', () => {
  it('requires both UUIDs for a targeted claim and never strips malformed scope to FIFO', () => {
    expect(connectorClaimBodySchema.safeParse({ actionId, scopeId }).success).toBe(true)
    expect(connectorClaimBodySchema.safeParse({ actionId }).success).toBe(false)
    expect(connectorClaimBodySchema.safeParse({ scopeId }).success).toBe(false)
    expect(connectorClaimBodySchema.safeParse({ actionId, scopeId:'not-a-uuid' }).success).toBe(false)
    expect(connectorClaimBodySchema.safeParse({}).success).toBe(true)
  })

  it('rejects extra scope authority fields and missing expected approval fingerprints', () => {
    expect(executionScopeRefSchema.safeParse({ actionId,scopeId,workspaceId:actionId }).success).toBe(false)
    expect(executionScopeSelectionSchema.safeParse({ actionId,connectionId,requestId }).success).toBe(false)
    expect(executionScopeSelectionSchema.safeParse({ actionId,connectionId,requestId,fingerprint:'a'.repeat(64),role:'owner' }).success).toBe(false)
    expect(executionScopeSelectionSchema.safeParse({ actionId,requestId,connectionId,fingerprint:'a'.repeat(64) }).success).toBe(true)
  })

  it('distinguishes unscoped and recovery-blocked devices', () => {
    expect(deviceExecutionScopeSchema.parse(null)).toBeNull()
    expect(deviceExecutionScopeSchema.parse({ mode:'recovery_required' })).toEqual({ mode:'recovery_required' })
    expect(deviceExecutionScopeSchema.safeParse({ mode:'targeted',actionId,scopeId }).success).toBe(false)
    expect(deviceExecutionScopeSchema.safeParse({ mode:'targeted',actionId,scopeId,targetExternalId:'scope-blog' }).success).toBe(true)
  })

  it('only accepts bounded server checkpoint recovery states', () => {
    expect(checkpointRecoverySchema.parse({ state:'reconcile_required' })).toEqual({ state:'reconcile_required' })
    expect(checkpointRecoverySchema.safeParse({ state:'recovered_before_submit',permit:'never-return' }).success).toBe(false)
    expect(checkpointRecoverySchema.safeParse({ state:'retry_any_ready' }).success).toBe(false)
  })

  it('does not accept non-Naver result links as observed publish evidence', () => {
    const candidate={ actionId,status:'succeeded',targetExternalId:'scope-blog',resultUrl:'https://blog.naver.com/scope-blog/123456789' }
    expect(executionCandidateSchema.safeParse(candidate).success).toBe(true)
    expect(executionCandidateSchema.safeParse({ ...candidate,resultUrl:'https://evil.example/a' }).success).toBe(false)
    expect(executionCandidateSchema.safeParse({ ...candidate,resultUrl:'javascript:alert(1)' }).success).toBe(false)
    expect(executionCandidateSchema.safeParse({ ...candidate,status:'unknown_result',resultUrl:null }).success).toBe(true)
  })

  it('rejects editor/homepage URLs and results for a different target account', () => {
    const data={ actionId,status:'succeeded',targetExternalId:'scope-blog',resultUrl:'https://blog.naver.com/scope-blog/postwrite' }
    expect(executionCandidateSchema.safeParse(data).success).toBe(false)
    expect(executionCandidateSchema.safeParse({ ...data,resultUrl:'https://blog.naver.com/postwrite' }).success).toBe(false)
    expect(executionCandidateSchema.safeParse({ ...data,resultUrl:'https://blog.naver.com/other-blog/123456789' }).success).toBe(false)
    expect(executionCandidateSchema.safeParse({ ...data,resultUrl:'https://blog.naver.com/PostView.naver?blogId=scope-blog&logNo=123456789' }).success).toBe(true)
  })

})
