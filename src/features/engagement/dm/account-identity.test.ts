import { describe, expect, it, vi } from 'vitest'
import {
  resolveInstagramBusinessId,
  type ResolveBusinessIdDeps,
} from './account-identity'

describe('resolveInstagramBusinessId', () => {
  const baseInput = {
    workspaceId: 'ws-1',
    connectionId: 'conn-1',
    accessToken: 'test-token',
  }

  it('returns repaired:false and does not call update when storedExternalAccountId matches professionalId', async () => {
    const deps: ResolveBusinessIdDeps = {
      getProfileIds: vi.fn(async () => ({
        appScopedId: 'app-id-1',
        professionalId: 'prof-id-1',
        username: 'mybiz',
      })),
      updateExternalAccountId: vi.fn(async () => ({ ok: true })),
    }

    const result = await resolveInstagramBusinessId(
      { ...baseInput, storedExternalAccountId: 'prof-id-1' },
      deps,
    )

    expect(result).toEqual({
      status: 'ok',
      businessIgId: 'prof-id-1',
      repaired: false,
    })
    expect(deps.updateExternalAccountId).not.toHaveBeenCalled()
  })

  it('calls updateExternalAccountId and returns repaired:true when storedExternalAccountId is app-scoped id', async () => {
    const deps: ResolveBusinessIdDeps = {
      getProfileIds: vi.fn(async () => ({
        appScopedId: 'app-id-1',
        professionalId: 'prof-id-1',
        username: 'mybiz',
      })),
      updateExternalAccountId: vi.fn(async () => ({ ok: true })),
    }

    const result = await resolveInstagramBusinessId(
      { ...baseInput, storedExternalAccountId: 'app-id-1' },
      deps,
    )

    expect(result).toEqual({
      status: 'ok',
      businessIgId: 'prof-id-1',
      repaired: true,
    })
    expect(deps.updateExternalAccountId).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      connectionId: 'conn-1',
      externalAccountId: 'prof-id-1',
    })
  })

  it('calls updateExternalAccountId when storedExternalAccountId is null', async () => {
    const deps: ResolveBusinessIdDeps = {
      getProfileIds: vi.fn(async () => ({
        appScopedId: 'app-id-1',
        professionalId: 'prof-id-1',
        username: 'mybiz',
      })),
      updateExternalAccountId: vi.fn(async () => ({ ok: true })),
    }

    const result = await resolveInstagramBusinessId(
      { ...baseInput, storedExternalAccountId: null },
      deps,
    )

    expect(result).toEqual({
      status: 'ok',
      businessIgId: 'prof-id-1',
      repaired: true,
    })
    expect(deps.updateExternalAccountId).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      connectionId: 'conn-1',
      externalAccountId: 'prof-id-1',
    })
  })

  it('returns status:ok and repaired:false when updateExternalAccountId returns {ok:false} or throws', async () => {
    const depsFailed: ResolveBusinessIdDeps = {
      getProfileIds: vi.fn(async () => ({
        appScopedId: 'app-id-1',
        professionalId: 'prof-id-1',
        username: 'mybiz',
      })),
      updateExternalAccountId: vi.fn(async () => ({ ok: false })),
    }

    const resultFailed = await resolveInstagramBusinessId(
      { ...baseInput, storedExternalAccountId: null },
      depsFailed,
    )

    expect(resultFailed).toEqual({
      status: 'ok',
      businessIgId: 'prof-id-1',
      repaired: false,
    })

    const depsThrew: ResolveBusinessIdDeps = {
      getProfileIds: vi.fn(async () => ({
        appScopedId: 'app-id-1',
        professionalId: 'prof-id-1',
        username: 'mybiz',
      })),
      updateExternalAccountId: vi.fn(async () => {
        throw new Error('unique constraint violation')
      }),
    }

    const resultThrew = await resolveInstagramBusinessId(
      { ...baseInput, storedExternalAccountId: null },
      depsThrew,
    )

    expect(resultThrew).toEqual({
      status: 'ok',
      businessIgId: 'prof-id-1',
      repaired: false,
    })
  })

  it('returns unavailable with profile_lookup_failed when getProfileIds throws, and no_professional_id when professionalId is missing', async () => {
    const depsThrows: ResolveBusinessIdDeps = {
      getProfileIds: vi.fn(async () => {
        throw new Error('network error')
      }),
      updateExternalAccountId: vi.fn(async () => ({ ok: true })),
    }

    const resultError = await resolveInstagramBusinessId(
      { ...baseInput, storedExternalAccountId: null },
      depsThrows,
    )
    expect(resultError).toEqual({
      status: 'unavailable',
      reason: 'profile_lookup_failed',
    })

    const depsNoProf: ResolveBusinessIdDeps = {
      getProfileIds: vi.fn(async () => ({
        appScopedId: 'app-id-1',
        professionalId: null,
        username: 'mybiz',
      })),
      updateExternalAccountId: vi.fn(async () => ({ ok: true })),
    }

    const resultNoProf = await resolveInstagramBusinessId(
      { ...baseInput, storedExternalAccountId: null },
      depsNoProf,
    )
    expect(resultNoProf).toEqual({
      status: 'unavailable',
      reason: 'no_professional_id',
    })
  })
})
