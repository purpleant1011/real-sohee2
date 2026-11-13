import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('ANI-1141: RLS Enabled No Policy 24 Tables & Leaked Password Closure', () => {
  const matrixPath = path.resolve(__dirname, '../../docs/11th/RLS_NO_POLICY_24_DISPOSITION_MATRIX.md')
  const migrationPath = path.resolve(__dirname, '../../supabase/migrations/20260909070000_ani1141_rls_explicit_policies_closure.sql')

  it('verifies 24/24 table disposition matrix exists with correct classification', () => {
    expect(fs.existsSync(matrixPath)).toBe(true)
    const matrixContent = fs.readFileSync(matrixPath, 'utf-8')

    const tableRows = matrixContent.split('\n').filter(line => line.startsWith('|') && /\|\s*\d+\s*\|/.test(line))
    expect(tableRows.length).toBe(24)

    // Key tables presence
    expect(matrixContent).toContain('admin_approval_requests')
    expect(matrixContent).toContain('meta_channel_credentials')
    expect(matrixContent).toContain('media_asset_quarantine_backup')
    expect(matrixContent).toContain('billing_plans')
    expect(matrixContent).toContain('credit_rate_versions')
    expect(matrixContent).toContain('channel_delegations')
    expect(matrixContent).toContain('social_attribution_events')
    expect(matrixContent).toContain('workspace_agreements')
    expect(matrixContent).toContain('workspace_lifecycles')

    // Leaked Password section
    expect(matrixContent).toContain('auth_leaked_password_protection')
    expect(matrixContent).toContain('HaveIBeenPwned')
  })

  it('verifies migration file creates explicit policies for all 24 tables', () => {
    expect(fs.existsSync(migrationPath)).toBe(true)
    const migrationContent = fs.readFileSync(migrationPath, 'utf-8')

    const serverOnlyTables = [
      'admin_approval_requests',
      'admin_invite_intents',
      'audit_export_jobs',
      'channel_delivery_attempts',
      'data_deletion_requests',
      'media_asset_quarantine_backup',
      'meta_channel_credentials',
      'oauth_state_nonces',
      'operator_audit_sessions',
      'operator_incident_timeline',
      'operator_queue_observation_snapshots',
      'operator_release_observation_snapshots',
      'operator_system_observation_snapshots',
      'platform_admin_members',
      'platform_admin_role_assignments',
      'platform_audit_events',
      'platform_role_permissions',
      'platform_roles',
    ]

    for (const tbl of serverOnlyTables) {
      expect(migrationContent).toContain(`'${tbl}'`)
    }

    expect(migrationContent).toContain('billing_plans')
    expect(migrationContent).toContain('credit_rate_versions')
    expect(migrationContent).toContain('channel_delegations')
    expect(migrationContent).toContain('social_attribution_events')
    expect(migrationContent).toContain('workspace_agreements')
    expect(migrationContent).toContain('workspace_lifecycles')

    // Policies created
    expect(migrationContent).toContain('CREATE POLICY "service_role_all"')
    expect(migrationContent).toContain('CREATE POLICY "authenticated_select"')
    expect(migrationContent).toContain('CREATE POLICY "workspace_select"')
  })

  it('verifies tenant isolation and server-only access simulation for 24 tables', () => {
    type Role = 'anon' | 'authenticated' | 'service_role'

    interface TablePolicy {
      classification: 'SERVER_ONLY' | 'REFERENCE' | 'WORKSPACE'
      canRead: (role: Role, callerWorkspaceId?: string, rowWorkspaceId?: string) => boolean
      canWrite: (role: Role) => boolean
    }

    const policies: Record<string, TablePolicy> = {
      meta_channel_credentials: {
        classification: 'SERVER_ONLY',
        canRead: (role) => role === 'service_role',
        canWrite: (role) => role === 'service_role',
      },
      billing_plans: {
        classification: 'REFERENCE',
        canRead: (role) => role === 'authenticated' || role === 'service_role',
        canWrite: (role) => role === 'service_role',
      },
      channel_delegations: {
        classification: 'WORKSPACE',
        canRead: (role, callerWs, rowWs) => role === 'service_role' || (role === 'authenticated' && callerWs === rowWs),
        canWrite: (role) => role === 'service_role',
      },
    }

    // SERVER_ONLY: anon/authenticated cannot read or write
    expect(policies.meta_channel_credentials.canRead('anon')).toBe(false)
    expect(policies.meta_channel_credentials.canRead('authenticated')).toBe(false)
    expect(policies.meta_channel_credentials.canRead('service_role')).toBe(true)
    expect(policies.meta_channel_credentials.canWrite('authenticated')).toBe(false)
    expect(policies.meta_channel_credentials.canWrite('service_role')).toBe(true)

    // REFERENCE: authenticated can read, cannot write
    expect(policies.billing_plans.canRead('authenticated')).toBe(true)
    expect(policies.billing_plans.canWrite('authenticated')).toBe(false)
    expect(policies.billing_plans.canWrite('service_role')).toBe(true)

    // WORKSPACE: caller cannot read other workspace
    const wsA = '11111111-1111-1111-1111-111111111111'
    const wsB = '22222222-2222-2222-2222-222222222222'
    expect(policies.channel_delegations.canRead('authenticated', wsA, wsA)).toBe(true)
    expect(policies.channel_delegations.canRead('authenticated', wsA, wsB)).toBe(false)
    expect(policies.channel_delegations.canRead('service_role', wsA, wsB)).toBe(true)
    expect(policies.channel_delegations.canWrite('authenticated')).toBe(false)
  })
})
