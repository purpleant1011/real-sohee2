import { describe, expect, it } from 'vitest'
import type { ScheduleEntry } from './repository'
import {
  buildDailyScheduleProjection,
  buildDailyScheduleSummary,
  countScheduleStatuses,
  groupSchedulesByDay,
  resolveScheduleDate,
  scheduleStatusFilter,
} from './schedule-view'

function entry(id: string, status: ScheduleEntry['status'], publishAt: string): ScheduleEntry {
  return {
    id,
    content_id: `30000000-0000-4000-8000-${id.padStart(12, '0')}`,
    version_id: `40000000-0000-4000-8000-${id.padStart(12, '0')}`,
    publish_at: publishAt,
    timezone: 'Asia/Seoul',
    status,
    channel_connection_id: `50000000-0000-4000-8000-${id.padStart(12, '0')}`,
    updated_at: publishAt,
    title: `일정 ${id}`,
    channel: 'instagram',
    versionNumber: 3,
  }
}

const schedules = [
  entry('1', 'scheduled', '2030-08-14T15:30:00.000Z'),
  entry('2', 'publishing', '2030-08-14T03:00:00.000Z'),
  entry('3', 'published', '2030-08-13T23:00:00.000Z'),
  entry('4', 'failed', '2030-08-15T01:00:00.000Z'),
  entry('5', 'unknown', '2030-08-15T02:00:00.000Z'),
  entry('6', 'cancelled', '2030-08-13T02:00:00.000Z'),
]

describe('schedule view projection', () => {
  it('maps every execution status into the operator filter that needs the same action', () => {
    expect(schedules.map((item) => scheduleStatusFilter(item.status))).toEqual([
      'upcoming',
      'publishing',
      'completed',
      'recovery',
      'recovery',
      'completed',
    ])
  })

  it('counts upcoming, in-progress, completed, and recovery schedules without hiding unknown outcomes', () => {
    expect(countScheduleStatuses(schedules)).toEqual({
      all: 6,
      upcoming: 1,
      publishing: 1,
      completed: 2,
      recovery: 2,
    })
  })

  it('groups schedules by their own local timezone day and sorts each day by scheduled time', () => {
    const groups = groupSchedulesByDay(schedules)

    expect(groups.map((group) => ({ key: group.key, label: group.label, ids: group.items.map((item) => item.id) }))).toEqual([
      { key: '2030-08-13', label: '8월 13일 화요일', ids: ['6'] },
      { key: '2030-08-14', label: '8월 14일 수요일', ids: ['3', '2'] },
      { key: '2030-08-15', label: '8월 15일 목요일', ids: ['1', '4', '5'] },
    ])
  })

  it('counts a successful post on the local day when the provider actually finished it', () => {
    const published = { ...entry('7', 'published', '2030-08-14T14:59:00.000Z'), channel: 'threads' }
    const summary = buildDailyScheduleSummary({
      selectedDate: '2030-08-15',
      timezone: 'Asia/Seoul',
      schedules: [published],
      attempts: {
        [published.id]: {
          id: '70000000-0000-4000-8000-000000000007',
          schedule_id: published.id,
          attempt_number: 1,
          status: 'succeeded',
          provider_reference: 'threads-post-7',
          error_code: null,
          started_at: '2030-08-14T14:59:00.000Z',
          finished_at: '2030-08-14T15:01:00.000Z',
        },
      },
      planCount: 0,
      readyCount: 0,
      additionalAttentionCount: 0,
    })

    expect(summary).toEqual({
      plannedCount: 0,
      completedCount: 1,
      needsAttentionCount: 0,
      completedChannels: [{ channel: 'threads', count: 1 }],
    })
  })

  it('uses the same selected-date schedules for briefing counts and visible groups', () => {
    const selectedScheduled = entry('8', 'scheduled', '2030-08-14T01:00:00.000Z')
    const otherDayScheduled = entry('9', 'scheduled', '2030-08-15T01:00:00.000Z')
    const selectedCompleted = entry('10', 'published', '2030-08-14T02:00:00.000Z')

    const projection = buildDailyScheduleProjection({
      selectedDate: '2030-08-14',
      timezone: 'Asia/Seoul',
      schedules: [selectedScheduled, otherDayScheduled, selectedCompleted],
      attempts: {},
    })

    expect(projection.summary).toMatchObject({
      plannedCount: 1,
      completedCount: 1,
      needsAttentionCount: 0,
    })
    expect(projection.activeSchedules.map((item) => item.id)).toEqual([selectedScheduled.id])
    expect(projection.completedSchedules.map((item) => item.id)).toEqual([selectedCompleted.id])
  })

  it('keeps undated decisions out of a selected day briefing', () => {
    const projection = buildDailyScheduleProjection({
      selectedDate: '2030-08-14',
      timezone: 'Asia/Seoul',
      schedules: [],
      attempts: {},
    })

    expect(projection.summary).toEqual({
      plannedCount: 0,
      completedCount: 0,
      needsAttentionCount: 0,
      completedChannels: [],
    })
    expect(projection.activeSchedules).toEqual([])
    expect(projection.completedSchedules).toEqual([])
  })

  it('counts selected-day Sohee preparation and completed internal work', () => {
    const projection = buildDailyScheduleProjection({
      selectedDate: '2030-08-14',
      timezone: 'Asia/Seoul',
      schedules: [],
      attempts: {},
      internalTasks: [
        {
          id: '70000000-0000-4000-8000-000000000010',
          conversationThreadId: '71000000-0000-4000-8000-000000000010',
          kind: 'publish_preparation',
          state: 'preparing',
          title: '게시할 내용을 준비하고 있어요',
          occurredAt: '2030-08-14T01:00:00.000Z',
          completedAt: null,
        },
        {
          id: '70000000-0000-4000-8000-000000000011',
          conversationThreadId: '71000000-0000-4000-8000-000000000011',
          kind: 'image_generation',
          state: 'completed',
          title: '콘텐츠 이미지를 준비했어요',
          occurredAt: '2030-08-14T02:00:00.000Z',
          completedAt: '2030-08-14T02:10:00.000Z',
        },
      ],
    })

    expect(projection.summary).toMatchObject({ plannedCount: 1, completedCount: 1, needsAttentionCount: 0 })
    expect(projection.activeInternalTasks).toHaveLength(1)
    expect(projection.completedInternalTasks).toHaveLength(1)
  })

  it('uses a valid requested date and safely falls back to the workspace local date', () => {
    const now = new Date('2026-08-22T15:30:00.000Z')

    expect(resolveScheduleDate('2032-02-29', now, 'Asia/Seoul')).toBe('2032-02-29')
    expect(resolveScheduleDate('2030-02-29', now, 'Asia/Seoul')).toBe('2026-08-23')
    expect(resolveScheduleDate(undefined, now, 'Asia/Seoul')).toBe('2026-08-23')
  })
})
