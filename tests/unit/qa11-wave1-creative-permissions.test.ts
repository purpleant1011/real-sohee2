import { describe, it, expect } from 'vitest'
import {
  CREATIVE_CRITICAL_TABLES,
  validateTablePrivilegeMap,
  validateRlsPoliciesMap,
  assertBundleApprovalTransition,
  assertServerOnlyMutationBoundary,
  type TablePrivilegeEntry,
  type RlsPolicyEntry,
} from '../../qa/11th/audit/creative-table-permissions'

describe('ANI-1116: Creative Tables Server-Only Mutation & RLS/GRANT Least Privilege', () => {
  const targetTables = CREATIVE_CRITICAL_TABLES

  it('defines the 5 creative & receipt critical tables in scope', () => {
    expect(targetTables).toEqual([
      'creative_bundles',
      'creative_bundle_media',
      'publish_renditions',
      'provider_delivery_leases',
      'verified_proof_receipts',
    ])
  })

  describe('Privilege Evaluation (GRANT/REVOKE)', () => {
    it('rejects any privilege granted to anon for creative tables', () => {
      const insecureAnonPrivileges: TablePrivilegeEntry[] = [
        { tableName: 'creative_bundles', grantee: 'anon', privilegeType: 'SELECT' },
        { tableName: 'creative_bundles', grantee: 'anon', privilegeType: 'INSERT' },
      ]

      const result = validateTablePrivilegeMap(insecureAnonPrivileges)
      expect(result.isValid).toBe(false)
      expect(result.violations).toContain(
        'Table creative_bundles grants SELECT to anon, which violates server-only least privilege'
      )
      expect(result.violations).toContain(
        'Table creative_bundles grants INSERT to anon, which violates server-only least privilege'
      )
    })

    it('rejects INSERT/UPDATE/DELETE/TRUNCATE granted to authenticated role', () => {
      const broadAuthenticatedPrivileges: TablePrivilegeEntry[] = [
        { tableName: 'creative_bundles', grantee: 'authenticated', privilegeType: 'SELECT' },
        { tableName: 'creative_bundles', grantee: 'authenticated', privilegeType: 'INSERT' },
        { tableName: 'creative_bundles', grantee: 'authenticated', privilegeType: 'UPDATE' },
        { tableName: 'creative_bundles', grantee: 'authenticated', privilegeType: 'DELETE' },
      ]

      const result = validateTablePrivilegeMap(broadAuthenticatedPrivileges)
      expect(result.isValid).toBe(false)
      expect(result.violations).toContain(
        'Table creative_bundles grants INSERT to authenticated; only SELECT is permitted for clients'
      )
      expect(result.violations).toContain(
        'Table creative_bundles grants UPDATE to authenticated; only SELECT is permitted for clients'
      )
      expect(result.violations).toContain(
        'Table creative_bundles grants DELETE to authenticated; only SELECT is permitted for clients'
      )
    })

    it('accepts compliant configuration where anon has no privileges and authenticated has SELECT only', () => {
      const compliantPrivileges: TablePrivilegeEntry[] = targetTables.flatMap((table) => [
        { tableName: table, grantee: 'authenticated', privilegeType: 'SELECT' },
        { tableName: table, grantee: 'service_role', privilegeType: 'SELECT' },
        { tableName: table, grantee: 'service_role', privilegeType: 'INSERT' },
        { tableName: table, grantee: 'service_role', privilegeType: 'UPDATE' },
        { tableName: table, grantee: 'service_role', privilegeType: 'DELETE' },
      ])

      const result = validateTablePrivilegeMap(compliantPrivileges)
      expect(result.isValid).toBe(true)
      expect(result.violations).toHaveLength(0)
    })
  })

  describe('RLS Policy Evaluation', () => {
    it('rejects cmd=ALL policies on authenticated role', () => {
      const broadPolicies: RlsPolicyEntry[] = [
        {
          tableName: 'creative_bundles',
          policyName: 'workspaces_access_creative_bundles',
          roles: ['authenticated'],
          cmd: 'ALL',
          qual: 'workspace_id IN (...)',
        },
      ]

      const result = validateRlsPoliciesMap(broadPolicies)
      expect(result.isValid).toBe(false)
      expect(result.violations).toContain(
        'Policy workspaces_access_creative_bundles on creative_bundles grants ALL to authenticated; must be SELECT only'
      )
    })

    it('accepts workspace-scoped SELECT-only policies for authenticated', () => {
      const compliantPolicies: RlsPolicyEntry[] = [
        {
          tableName: 'creative_bundles',
          policyName: 'workspaces_select_creative_bundles',
          roles: ['authenticated'],
          cmd: 'SELECT',
          qual: 'workspace_id IN (SELECT workspace_members.workspace_id FROM workspace_members WHERE workspace_members.user_id = auth.uid())',
        },
        {
          tableName: 'creative_bundles',
          policyName: 'service_role_all_creative_bundles',
          roles: ['service_role'],
          cmd: 'ALL',
          qual: 'true',
          withCheck: 'true',
        },
      ]

      const result = validateRlsPoliciesMap(compliantPolicies)
      expect(result.isValid).toBe(true)
      expect(result.violations).toHaveLength(0)
    })
  })

  describe('Bundle Approval Transition Guard (Invariants)', () => {
    const validFingerprint = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

    it('permits valid approval transition when approved_fingerprint matches bundle_fingerprint and actor is present', () => {
      const result = assertBundleApprovalTransition({
        currentStatus: 'PENDING',
        nextStatus: 'APPROVED',
        bundleFingerprint: validFingerprint,
        approvedFingerprint: validFingerprint,
        approvedAt: new Date().toISOString(),
        approvedBy: '11111111-1111-1111-1111-111111111111',
      })

      expect(result.valid).toBe(true)
    })

    it('rejects approval transition when approved_fingerprint does not match bundle_fingerprint', () => {
      expect(() =>
        assertBundleApprovalTransition({
          currentStatus: 'PENDING',
          nextStatus: 'APPROVED',
          bundleFingerprint: validFingerprint,
          approvedFingerprint: 'wrong-fingerprint-hex',
          approvedAt: new Date().toISOString(),
          approvedBy: '11111111-1111-1111-1111-111111111111',
        })
      ).toThrow(/APPROVAL_FINGERPRINT_MISMATCH/)
    })

    it('rejects approval transition when approved_by actor is missing', () => {
      expect(() =>
        assertBundleApprovalTransition({
          currentStatus: 'PENDING',
          nextStatus: 'APPROVED',
          bundleFingerprint: validFingerprint,
          approvedFingerprint: validFingerprint,
          approvedAt: new Date().toISOString(),
          approvedBy: null,
        })
      ).toThrow(/APPROVAL_ACTOR_REQUIRED/)
    })

    it('rejects approval transition when approved_at timestamp is missing', () => {
      expect(() =>
        assertBundleApprovalTransition({
          currentStatus: 'PENDING',
          nextStatus: 'APPROVED',
          bundleFingerprint: validFingerprint,
          approvedFingerprint: validFingerprint,
          approvedAt: null,
          approvedBy: '11111111-1111-1111-1111-111111111111',
        })
      ).toThrow(/APPROVAL_TIMESTAMP_REQUIRED/)
    })
  })

  describe('Application-Level Mutation Boundary Guard', () => {
    it('blocks client direct browser mutation attempts', () => {
      expect(() =>
        assertServerOnlyMutationBoundary({
          callerRole: 'authenticated',
          action: 'INSERT',
          tableName: 'creative_bundles',
        })
      ).toThrow(/BROWSER_MUTATION_DENIED/)
    })

    it('allows server command / service_role mutation', () => {
      expect(() =>
        assertServerOnlyMutationBoundary({
          callerRole: 'service_role',
          action: 'INSERT',
          tableName: 'creative_bundles',
        })
      ).not.toThrow()
    })
  })
})
