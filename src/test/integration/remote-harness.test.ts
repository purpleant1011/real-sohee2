import { describe, expect, it } from 'vitest'

import { createRunIdentity, redactRunIdentity } from './remote-harness'

describe('createRunIdentity', () => {
  it('keeps both remote actors distinct within one integration run', () => {
    const identity = createRunIdentity('run-123', {
      passwordA: 'A-remote-password-123!',
      passwordB: 'B-remote-password-123!',
    })

    expect(identity.emailA).not.toBe(identity.emailB)
    expect(identity.passwordA).not.toBe(identity.passwordB)
    expect(identity.workspaceNameA).not.toBe(identity.workspaceNameB)
    expect(identity.emailA).toContain('run-123')
    expect(identity.emailB).toContain('run-123')
  })

  it('omits both passwords from the diagnostic representation', () => {
    const identity = createRunIdentity('run-456', {
      passwordA: 'A-private-password-456!',
      passwordB: 'B-private-password-456!',
    })

    const diagnostic = JSON.stringify(redactRunIdentity(identity))

    expect(diagnostic).not.toContain(identity.passwordA)
    expect(diagnostic).not.toContain(identity.passwordB)
    expect(diagnostic).toContain(identity.emailA)
    expect(diagnostic).toContain(identity.workspaceNameB)
  })
})
