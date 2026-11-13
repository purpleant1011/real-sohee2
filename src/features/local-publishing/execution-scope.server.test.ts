import { describe, expect, it, vi } from 'vitest'
import { authorizeExecutionScope, findExecutionCandidate, readDeviceExecutionScope, recoverDeviceCheckpoint } from './execution-scope.server'

const workspaceId='92000000-0000-4000-8000-000000000001'
const actor={ workspaceId,userId:'92000000-0000-4000-8000-000000000002' }
const actionId='92000000-0000-4000-8000-000000000003'
const connectionId='92000000-0000-4000-8000-000000000004'
const requestId='92000000-0000-4000-8000-000000000005'
const scopeId='92000000-0000-4000-8000-000000000006'
const leaseId='92000000-0000-4000-8000-000000000007'
const device={ workspaceId,deviceId:'92000000-0000-4000-8000-000000000008',tokenDigest:'a'.repeat(64),platform:'macos',clientVersion:'0.1.2',status:'active' } as const
const selection={ actionId,connectionId,requestId,fingerprint:'b'.repeat(64) }
const scope={ actionId,scopeId,deviceId:device.deviceId,targetExternalId:'scope-blog',expiresAt:'2026-10-16T12:00:00Z' }

describe('server execution scope boundary', () => {
  it('binds selection to authenticated workspace/actor and the exact expected connection/fingerprint', async () => {
    const rpc=vi.fn().mockResolvedValue({ data:scope,error:null })
    expect(await authorizeExecutionScope(actor,selection,{ rpc })).toEqual({ data:scope })
    expect(rpc).toHaveBeenCalledWith('authorize_local_publish_execution_scope',{
      p_workspace_id:workspaceId,p_actor_user_id:actor.userId,p_action_id:actionId,p_expected_fingerprint:selection.fingerprint,
      p_request_id:requestId,p_expected_connection_id:connectionId,
    })
  })

  it('rejects invalid authority fields before invoking the database', async () => {
    const rpc=vi.fn()
    const result=await authorizeExecutionScope(actor,{ ...selection,workspaceId:'client-authority' },{ rpc })
    expect(result).toMatchObject({ error:{ code:'SCOPE_SELECTION_INVALID' } })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('never accepts a different action returned for a selection', async () => {
    const rpc=vi.fn().mockResolvedValue({ data:{ ...scope,actionId:connectionId },error:null })
    expect(await authorizeExecutionScope(actor,selection,{ rpc })).toMatchObject({ error:{ code:'SCOPE_SELECTION_REJECTED' } })
  })

  it('distinguishes an empty candidate from a database error without leaking the database message', async () => {
    const query={ contentId:actionId,versionId:requestId,connectionId,fingerprint:selection.fingerprint }
    const rpc=vi.fn().mockResolvedValueOnce({ data:null,error:null }).mockResolvedValueOnce({ data:null,error:{ message:'credential must not be returned' } })
    expect(await findExecutionCandidate(actor,query,{ rpc })).toEqual({ data:null })
    expect(await findExecutionCandidate(actor,query,{ rpc })).toEqual({ error:{ code:'SCOPE_QUERY_FAILED' } })
  })

  it('keeps recovery_required distinct from a device without a scope', async () => {
    const rpc=vi.fn().mockResolvedValue({ data:{ mode:'recovery_required' },error:null })
    expect(await readDeviceExecutionScope(device,{ rpc })).toEqual({ data:{ mode:'recovery_required' } })
    expect(rpc).toHaveBeenCalledWith('get_local_publish_execution_scope',{
      p_workspace_id:workspaceId,p_device_id:device.deviceId,p_token_digest:device.tokenDigest,
    })
  })

  it('binds recovery to the authenticated device and preserves the may-have-submitted boundary', async () => {
    const rpc=vi.fn().mockResolvedValue({ data:{ state:'reconcile_required' },error:null })
    expect(await recoverDeviceCheckpoint(device,actionId,{ leaseId,mayHaveSubmitted:true },{ rpc })).toEqual({ data:{ state:'reconcile_required' } })
    expect(rpc).toHaveBeenCalledWith('recover_scoped_local_publish_checkpoint',{
      p_workspace_id:workspaceId,p_device_id:device.deviceId,p_token_digest:device.tokenDigest,
      p_action_id:actionId,p_lease_id:leaseId,p_may_have_submitted:true,
    })
  })
})
