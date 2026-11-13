import { describe, expect, it } from 'vitest'

import { parseIntegrationEnv } from './integration-env'

const validInput = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://your-project-ref.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SOHEE_INTEGRATION_ADMIN_SECRET_KEY: 'sb_secret_test',
}

describe('parseIntegrationEnv', () => {
  it('rejects a missing administrator secret without including environment values', () => {
    expect(() =>
      parseIntegrationEnv({
        ...validInput,
        SOHEE_INTEGRATION_ADMIN_SECRET_KEY: undefined,
      }),
    ).toThrow('integration_env_missing')
  })

  it('rejects a project URL outside the Sohee Supabase project', () => {
    expect(() =>
      parseIntegrationEnv({
        ...validInput,
        NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      }),
    ).toThrow('integration_project_mismatch')
  })

  it('returns only the named integration values for the Sohee project', () => {
    expect(parseIntegrationEnv(validInput)).toEqual({
      projectUrl: 'https://your-project-ref.supabase.co',
      publishableKey: 'sb_publishable_test',
      adminSecretKey: 'sb_secret_test',
    })
  })
})
