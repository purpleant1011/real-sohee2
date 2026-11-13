#!/usr/bin/env node

/**
 * Reconciles stalled marketing missions by linking them with their corresponding
 * conversation_jobs and progressing their lifecycle state with durable audit events.
 * 
 * Traceability: ANI-1233
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://your-project-ref.supabase.co'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY environment variable is required.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function reconcile() {
  console.log('🔄 [Mission Reconciler · ANI-1233] Fetching stalled marketing missions...')

  const { data: missions, error: mErr } = await supabase
    .from('marketing_missions')
    .select('id, workspace_id, trace_id, status, source_message_id, source_conversation_job_id, goal')
    .is('source_conversation_job_id', null)

  if (mErr) {
    console.error('Error fetching missions:', mErr)
    process.exit(1)
  }

  console.log(`Found ${missions.length} missions with missing source_conversation_job_id.`)

  let reconciledCount = 0

  for (const mission of missions) {
    if (!mission.source_message_id) continue

    // Find corresponding conversation_job by user_message_id
    const { data: jobs, error: jErr } = await supabase
      .from('conversation_jobs')
      .select('id, status, plan_data, assistant_message_id, started_at, completed_at')
      .eq('workspace_id', mission.workspace_id)
      .eq('user_message_id', mission.source_message_id)
      .limit(1)

    if (jErr || !jobs || jobs.length === 0) {
      console.log(`  [Skip] No conversation_job found for mission ${mission.id} (msg: ${mission.source_message_id})`)
      continue
    }

    const job = jobs[0]
    console.log(`  [Reconciling] Mission ${mission.id} ➔ Job ${job.id} (Job status: ${job.status})`)

    // Determine target mission status
    let targetStatus = 'PLANNING'
    if (job.status === 'succeeded' || job.status === 'completed') {
      targetStatus = 'COMPLETED'
    } else if (job.status === 'needs_attention') {
      targetStatus = 'AWAITING_APPROVAL'
    } else if (job.status === 'running') {
      targetStatus = 'PLANNING'
    }

    const now = new Date().toISOString()

    // 1. Update mission
    const { error: uErr } = await supabase
      .from('marketing_missions')
      .update({
        source_conversation_job_id: job.id,
        status: targetStatus,
        updated_at: now,
      })
      .eq('id', mission.id)

    if (uErr) {
      console.error(`  ❌ Failed to update mission ${mission.id}:`, uErr)
      continue
    }

    // 2. Append transition event
    await supabase.from('mission_events').insert([
      {
        workspace_id: mission.workspace_id,
        mission_id: mission.id,
        trace_id: mission.trace_id,
        from_status: mission.status,
        to_status: targetStatus,
        actor_type: 'system',
        event_name: `MISSION_${targetStatus}`,
        payload: {
          reconciled: true,
          reconciledJobId: job.id,
          originalJobStatus: job.status,
        },
        occurred_at: now,
      },
    ])

    console.log(`  ✅ Reconciled Mission ${mission.id}: status ${mission.status} ➔ ${targetStatus}, bound Job ${job.id}`)
    reconciledCount++
  }

  console.log(`\n🎉 Reconciliation completed! Reconciled ${reconciledCount} of ${missions.length} stalled missions.`)
}

reconcile().catch((err) => {
  console.error('Fatal error during reconciliation:', err)
  process.exit(1)
})
