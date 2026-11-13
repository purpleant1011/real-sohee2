import { describe, expect, it } from 'vitest'
import { MagicStudioService } from './magic-studio-service'

describe('MagicStudioService', () => {
  it('generates a complete 4-channel marketing package from a single photo', () => {
    const res = MagicStudioService.generateFullPackage({
      photoName: 'customer_skin.jpg',
      treatmentNote: '속건조 케어',
    })

    expect(res.id).toContain('magic_studio_')
    expect(res.instagramCaption).toContain('속건조 케어')
    expect(res.threadsText).toContain('1인샵')
    expect(res.shortformScript.durationSec).toBe(15)
    expect(res.blogPost.title).toContain('청라 피부관리')
    expect(res.hashtags.length).toBeGreaterThan(0)
  })
})
