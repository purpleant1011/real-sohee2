import { describe, expect, it, vi } from 'vitest'
import {
  reconcileNaverPostJobs,
  type NaverPostJobRow,
  type QuickPostReservationRow,
  type ReconcileNaverPostJobsDependencies,
} from './reconcile-naver-post-jobs'
import { deterministicUuid } from './generate-naver-post'

describe('reconcileNaverPostJobs', () => {
  const wsId = '22000000-0000-4000-8000-000000000001'
  const reqKey1 = '32000000-0000-4000-8000-000000000001'
  const contentId1 = '42000000-0000-4000-8000-000000000001'
  const versionId1 = '52000000-0000-4000-8000-000000000001'

  const mockAdmin = {} as any

  it('handles empty database with zero jobs', async () => {
    const deps: ReconcileNaverPostJobsDependencies = {
      findStuckRunningJobs: vi.fn().mockResolvedValue([]),
      findFlaggedJobs: vi.fn().mockResolvedValue([]),
    }

    const summary = await reconcileNaverPostJobs({
      admin: mockAdmin,
      deps,
    })

    expect(summary).toEqual({
      examined: 0,
      markedFailed: 0,
      completedFromSavedVersion: 0,
      released: 0,
      flagged: 0,
      errors: 0,
    })
  })

  it('ignores running jobs that are under 15 minutes old', async () => {
    const now = new Date('2026-10-10T12:00:00.000Z')
    const runningJob: NaverPostJobRow = {
      id: 'job-1',
      workspace_id: wsId,
      request_key: reqKey1,
      user_id: 'user-1',
      status: 'running',
      content_id: null,
      version_id: null,
      credit_reconcile_needed: false,
      created_at: '2026-10-10T11:50:00.000Z',
      updated_at: '2026-10-10T11:50:00.000Z', // 10 minutes old (< 15 mins)
    }

    const deps: ReconcileNaverPostJobsDependencies = {
      findStuckRunningJobs: vi.fn().mockResolvedValue([runningJob]),
      findFlaggedJobs: vi.fn().mockResolvedValue([]),
      failJob: vi.fn(),
      completeJob: vi.fn(),
    }

    const summary = await reconcileNaverPostJobs({
      admin: mockAdmin,
      now,
      deps,
    })

    expect(summary.examined).toBe(1)
    expect(summary.markedFailed).toBe(0)
    expect(summary.completedFromSavedVersion).toBe(0)
    expect(deps.failJob).not.toHaveBeenCalled()
    expect(deps.completeJob).not.toHaveBeenCalled()
  })

  it('marks running job older than 15 minutes as failed when no saved version exists and releases all unsettled reservations', async () => {
    const now = new Date('2026-10-10T12:00:00.000Z')
    const stuckJob: NaverPostJobRow = {
      id: 'job-stuck-1',
      workspace_id: wsId,
      request_key: reqKey1,
      user_id: 'user-1',
      status: 'running',
      content_id: null,
      version_id: null,
      credit_reconcile_needed: false,
      created_at: '2026-10-10T11:40:00.000Z',
      updated_at: '2026-10-10T11:40:00.000Z', // 20 minutes old (> 15 mins)
    }

    const textMissionId = deterministicUuid(`${reqKey1}:text`)
    const img0MissionId = deterministicUuid(`${reqKey1}:image:0`)

    const reservations: QuickPostReservationRow[] = [
      {
        id: 'res-text',
        workspace_id: wsId,
        mission_id: textMissionId,
        revision: 1,
        scope: 'text',
        credits: 100,
        operation_key: `quick-post:${textMissionId}:1:text`,
        state: 'reserved',
      },
      {
        id: 'res-img-0',
        workspace_id: wsId,
        mission_id: img0MissionId,
        revision: 2,
        scope: 'image',
        credits: 150,
        operation_key: `quick-post:${img0MissionId}:2:image`,
        state: 'reserved',
      },
    ]

    const releaseReservation = vi.fn().mockResolvedValue(undefined)
    const failJob = vi.fn().mockResolvedValue(undefined)

    const deps: ReconcileNaverPostJobsDependencies = {
      findStuckRunningJobs: vi.fn().mockResolvedValue([stuckJob]),
      findFlaggedJobs: vi.fn().mockResolvedValue([]),
      findSavedVersion: vi.fn().mockResolvedValue(null),
      failJob,
      findReservations: vi.fn().mockResolvedValue(reservations),
      releaseReservation,
    }

    const summary = await reconcileNaverPostJobs({
      admin: mockAdmin,
      now,
      deps,
    })

    expect(summary.examined).toBe(1)
    expect(summary.markedFailed).toBe(1)
    expect(summary.completedFromSavedVersion).toBe(0)
    expect(summary.released).toBe(2)
    expect(summary.errors).toBe(0)
    expect(failJob).toHaveBeenCalledWith(mockAdmin, wsId, reqKey1, false)
    expect(releaseReservation).toHaveBeenCalledTimes(2)
  })

  it('DANGEROUS BRANCH: when saved version exists for stuck running job, completes as succeeded and settles text reservation WITHOUT refunding', async () => {
    const now = new Date('2026-10-10T12:00:00.000Z')
    const stuckJob: NaverPostJobRow = {
      id: 'job-stuck-saved',
      workspace_id: wsId,
      request_key: reqKey1,
      user_id: 'user-1',
      status: 'running',
      content_id: null,
      version_id: null,
      credit_reconcile_needed: false,
      created_at: '2026-10-10T11:40:00.000Z',
      updated_at: '2026-10-10T11:40:00.000Z', // 20 minutes old
    }

    const textMissionId = deterministicUuid(`${reqKey1}:text`)
    const img0MissionId = deterministicUuid(`${reqKey1}:image:0`)

    const reservations: QuickPostReservationRow[] = [
      {
        id: 'res-text',
        workspace_id: wsId,
        mission_id: textMissionId,
        revision: 1,
        scope: 'text',
        credits: 100,
        operation_key: `quick-post:${textMissionId}:1:text`,
        state: 'reserved', // Needs settlement!
      },
      {
        id: 'res-img-0',
        workspace_id: wsId,
        mission_id: img0MissionId,
        revision: 2,
        scope: 'image',
        credits: 150,
        operation_key: `quick-post:${img0MissionId}:2:image`,
        state: 'settled', // Already settled during generation
      },
    ]

    const completeJob = vi.fn().mockResolvedValue(undefined)
    const failJob = vi.fn().mockResolvedValue(undefined)
    const settleReservation = vi.fn().mockResolvedValue(undefined)
    const releaseReservation = vi.fn().mockResolvedValue(undefined)

    const deps: ReconcileNaverPostJobsDependencies = {
      findStuckRunningJobs: vi.fn().mockResolvedValue([stuckJob]),
      findFlaggedJobs: vi.fn().mockResolvedValue([]),
      findSavedVersion: vi.fn().mockResolvedValue({ contentId: contentId1, versionId: versionId1 }),
      completeJob,
      failJob,
      findReservations: vi.fn().mockResolvedValue(reservations),
      settleReservation,
      releaseReservation,
    }

    const summary = await reconcileNaverPostJobs({
      admin: mockAdmin,
      now,
      deps,
    })

    expect(summary.examined).toBe(1)
    expect(summary.markedFailed).toBe(0)
    expect(summary.completedFromSavedVersion).toBe(1)
    expect(summary.released).toBe(0)
    expect(summary.errors).toBe(0)

    expect(completeJob).toHaveBeenCalledWith(mockAdmin, wsId, reqKey1, contentId1, versionId1, false)
    expect(failJob).not.toHaveBeenCalled()
    expect(settleReservation).toHaveBeenCalledWith(mockAdmin, wsId, 'res-text', `quick-post:${textMissionId}:1:text`)
    // CRITICAL: releaseReservation must NEVER be called when version was saved!
    expect(releaseReservation).not.toHaveBeenCalled()
  })

  it('processes already-failed job with credit_reconcile_needed = true and releases unsettled holds', async () => {
    const failedFlaggedJob: NaverPostJobRow = {
      id: 'job-failed-flagged',
      workspace_id: wsId,
      request_key: reqKey1,
      user_id: 'user-1',
      status: 'failed',
      content_id: null,
      version_id: null,
      credit_reconcile_needed: true,
      created_at: '2026-10-10T11:00:00.000Z',
      updated_at: '2026-10-10T11:00:00.000Z',
    }

    const textMissionId = deterministicUuid(`${reqKey1}:text`)
    const reservations: QuickPostReservationRow[] = [
      {
        id: 'res-text',
        workspace_id: wsId,
        mission_id: textMissionId,
        revision: 1,
        scope: 'text',
        credits: 100,
        operation_key: `quick-post:${textMissionId}:1:text`,
        state: 'reserved',
      },
    ]

    const clearReconcileFlag = vi.fn().mockResolvedValue(undefined)
    const releaseReservation = vi.fn().mockResolvedValue(undefined)

    const deps: ReconcileNaverPostJobsDependencies = {
      findStuckRunningJobs: vi.fn().mockResolvedValue([]),
      findFlaggedJobs: vi.fn().mockResolvedValue([failedFlaggedJob]),
      findReservations: vi.fn().mockResolvedValue(reservations),
      releaseReservation,
      clearReconcileFlag,
    }

    const summary = await reconcileNaverPostJobs({
      admin: mockAdmin,
      deps,
    })

    expect(summary.examined).toBe(1)
    expect(summary.flagged).toBe(1)
    expect(summary.released).toBe(1)
    expect(summary.errors).toBe(0)
    expect(clearReconcileFlag).toHaveBeenCalledWith(mockAdmin, 'job-failed-flagged')
  })

  it('processes already-succeeded job with credit_reconcile_needed = true and settles unsettled text/image holds', async () => {
    const succeededFlaggedJob: NaverPostJobRow = {
      id: 'job-succeeded-flagged',
      workspace_id: wsId,
      request_key: reqKey1,
      user_id: 'user-1',
      status: 'succeeded',
      content_id: contentId1,
      version_id: versionId1,
      credit_reconcile_needed: true,
      created_at: '2026-10-10T11:00:00.000Z',
      updated_at: '2026-10-10T11:00:00.000Z',
    }

    const textMissionId = deterministicUuid(`${reqKey1}:text`)
    const reservations: QuickPostReservationRow[] = [
      {
        id: 'res-text',
        workspace_id: wsId,
        mission_id: textMissionId,
        revision: 1,
        scope: 'text',
        credits: 100,
        operation_key: `quick-post:${textMissionId}:1:text`,
        state: 'reserved',
      },
    ]

    const clearReconcileFlag = vi.fn().mockResolvedValue(undefined)
    const settleReservation = vi.fn().mockResolvedValue(undefined)
    const releaseReservation = vi.fn().mockResolvedValue(undefined)

    const deps: ReconcileNaverPostJobsDependencies = {
      findStuckRunningJobs: vi.fn().mockResolvedValue([]),
      findFlaggedJobs: vi.fn().mockResolvedValue([succeededFlaggedJob]),
      findReservations: vi.fn().mockResolvedValue(reservations),
      settleReservation,
      releaseReservation,
      clearReconcileFlag,
    }

    const summary = await reconcileNaverPostJobs({
      admin: mockAdmin,
      deps,
    })

    expect(summary.examined).toBe(1)
    expect(summary.flagged).toBe(1)
    expect(summary.released).toBe(0)
    expect(summary.errors).toBe(0)
    expect(settleReservation).toHaveBeenCalledWith(mockAdmin, wsId, 'res-text', `quick-post:${textMissionId}:1:text`)
    expect(releaseReservation).not.toHaveBeenCalled()
    expect(clearReconcileFlag).toHaveBeenCalledWith(mockAdmin, 'job-succeeded-flagged')
  })

  it('DANGEROUS BRANCH: never double-releases already-released reservations and never releases settled reservations', async () => {
    const failedJob: NaverPostJobRow = {
      id: 'job-partial',
      workspace_id: wsId,
      request_key: reqKey1,
      user_id: 'user-1',
      status: 'failed',
      content_id: null,
      version_id: null,
      credit_reconcile_needed: true,
      created_at: '2026-10-10T11:00:00.000Z',
      updated_at: '2026-10-10T11:00:00.000Z',
    }

    const textMissionId = deterministicUuid(`${reqKey1}:text`)
    const img0MissionId = deterministicUuid(`${reqKey1}:image:0`)
    const img1MissionId = deterministicUuid(`${reqKey1}:image:1`)

    const reservations: QuickPostReservationRow[] = [
      {
        id: 'res-text',
        workspace_id: wsId,
        mission_id: textMissionId,
        revision: 1,
        scope: 'text',
        credits: 100,
        operation_key: `quick-post:${textMissionId}:1:text`,
        state: 'released', // Already released previously! Must not double-release.
      },
      {
        id: 'res-img-0',
        workspace_id: wsId,
        mission_id: img0MissionId,
        revision: 2,
        scope: 'image',
        credits: 150,
        operation_key: `quick-post:${img0MissionId}:2:image`,
        state: 'settled', // Stored image! Must NEVER be released.
      },
      {
        id: 'res-img-1',
        workspace_id: wsId,
        mission_id: img1MissionId,
        revision: 2,
        scope: 'image',
        credits: 150,
        operation_key: `quick-post:${img1MissionId}:2:image`,
        state: 'reserved', // Only this one is unsettled.
      },
    ]

    const releaseReservation = vi.fn().mockResolvedValue(undefined)
    const clearReconcileFlag = vi.fn().mockResolvedValue(undefined)

    const deps: ReconcileNaverPostJobsDependencies = {
      findStuckRunningJobs: vi.fn().mockResolvedValue([]),
      findFlaggedJobs: vi.fn().mockResolvedValue([failedJob]),
      findReservations: vi.fn().mockResolvedValue(reservations),
      releaseReservation,
      clearReconcileFlag,
    }

    const summary = await reconcileNaverPostJobs({
      admin: mockAdmin,
      deps,
    })

    expect(summary.examined).toBe(1)
    expect(summary.released).toBe(1)
    expect(releaseReservation).toHaveBeenCalledTimes(1)
    expect(releaseReservation).toHaveBeenCalledWith(mockAdmin, wsId, 'res-img-1', `quick-post:${img1MissionId}:2:image`)
    expect(clearReconcileFlag).toHaveBeenCalledWith(mockAdmin, 'job-partial')
  })

  it('when release RPC fails, flag stays credit_reconcile_needed = true and error is counted', async () => {
    const failedJob: NaverPostJobRow = {
      id: 'job-rpc-err',
      workspace_id: wsId,
      request_key: reqKey1,
      user_id: 'user-1',
      status: 'failed',
      content_id: null,
      version_id: null,
      credit_reconcile_needed: true,
      created_at: '2026-10-10T11:00:00.000Z',
      updated_at: '2026-10-10T11:00:00.000Z',
    }

    const textMissionId = deterministicUuid(`${reqKey1}:text`)
    const reservations: QuickPostReservationRow[] = [
      {
        id: 'res-text',
        workspace_id: wsId,
        mission_id: textMissionId,
        revision: 1,
        scope: 'text',
        credits: 100,
        operation_key: `quick-post:${textMissionId}:1:text`,
        state: 'reserved',
      },
    ]

    const releaseReservation = vi.fn().mockRejectedValue(new Error('RPC timeout'))
    const clearReconcileFlag = vi.fn()

    const deps: ReconcileNaverPostJobsDependencies = {
      findStuckRunningJobs: vi.fn().mockResolvedValue([]),
      findFlaggedJobs: vi.fn().mockResolvedValue([failedJob]),
      findReservations: vi.fn().mockResolvedValue(reservations),
      releaseReservation,
      clearReconcileFlag,
    }

    const summary = await reconcileNaverPostJobs({
      admin: mockAdmin,
      deps,
    })

    expect(summary.examined).toBe(1)
    expect(summary.flagged).toBe(1)
    expect(summary.released).toBe(0)
    expect(summary.errors).toBe(1)
    // CRITICAL: clearReconcileFlag must NOT be called if an RPC failed!
    expect(clearReconcileFlag).not.toHaveBeenCalled()
  })

  it('replay is idempotent: second run on already-reconciled jobs performs no extra RPCs', async () => {
    // Already reconciled job: status failed, credit_reconcile_needed false, reservations released
    const textMissionId = deterministicUuid(`${reqKey1}:text`)
    const reservations: QuickPostReservationRow[] = [
      {
        id: 'res-text',
        workspace_id: wsId,
        mission_id: textMissionId,
        revision: 1,
        scope: 'text',
        credits: 100,
        operation_key: `quick-post:${textMissionId}:1:text`,
        state: 'released',
      },
    ]

    const releaseReservation = vi.fn()
    const settleReservation = vi.fn()

    const deps: ReconcileNaverPostJobsDependencies = {
      findStuckRunningJobs: vi.fn().mockResolvedValue([]),
      findFlaggedJobs: vi.fn().mockResolvedValue([]),
      findReservations: vi.fn().mockResolvedValue(reservations),
      releaseReservation,
      settleReservation,
    }

    const summary = await reconcileNaverPostJobs({
      admin: mockAdmin,
      deps,
    })

    expect(summary.examined).toBe(0)
    expect(summary.released).toBe(0)
    expect(releaseReservation).not.toHaveBeenCalled()
    expect(settleReservation).not.toHaveBeenCalled()
  })

  it('never throws on a corrupted/bad row, logs error and continues with remaining jobs', async () => {
    const badJob: NaverPostJobRow = {
      id: 'job-bad',
      workspace_id: wsId,
      request_key: reqKey1,
      user_id: 'user-1',
      status: 'failed',
      content_id: null,
      version_id: null,
      credit_reconcile_needed: true,
      created_at: '2026-10-10T11:00:00.000Z',
      updated_at: '2026-10-10T11:00:00.000Z',
    }

    const reqKey2 = '32000000-0000-4000-8000-000000000002'
    const goodJob: NaverPostJobRow = {
      id: 'job-good',
      workspace_id: wsId,
      request_key: reqKey2,
      user_id: 'user-1',
      status: 'failed',
      content_id: null,
      version_id: null,
      credit_reconcile_needed: true,
      created_at: '2026-10-10T11:00:00.000Z',
      updated_at: '2026-10-10T11:00:00.000Z',
    }

    const textMissionId2 = deterministicUuid(`${reqKey2}:text`)
    const goodReservations: QuickPostReservationRow[] = [
      {
        id: 'res-good',
        workspace_id: wsId,
        mission_id: textMissionId2,
        revision: 1,
        scope: 'text',
        credits: 100,
        operation_key: `quick-post:${textMissionId2}:1:text`,
        state: 'reserved',
      },
    ]

    const releaseReservation = vi.fn().mockResolvedValue(undefined)
    const clearReconcileFlag = vi.fn().mockResolvedValue(undefined)

    const deps: ReconcileNaverPostJobsDependencies = {
      findStuckRunningJobs: vi.fn().mockResolvedValue([]),
      findFlaggedJobs: vi.fn().mockResolvedValue([badJob, goodJob]),
      findReservations: vi.fn().mockImplementation(async (_admin, _ws, missionIds) => {
        if (missionIds.includes(deterministicUuid(`${reqKey1}:text`))) {
          throw new Error('Database corrupted row read failure')
        }
        return goodReservations
      }),
      releaseReservation,
      clearReconcileFlag,
    }

    const summary = await reconcileNaverPostJobs({
      admin: mockAdmin,
      deps,
    })

    expect(summary.examined).toBe(2)
    expect(summary.errors).toBe(1) // bad row error counted
    expect(summary.released).toBe(1) // good row succeeded!
    expect(clearReconcileFlag).toHaveBeenCalledWith(mockAdmin, 'job-good')
    expect(clearReconcileFlag).not.toHaveBeenCalledWith(mockAdmin, 'job-bad')
  })

  it('respects the limit parameter and processes oldest updated jobs first', async () => {
    const jobOlder: NaverPostJobRow = {
      id: 'job-older',
      workspace_id: wsId,
      request_key: reqKey1,
      user_id: 'user-1',
      status: 'failed',
      content_id: null,
      version_id: null,
      credit_reconcile_needed: true,
      created_at: '2026-10-10T10:00:00.000Z',
      updated_at: '2026-10-10T10:00:00.000Z',
    }
    const jobNewer: NaverPostJobRow = {
      id: 'job-newer',
      workspace_id: wsId,
      request_key: '32000000-0000-4000-8000-000000000003',
      user_id: 'user-1',
      status: 'failed',
      content_id: null,
      version_id: null,
      credit_reconcile_needed: true,
      created_at: '2026-10-10T11:00:00.000Z',
      updated_at: '2026-10-10T11:00:00.000Z',
    }

    const deps: ReconcileNaverPostJobsDependencies = {
      findStuckRunningJobs: vi.fn().mockResolvedValue([]),
      findFlaggedJobs: vi.fn().mockResolvedValue([jobNewer, jobOlder]),
      findReservations: vi.fn().mockResolvedValue([]),
      clearReconcileFlag: vi.fn().mockResolvedValue(undefined),
    }

    const summary = await reconcileNaverPostJobs({
      admin: mockAdmin,
      limit: 1,
      deps,
    })

    expect(summary.examined).toBe(1)
    expect(deps.clearReconcileFlag).toHaveBeenCalledWith(mockAdmin, 'job-older')
    expect(deps.clearReconcileFlag).not.toHaveBeenCalledWith(mockAdmin, 'job-newer')
  })
})
