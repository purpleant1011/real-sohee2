import { describe, expect, it } from 'vitest'
import {
  isExtendedMetaScopeAllowed,
  canRequestExtendedMetaScope,
} from './extended-scope-gate'

describe('isExtendedMetaScopeAllowed gate matrix', () => {
  const allowlistedWorkspaceId = '00000000-0000-4000-8000-0000000000a2'
  const nonAllowlistedWorkspaceId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const envWithAllowlist = {
    META_EXTENDED_SCOPE_WORKSPACE_IDS: `00000000-0000-4000-8000-0000000000a1, ${allowlistedWorkspaceId}`,
  }

  it('1. no env: rejects even if allowlisted id, owner role, and extended=1 requested', () => {
    const result = isExtendedMetaScopeAllowed({
      workspaceId: allowlistedWorkspaceId,
      role: 'owner',
      env: {},
      extended: '1',
    })
    expect(result).toBe(false)
  })

  it('2. allowlisted + owner: allows when extended=1 is requested', () => {
    const result = isExtendedMetaScopeAllowed({
      workspaceId: allowlistedWorkspaceId,
      role: 'owner',
      env: envWithAllowlist,
      extended: '1',
    })
    expect(result).toBe(true)

    // boolean true variant
    expect(
      isExtendedMetaScopeAllowed({
        workspaceId: allowlistedWorkspaceId,
        role: 'owner',
        env: envWithAllowlist,
        extended: true,
      }),
    ).toBe(true)

    // manager role variant
    expect(
      isExtendedMetaScopeAllowed({
        workspaceId: allowlistedWorkspaceId,
        role: 'manager',
        env: envWithAllowlist,
        extended: true,
      }),
    ).toBe(true)
  })

  it('3. allowlisted + viewer: rejects even if workspace is in allowlist and extended=1 requested', () => {
    const result = isExtendedMetaScopeAllowed({
      workspaceId: allowlistedWorkspaceId,
      role: 'viewer',
      env: envWithAllowlist,
      extended: '1',
    })
    expect(result).toBe(false)
  })

  it('4. non-allowlisted: rejects even if owner role and extended=1 requested', () => {
    const result = isExtendedMetaScopeAllowed({
      workspaceId: nonAllowlistedWorkspaceId,
      role: 'owner',
      env: envWithAllowlist,
      extended: '1',
    })
    expect(result).toBe(false)
  })

  it('5. FOR_ALL: allows for all connects by default when META_EXTENDED_SCOPES_FOR_ALL=1', () => {
    const envForAll = {
      META_EXTENDED_SCOPES_FOR_ALL: '1',
    }
    // even without extended flag, non-allowlisted workspace, or viewer role
    expect(
      isExtendedMetaScopeAllowed({
        workspaceId: nonAllowlistedWorkspaceId,
        role: 'viewer',
        env: envForAll,
      }),
    ).toBe(true)
  })

  it('6. extended flag absent: rejects when allowlisted + owner but extended flag is absent', () => {
    const result = isExtendedMetaScopeAllowed({
      workspaceId: allowlistedWorkspaceId,
      role: 'owner',
      env: envWithAllowlist,
    })
    expect(result).toBe(false)

    // extended = false or '0'
    expect(
      isExtendedMetaScopeAllowed({
        workspaceId: allowlistedWorkspaceId,
        role: 'owner',
        env: envWithAllowlist,
        extended: false,
      }),
    ).toBe(false)
  })

  it('canRequestExtendedMetaScope helper returns whether caller is eligible for extended scope', () => {
    expect(
      canRequestExtendedMetaScope({
        workspaceId: allowlistedWorkspaceId,
        role: 'owner',
        env: envWithAllowlist,
      }),
    ).toBe(true)

    expect(
      canRequestExtendedMetaScope({
        workspaceId: allowlistedWorkspaceId,
        role: 'viewer',
        env: envWithAllowlist,
      }),
    ).toBe(false)

    expect(
      canRequestExtendedMetaScope({
        workspaceId: nonAllowlistedWorkspaceId,
        role: 'owner',
        env: envWithAllowlist,
      }),
    ).toBe(false)
  })
})
