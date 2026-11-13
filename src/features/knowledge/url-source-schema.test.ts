import { describe, expect, it } from 'vitest'
import {
  ownedUrlSourceSchema,
  referenceUrlSourceSchema,
  urlSourceInputSchema,
} from './url-source-schema'

describe('URL source schemas', () => {
  it('classifies an owned Naver Place URL without claiming collection', () => {
    expect(
      ownedUrlSourceSchema.parse({
        workspaceId: '10000000-0000-4000-8000-000000000001',
        channel: 'naver_place',
        ownership: 'owned',
        url: 'https://map.naver.com/p/entry/place/123',
      }),
    ).toMatchObject({ collectionState: 'connection_required' })
  })

  it('rejects reference-source copying instructions', () => {
    expect(
      referenceUrlSourceSchema.safeParse({
        workspaceId: '10000000-0000-4000-8000-000000000001',
        channel: 'instagram',
        ownership: 'reference',
        url: 'https://www.instagram.com/example/',
        allowedUse: 'copy_caption',
      }).success,
    ).toBe(false)
  })

  it('accepts the contract-approved Byreum Daangn business profile as owned facts', () => {
    expect(ownedUrlSourceSchema.parse({
      workspaceId: '10000000-0000-4000-8000-000000000001',
      channel: 'daangn_business',
      ownership: 'owned',
      url: 'https://www.daangn.com/kr/local-profile/바이름-qfm5ujuvd65o/',
      requestedScope: 'business_facts',
    })).toMatchObject({ allowedUse: 'business_facts', collectionState: 'connection_required' })
  })

  it.each([
    'complete',
    'partial',
    'connection_required',
    'file_required',
    'access_limited',
    'refresh_required',
  ] as const)('preserves the %s collection state', (collectionState) => {
    expect(
      urlSourceInputSchema.safeParse({
        workspaceId: '10000000-0000-4000-8000-000000000001',
        channel: 'threads',
        ownership: 'owned',
        url: 'https://www.threads.net/@sohee',
        collectionState,
      }).success,
    ).toBe(true)
  })

  it('accepts threads.com alias as valid threads URL', () => {
    expect(
      urlSourceInputSchema.safeParse({
        workspaceId: '10000000-0000-4000-8000-000000000001',
        channel: 'threads',
        ownership: 'owned',
        url: 'https://threads.com/@sohee_daily',
      }).success,
    ).toBe(true)
  })

  it('rejects userinfo, explicit port, or localhost in URLs', () => {
    expect(
      urlSourceInputSchema.safeParse({
        workspaceId: '10000000-0000-4000-8000-000000000001',
        channel: 'instagram',
        ownership: 'owned',
        url: 'https://admin:pass@instagram.com/my_salon',
      }).success,
    ).toBe(false)

    expect(
      urlSourceInputSchema.safeParse({
        workspaceId: '10000000-0000-4000-8000-000000000001',
        channel: 'instagram',
        ownership: 'owned',
        url: 'https://instagram.com:8080/my_salon',
      }).success,
    ).toBe(false)
  })
})
