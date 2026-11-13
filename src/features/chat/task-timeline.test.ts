import { describe, expect, it } from 'vitest'
import { parseTaskTimeline, createTaskTracker, restoreTaskTimeline } from './task-timeline'

const timeline = { id: 't', kind: 'task_timeline', title: '원고 준비', totalSteps: 1, completedSteps: 0,
  steps: [{ id: 'write', title: '원고 작성', status: 'in_progress' }], isLive: true }

describe('server task timeline contract', () => {
  it('restores only the explicit internal reply-draft result markers', () => {
    const marked = { ...timeline, steps: [{ ...timeline.steps[0], capabilityId: 'comment.reply_draft' }] }
    expect(parseTaskTimeline(marked)?.steps[0]).toMatchObject({ capabilityId: 'comment.reply_draft' })
    expect(parseTaskTimeline({ ...marked, steps: [{ ...marked.steps[0], capabilityId: 'dm.send' }] })).toBeNull()
  })
  it('rejects malformed, duplicate and contradictory task snapshots', () => {
    expect(parseTaskTimeline(timeline)).not.toBeNull()
    for (const bad of [null, {}, { ...timeline, steps: [null] }, { ...timeline, completedSteps: 1 },
      { ...timeline, totalSteps: 2 }, { ...timeline, steps: [timeline.steps[0], timeline.steps[0]] },
      { ...timeline, steps: [{ ...timeline.steps[0], durationMs: -1 }] }]) expect(parseTaskTimeline(bad)).toBeNull()
  })
  it('records only actual awaited work and does not complete pending tasks on failure', async () => {
    const snapshots: unknown[] = []
    const tracker = createTaskTracker('message', async value => { snapshots.push(value) })
    await tracker.start('write', '원고 작성')
    await tracker.complete('write')
    await tracker.start('images', '이미지 준비')
    await tracker.stop('failed')
    expect(snapshots).toHaveLength(4)
    expect(parseTaskTimeline(snapshots[3])).toMatchObject({ isLive: false, completedSteps: 1,
      steps: [{ status: 'completed' }, { status: 'failed' }] })
  })
  it('appends the real detail on completion and marks partial work unknown instead of completed', async () => {
    const snapshots: unknown[] = []
    const tracker = createTaskTracker('m', async value => { snapshots.push(value) })
    await tracker.start('facts', '사실 확인')
    await tracker.complete('facts', '승인 사실 2건')
    await tracker.start('images', '이미지 준비')
    await tracker.incomplete('images', '이미지 2/3')
    const last = parseTaskTimeline(snapshots.at(-1))!
    expect(last.steps).toMatchObject([
      { title: '사실 확인 · 승인 사실 2건', status: 'completed' },
      { title: '이미지 준비 · 이미지 2/3', status: 'unknown' },
    ])
    expect(last.completedSteps).toBe(1)
  })
  it('shows planned tasks as pending until their actual start', async () => {
    const snapshots: unknown[] = []
    const tracker = createTaskTracker('m', async value => { snapshots.push(value) })
    await tracker.plan([{ id: 'draft', title: '원고 준비' }, { id: 'save', title: '결과 저장' }])
    await tracker.start('draft', '원고 준비')
    expect(parseTaskTimeline(snapshots[0])?.steps.map(step => step.status)).toEqual(['pending', 'pending'])
    expect(parseTaskTimeline(snapshots[1])?.steps.map(step => step.status)).toEqual(['in_progress', 'pending'])
  })
  it('stops animation on restore without manufacturing completion', () => {
    expect(restoreTaskTimeline(timeline, 'completed')).toMatchObject({ isLive: false, completedSteps: 0,
      steps: [{ status: 'unknown' }] })
    expect(restoreTaskTimeline(timeline, 'cancelled')?.steps[0].status).toBe('cancelled')
  })
})
