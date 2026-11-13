import { describe, expect, it } from 'vitest'
import { createSameTruthGateway } from './repository'

const a = '81111111-1111-4111-8111-111111111111'

describe('same-truth server read gateway', () => {
  it('selects only requested immutable workspace IDs', async () => {
    const calls: unknown[] = []
    const client = { from(table: string) {
      calls.push(table)
      return {
        select(fields: string, options?: unknown) {
          calls.push({ fields, options })
          return {
            in(column: string, ids: readonly string[]) {
              calls.push({ column, ids })
              if (table === 'workspace_registry') return Promise.resolve({ data: [{ workspace_id: a, dataset_mode: 'ACTUAL', actor_kind: 'CUSTOMER' }], error: null })
              return {
                not(column2: string, operator: string, value: unknown) {
                  calls.push({ column2, operator, value })
                  return { is(column3: string, missing: unknown) { calls.push({ column3, missing }); return Promise.resolve({ count: 3, error: null }) } }
                },
              }
            },
          }
        },
      }
    } }
    const gateway = createSameTruthGateway({ ...client, rpc: async () => ({ data: 0, error: null }) })
    expect(await gateway.readRegistry([a])).toMatchObject([{ workspace_id: a }])
    expect(calls).toContainEqual({ column: 'workspace_id', ids: [a] })
  })

  it('always rechecks ACTUAL mode within the vault count SQL read', async () => {
    const client = { from: () => { throw new Error('Do not count without registry join') }, rpc: async (name: string, args: unknown) => {
      expect(name).toBe('count_admin_actual_vault_items')
      expect(args).toEqual({ p_workspace_ids: [a] })
      return { data: 3, error: null }
    } }
    expect(await createSameTruthGateway(client).countVault([a])).toBe(3)
  })

  it('rejects malformed or missing database results without treating errors as zero', async () => {
    const client = {
      from: () => ({ select: () => ({ in: () => Promise.resolve({ data: null, error: { message: 'down' } }) }) }),
      rpc: async () => ({ data: null, error: { message: 'down' } }),
    }
    await expect(createSameTruthGateway(client).readRegistry([a])).rejects.toThrow()
    await expect(createSameTruthGateway(client).countVault([a])).rejects.toThrow()
  })
})
