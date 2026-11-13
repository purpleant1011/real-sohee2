import { describe, expect, it } from 'vitest'
import { parseScheduleQuery } from './schedule-query-state'

describe('parseScheduleQuery', () => {
  it('rejects invalid values and keeps a selected schedule id', () => {
    expect(parseScheduleQuery({ kind: 'wrong', selected: 'schedule-1', status: 'broken' })).toEqual({
      kind: 'all',
      selected: 'schedule-1',
      status: 'all',
    })
  })
})
