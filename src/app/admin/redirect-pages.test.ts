import { describe, expect, it, vi } from 'vitest'

const redirect = vi.hoisted(() => vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) }))
vi.mock('next/navigation', () => ({ redirect }))

const cases: Array<[string, string]> = [
  ['control-tower', '/admin'],
  ['control-plane', '/admin'],
  ['agents', '/admin/missions'],
  ['support', '/admin/feedback'],
  ['privileged-access', '/admin/governance'],
  ['plugins', '/admin/system'],
  ['go-nogo', '/admin/system'],
]

describe('retired admin pages', () => {
  it.each(cases)('%s redirects to %s', async (folder, target) => {
    const mod = await import(`./${folder}/page`)
    expect(() => mod.default()).toThrow(`REDIRECT:${target}`)
    expect(redirect).toHaveBeenCalledWith(target)
  })
})
