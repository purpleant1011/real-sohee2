import { describe, expect, it } from 'vitest'
import { normalizeBuildIdentity } from './build-identity'

describe('build identity', () => {
  it('shows only the first seven lowercase commit characters', () => {
    expect(normalizeBuildIdentity('22E99C780E683749E81E83DA677CA9307BCD59E4')).toBe('22e99c7')
  })

  it('uses development for an unavailable or unsafe value', () => {
    expect(normalizeBuildIdentity('')).toBe('development')
    expect(normalizeBuildIdentity('release<script>')).toBe('development')
  })
})
