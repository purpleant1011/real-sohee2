import { afterEach, describe, expect, it, vi } from 'vitest'
import { reloadOnceForStaleDeploy } from './reload-once-for-stale-deploy'

describe('reloadOnceForStaleDeploy', () => {
  afterEach(() => { window.sessionStorage.clear(); vi.restoreAllMocks() })

  it('reloads once, then refuses within a minute to avoid reload loops', () => {
    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as unknown as Location)
    expect(reloadOnceForStaleDeploy(1_000_000)).toBe(true)
    expect(reloadOnceForStaleDeploy(1_030_000)).toBe(false)
    expect(reloadOnceForStaleDeploy(1_070_000)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })
})
