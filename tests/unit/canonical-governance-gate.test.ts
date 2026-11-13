import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { validateGovernanceConsistency } from '@/features/governance/canonical-governance-checker'

describe('Canonical Governance Gate (ANI-1153 / ANI-1167)', () => {
  const workspaceRoot = path.resolve(__dirname, '../../')

  it('validates that workspace root satisfies current canonical override', () => {
    const result = validateGovernanceConsistency(workspaceRoot)
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
    expect(result.currentRevision).toBe('v13-commercial-employee-loop')
  })

  it('fails validation when manifest is missing', () => {
    const fakeDir = path.resolve(__dirname, '../../fake_dir_missing')
    const result = validateGovernanceConsistency(fakeDir)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing canonical-governance-manifest.json')
  })
})
