import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20260822191521_schedule_guarded_reschedule.sql',
), 'utf8')

describe('schedule guarded migration', () => {
  it('adds customer appointment timing and guarded schedule mutations', () => {
    expect(migration).toContain('booking_starts_at timestamptz')
    expect(migration).toContain('booking_timezone text')
    expect(migration).toContain('reschedule_content_guarded')
    expect(migration).toContain('cancel_schedule_guarded')
    expect(migration).toContain('schedule_changed')
    expect(migration).toContain("array['owner', 'manager']")
    expect(migration).toContain("schedule.status = 'scheduled'")
    expect(migration).toContain("other.status in ('scheduled', 'publishing')")
    expect(migration).toContain('schedule_customer_conflict')
    expect(migration).toContain('schedule_channel_conflict')
    expect(migration).toContain('schedule_approved_content_once_internal')
    expect(migration.match(/schedule-conflict:/g)).toHaveLength(2)
  })

  it('keeps privileged implementations private and grants only authenticated wrappers', () => {
    expect(migration).toContain('revoke all on function private.reschedule_content_guarded_internal')
    expect(migration).toContain('revoke all on function public.reschedule_content_guarded')
    expect(migration).toContain('grant execute on function public.reschedule_content_guarded')
    expect(migration).toContain('to authenticated')
  })
})
