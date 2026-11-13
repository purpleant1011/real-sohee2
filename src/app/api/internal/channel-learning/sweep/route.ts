import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { createLearningRepository } from '@/features/channel-learning/repository'
import { isRenewalEligible } from '@/features/channel-learning/verification-renewal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET
  const supplied = request.headers.get('authorization')
  if (!expected || expected.length < 20 || !supplied?.startsWith('Bearer ')) return false
  const left = Buffer.from(supplied.slice(7))
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

async function getQueue(): Promise<{ send(message: unknown): Promise<void> } | null> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    const { env } = await getCloudflareContext({ async: true })
    return (
      (env as unknown as { CONVERSATION_JOBS_QUEUE?: { send(message: unknown): Promise<void> } })
        .CONVERSATION_JOBS_QUEUE ?? null
    )
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  let admin: any
  let repo: any
  try {
    admin = createAdminSupabaseClient()
    if (!admin) throw new Error('ADMIN_CLIENT_UNAVAILABLE')
    repo = createLearningRepository(admin)
  } catch (initErr) {
    console.error('Channel learning sweep initialization failure:', initErr)
    return NextResponse.json(
      { ok: false, error: 'service_unavailable', failureReasons: ['INTERNAL_SWEEP_ERROR'] },
      { status: 503 },
    )
  }

  const queue = await getQueue()
  const failures: string[] = []
  let verifiedEnqueued = 0
  let deletedEnqueued = 0
  let purgedCount = 0

  // 1. 18-hour renewal sweep: query current active evidence leases (JOINed in RPC, oldest-first)
  try {
    const { data: dueVerifications, error: rpcError } = await admin.rpc(
      'list_due_learning_verifications',
      { p_limit: 50 },
    )

    let candidateRows: Array<{
      workspace_id: string
      source_id: string
      source_revision: number
      evidence_revision: number
    }> = []

    if (!rpcError && Array.isArray(dueVerifications)) {
      candidateRows = dueVerifications
    } else if (rpcError) {
      // Fallback if RPC is unavailable: query active sources directly and check current evidence revision
      const { data: sources, error: fallbackError } = await admin
        .from('knowledge_sources')
        .select('id, workspace_id, lifecycle_revision, evidence_revision')
        .eq('is_learning_source', true)
        .eq('learning_verification_status', 'verified')
        .is('deleted_at', null)
        .neq('status', 'paused')
        .limit(50)

      if (fallbackError) {
        failures.push('LEASE_QUERY_FAILED')
      } else if (Array.isArray(sources)) {
        for (const s of sources) {
          const { data: lease } = await admin
            .from('learning_evidence_leases')
            .select('verified_at, expires_at, evidence_revision')
            .eq('workspace_id', s.workspace_id)
            .eq('knowledge_source_id', s.id)
            .eq('evidence_revision', s.evidence_revision)
            .maybeSingle()

          if (lease && isRenewalEligible({ verifiedAt: lease.verified_at } as any)) {
            candidateRows.push({
              workspace_id: s.workspace_id,
              source_id: s.id,
              source_revision: s.lifecycle_revision ?? 1,
              evidence_revision: s.evidence_revision,
            })
          }
        }
      }
    }

    for (const item of candidateRows) {
      try {
        const job = await repo.createJob({
          workspaceId: item.workspace_id,
          sourceId: item.source_id,
          sourceRevision: item.source_revision,
          kind: 'verify',
          idempotencyKey: `verify:${item.source_id}:${item.source_revision}:${item.evidence_revision}`,
        })

        if (queue) {
          try {
            await queue.send({
              schemaVersion: 2,
              kind: 'knowledge_verify',
              jobId: job.id,
              workspaceId: item.workspace_id,
            })
            verifiedEnqueued++
          } catch {
            failures.push('QUEUE_SEND_FAILED')
          }
        } else {
          failures.push('QUEUE_UNAVAILABLE')
        }
      } catch (jobErr: any) {
        const msg = (jobErr?.message || '').toLowerCase()
        if (msg.includes('idempotent') || msg.includes('conflict') || msg.includes('already exists')) {
          // Idempotent collision on concurrent worker sweep; expected
        } else {
          failures.push('JOB_CREATE_FAILED')
        }
      }
    }
  } catch (err) {
    console.error('Channel learning renewal sweep unhandled error:', err)
    failures.push('SWEEP_QUERY_EXCEPTION')
  }

  // 2. Durable outbox: enqueue queued deletion jobs and expired running deletion jobs (oldest first)
  try {
    const { data: queuedJobs, error: queuedErr } = await admin
      .from('learning_jobs')
      .select('id, workspace_id')
      .eq('job_kind', 'delete')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(50)

    const nowIso = new Date().toISOString()
    const { data: expiredRunningJobs, error: expiredErr } = await admin
      .from('learning_jobs')
      .select('id, workspace_id')
      .eq('job_kind', 'delete')
      .eq('status', 'running')
      .lte('lease_expires_at', nowIso)
      .order('created_at', { ascending: true })
      .limit(50)

    if (queuedErr || expiredErr) {
      failures.push('DELETE_OUTBOX_QUERY_FAILED')
    } else {
      const seen = new Set<string>()
      const candidateDeleteJobs: Array<{ id: string; workspace_id: string }> = []
      for (const dj of [...(queuedJobs || []), ...(expiredRunningJobs || [])]) {
        if (!seen.has(dj.id)) {
          seen.add(dj.id)
          candidateDeleteJobs.push(dj)
        }
      }

      for (const dj of candidateDeleteJobs) {
        if (queue) {
          try {
            await queue.send({
              schemaVersion: 2,
              kind: 'knowledge_delete',
              jobId: dj.id,
              workspaceId: dj.workspace_id,
            })
            deletedEnqueued++
          } catch {
            failures.push('DELETE_QUEUE_SEND_FAILED')
          }
        } else {
          failures.push('QUEUE_UNAVAILABLE')
        }
      }
    }
  } catch (err) {
    console.error('Channel learning delete outbox unhandled error:', err)
    failures.push('DELETE_OUTBOX_EXCEPTION')
  }

  // 3. 7-day retention purge RPC
  try {
    const { data: purgeResult, error: purgeError } = await admin.rpc('purge_expired_learning_payloads', {})
    if (purgeError) {
      failures.push('RETENTION_PURGE_RPC_FAILED')
    } else if (purgeResult) {
      purgedCount = Number(purgeResult.purgedCount ?? purgeResult.purged_count ?? 0)
    }
  } catch (err) {
    console.error('Channel learning retention purge unhandled error:', err)
    failures.push('RETENTION_PURGE_EXCEPTION')
  }

  const isCompleteFailure =
    failures.length > 0 &&
    verifiedEnqueued === 0 &&
    deletedEnqueued === 0 &&
    purgedCount === 0

  return NextResponse.json(
    {
      ok: failures.length === 0,
      verifiedEnqueued,
      deletedEnqueued,
      purgedCount,
      ...(failures.length > 0
        ? {
            partial: !isCompleteFailure,
            failureReasons: [...new Set(failures)],
          }
        : {}),
    },
    { status: isCompleteFailure ? 503 : 200 },
  )
}
