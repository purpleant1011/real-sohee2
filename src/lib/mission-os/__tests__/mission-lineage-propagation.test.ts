import { describe, it, expect } from 'vitest'
import {
  assertPublishMissionGateAllowed,
  assertControlGateActionAllowed,
  assertStrictLineage,
  validateApprovalForExecution,
  type MissionLineageEnvelope,
  type MissionApprovalContext,
} from '../mission-lineage-guard'

describe('authoritative publishing control gate', () => {
  const gate = (status: string, metadata: any = {}, workerObservedEpoch?: number) => {
    const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { status, metadata }, error: null }) }
    return assertPublishMissionGateAllowed({ supabase: { from: () => query }, workspaceId: 'workspace', missionId: 'mission', workerObservedEpoch })
  }
  it.each([null, '0', -1, 0.5, NaN, Infinity, undefined])('fails closed for present invalid epoch %s', async (control_epoch) => {
    await expect(gate('EXECUTING', { control_epoch })).rejects.toThrow('CONTROL_GATE_INVALID_EPOCH')
  })
  it.each(['PAUSED', 'CANCELLED', 'FAILED', 'BLOCKED', 'RESULT_UNKNOWN', 'UNKNOWN'])('does not cast legacy %s to an approved execution state', async (status) => {
    await expect(gate(status, { contract: null })).rejects.toThrow(/CONTROL_GATE/)
  })
  it.each(['APPROVED', 'EXECUTING'])('preserves no-contract legacy %s publishing', async (status) => {
    await expect(gate(status)).resolves.toBeUndefined()
  })
  it('requires valid dual-state contract instead of silently degrading to legacy', async () => {
    await expect(gate('EXECUTING', { execution_state: 'RUNNING', contract: null })).rejects.toThrow('CONTROL_GATE_INVALID_CONTRACT')
  })
  it('requires the worker to observe an authoritative epoch', async () => {
    await expect(gate('EXECUTING', { control_epoch: 2 })).rejects.toThrow('CONTROL_GATE_STALE_EPOCH')
    await expect(gate('EXECUTING', { control_epoch: 2 }, 2)).resolves.toBeUndefined()
  })
  it.each(['READBACK', 'RECONCILIATION'] as const)('preserves %s despite invalid epoch, stopped state and missing contract', (actionType) => {
    expect(() => assertControlGateActionAllowed({ actionType, executionState: 'STOPPED', contract: null, controlEpoch: NaN })).not.toThrow()
  })
})

describe('Mission Lineage Propagation & Exact Approval Guard (ANI-1211)', () => {
  const canonicalWorkspaceId = '00000000-0000-4000-8000-0000000000a2'
  const canonicalMissionId = 'm1000000-0000-4000-8000-000000000001'
  const canonicalTraceId = 'tr-byreum-golden-mission-001'

  it('1. MUST enforce identical workspace_id, mission_id, and trace_id across all downstream objects', () => {
    const validEnvelope: MissionLineageEnvelope = {
      workspaceId: canonicalWorkspaceId,
      missionId: canonicalMissionId,
      traceId: canonicalTraceId,
    }

    // Matching downstream object
    const validDownstream = {
      workspaceId: canonicalWorkspaceId,
      missionId: canonicalMissionId,
      traceId: canonicalTraceId,
      entityId: 'content-item-001',
    }

    expect(() => assertStrictLineage(validEnvelope, validDownstream)).not.toThrow()

    // Mismatched workspaceId -> FAIL CLOSED
    const foreignWorkspaceDownstream = {
      ...validDownstream,
      workspaceId: 'b1000000-0000-4000-8000-000000000001',
    }
    expect(() => assertStrictLineage(validEnvelope, foreignWorkspaceDownstream)).toThrow(
      /LINEAGE_WORKSPACE_MISMATCH/
    )

    // Mismatched missionId -> FAIL CLOSED
    const foreignMissionDownstream = {
      ...validDownstream,
      missionId: 'm-other-999',
    }
    expect(() => assertStrictLineage(validEnvelope, foreignMissionDownstream)).toThrow(
      /LINEAGE_MISSION_MISMATCH/
    )

    // Mismatched traceId -> FAIL CLOSED
    const foreignTraceDownstream = {
      ...validDownstream,
      traceId: 'tr-other-999',
    }
    expect(() => assertStrictLineage(validEnvelope, foreignTraceDownstream)).toThrow(
      /LINEAGE_TRACE_MISMATCH/
    )
  })

  it('2. MUST permit execution only when approved version and current version fingerprint match exactly', () => {
    const approvalContext: MissionApprovalContext = {
      versionId: 'v-101',
      versionNumber: 1,
      fingerprint: 'fp-sha256-abc12345',
      isApproved: true,
      approvalId: 'appr-001',
    }

    // Current content matches approved version exactly
    const exactCurrentContent = {
      versionId: 'v-101',
      fingerprint: 'fp-sha256-abc12345',
    }

    expect(() => validateApprovalForExecution(approvalContext, exactCurrentContent)).not.toThrow()

    // New version produced after approval -> Stale approval rejected
    const modifiedContentNewVersion = {
      versionId: 'v-102', // Bumped version!
      fingerprint: 'fp-sha256-def67890',
    }
    expect(() => validateApprovalForExecution(approvalContext, modifiedContentNewVersion)).toThrow(
      /APPROVAL_VERSION_STALE/
    )

    // Tampered content with same versionId but different fingerprint -> Rejected
    const tamperedContent = {
      versionId: 'v-101',
      fingerprint: 'fp-tampered-content',
    }
    expect(() => validateApprovalForExecution(approvalContext, tamperedContent)).toThrow(
      /APPROVAL_FINGERPRINT_TAMPERED/
    )
  })

  it('3. MUST block execution if approval is absent or false', () => {
    const unapprovedContext: MissionApprovalContext = {
      versionId: 'v-101',
      versionNumber: 1,
      fingerprint: 'fp-sha256-abc12345',
      isApproved: false,
      approvalId: null,
    }

    const currentContent = {
      versionId: 'v-101',
      fingerprint: 'fp-sha256-abc12345',
    }

    expect(() => validateApprovalForExecution(unapprovedContext, currentContent)).toThrow(
      /MISSION_NOT_APPROVED/
    )
  })
})
