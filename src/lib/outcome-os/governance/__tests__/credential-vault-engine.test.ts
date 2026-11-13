import { describe, it, expect } from 'vitest';
import { CredentialVaultEngine, type WorkspaceCredentialRecord, type ConsentEvidenceRecord } from '../credential-vault-engine';

describe('ANI-757 Credential Vault & Tenant Boundary Engine', () => {
  const vault = new CredentialVaultEngine();

  const validCred: WorkspaceCredentialRecord = {
    credentialId: 'cred_meta_001',
    workspaceId: 'ws_tenant_a',
    provider: 'meta',
    providerAccountId: 'act_meta_123',
    scopes: ['pages_manage_posts', 'instagram_basic', 'instagram_content_publish'],
    version: 1,
    encryptedToken: 'enc_sec_token_999',
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    isSandboxNamespace: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('allows access for valid workspace, non-expired, matching scopes', () => {
    const res = vault.validateCredentialAccess({
      actorWorkspaceId: 'ws_tenant_a',
      credential: validCred,
      isDemoActor: false,
      requiredScopes: ['instagram_basic'],
    });
    expect(res.allowed).toBe(true);
  });

  it('denies cross-tenant credential access with explicit error (IDOR protection)', () => {
    const res = vault.validateCredentialAccess({
      actorWorkspaceId: 'ws_tenant_b_attacker',
      credential: validCred,
      isDemoActor: false,
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('Cross-tenant credential access violation');
  });

  it('denies revoked credentials immediately', () => {
    const revoked = { ...validCred, revokedAt: new Date().toISOString() };
    const res = vault.validateCredentialAccess({
      actorWorkspaceId: 'ws_tenant_a',
      credential: revoked,
      isDemoActor: false,
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('revoked');
  });

  it('denies expired credentials', () => {
    const expired = { ...validCred, expiresAt: new Date(Date.now() - 3600000).toISOString() };
    const res = vault.validateCredentialAccess({
      actorWorkspaceId: 'ws_tenant_a',
      credential: expired,
      isDemoActor: false,
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('expired');
  });

  it('blocks SHOWCASE_DEMO actor from accessing production credentials (Sandbox barrier)', () => {
    const res = vault.validateCredentialAccess({
      actorWorkspaceId: 'ws_tenant_a',
      credential: validCred, // isSandboxNamespace: false
      isDemoActor: true,
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('SHOWCASE_DEMO actor is strictly restricted');
  });

  it('allows SHOWCASE_DEMO actor to access sandbox credentials', () => {
    const sandboxCred = { ...validCred, isSandboxNamespace: true };
    const res = vault.validateCredentialAccess({
      actorWorkspaceId: 'ws_tenant_a',
      credential: sandboxCred,
      isDemoActor: true,
    });
    expect(res.allowed).toBe(true);
  });

  it('denies access when required scope is missing and flags re-consent', () => {
    const res = vault.validateCredentialAccess({
      actorWorkspaceId: 'ws_tenant_a',
      credential: validCred,
      isDemoActor: false,
      requiredScopes: ['ads_management', 'instagram_basic'],
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('missing required scopes');
  });

  it('correctly calculates scope differences and triggers re-consent', () => {
    const diff = vault.calculateScopeDiff(
      ['instagram_basic', 'pages_read_engagement'],
      ['instagram_basic', 'pages_read_engagement', 'ads_management']
    );
    expect(diff.requiresReconsent).toBe(true);
    expect(diff.newScopes).toEqual(['ads_management']);

    const noDiff = vault.calculateScopeDiff(['instagram_basic'], ['instagram_basic']);
    expect(noDiff.requiresReconsent).toBe(false);
    expect(noDiff.newScopes).toEqual([]);
  });

  it('validates marketing message consent evidence', () => {
    const validConsent: ConsentEvidenceRecord = {
      consentId: 'csnt_001',
      workspaceId: 'ws_tenant_a',
      consentType: 'MARKETING_MESSAGE',
      grantedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 864000000).toISOString(),
      evidenceHash: 'sha256_hash_abcdef123456',
    };
    expect(vault.validateMessageConsent(validConsent).isValid).toBe(true);

    const revokedConsent = { ...validConsent, revokedAt: new Date().toISOString() };
    const resRevoked = vault.validateMessageConsent(revokedConsent);
    expect(resRevoked.isValid).toBe(false);
    expect(resRevoked.reason).toContain('revoked');

    const missingHash = { ...validConsent, evidenceHash: '' };
    expect(vault.validateMessageConsent(missingHash).isValid).toBe(false);
  });
});
