import { describe, expect, it } from 'vitest'
import nextConfig from '../../next.config'

describe('private upload request limit', () => {
  it('allows the 10 MiB product boundary plus multipart overhead', () => {
    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe('12mb')
  })

  it('disables framework development logs that serialize server action arguments', () => {
    expect(nextConfig.logging).toBe(false)
  })
})
