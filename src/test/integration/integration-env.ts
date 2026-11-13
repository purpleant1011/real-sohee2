import dns from 'node:dns'

// Resilient DNS fallback for supabase.co on macOS environments
const originalLookup = dns.lookup
;(dns as any).lookup = function (hostname: string, options: any, callback: any) {
  if (typeof options === 'function') {
    callback = options
    options = {}
  }
  if (hostname.includes('supabase.co')) {
    return dns.resolve4(hostname, (err, addresses) => {
      if (err || !addresses || addresses.length === 0) {
        return originalLookup(hostname, options, callback)
      }
      if (options && options.all) {
        return callback(null, addresses.map(a => ({ address: a, family: 4 })))
      }
      return callback(null, addresses[0], 4)
    })
  }
  return originalLookup(hostname, options, callback)
}

const SOHEE_PROJECT_URL = 'https://your-project-ref.supabase.co' as const

type EnvironmentInput = Readonly<Record<string, string | undefined>>

export interface IntegrationEnv {
  projectUrl: typeof SOHEE_PROJECT_URL
  publishableKey: string
  adminSecretKey: string
}

function requireSecretValue(input: EnvironmentInput, key: string): string {
  const value = input[key]?.trim()

  if (!value) {
    throw new Error('integration_env_missing')
  }

  return value
}

export function parseIntegrationEnv(input: EnvironmentInput): IntegrationEnv {
  const projectUrl = requireSecretValue(input, 'NEXT_PUBLIC_SUPABASE_URL')
  const publishableKey = requireSecretValue(input, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
  const adminSecretKey = requireSecretValue(input, 'SOHEE_INTEGRATION_ADMIN_SECRET_KEY')

  if (projectUrl !== SOHEE_PROJECT_URL) {
    throw new Error('integration_project_mismatch')
  }

  return {
    projectUrl,
    publishableKey,
    adminSecretKey,
  }
}

export function readIntegrationEnv(): IntegrationEnv {
  return parseIntegrationEnv(process.env)
}
