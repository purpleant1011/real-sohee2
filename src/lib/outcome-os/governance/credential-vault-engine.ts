export type CredentialProviderType =
  | 'meta'
  | 'google'
  | 'kakao'
  | 'naver'
  | 'hubspot'
  | 'activepieces'
  | 'postiz'
  | 'chatwoot';

export interface WorkspaceCredentialRecord {
  credentialId: string;
  workspaceId: string;
  provider: CredentialProviderType;
  providerAccountId: string;
  scopes: string[];
  version: number;
  encryptedToken: string;
  expiresAt: string;
  revokedAt?: string;
  isSandboxNamespace: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ConsentType =
  | 'MARKETING_MESSAGE'
  | 'DATA_PROCESSING'
  | 'THIRD_PARTY_TRANSFER'
  | 'AUTOMATED_EXECUTION';

export interface ConsentEvidenceRecord {
  consentId: string;
  workspaceId: string;
  customerId?: string;
  consentType: ConsentType;
  grantedAt: string;
  expiresAt?: string;
  revokedAt?: string;
  ipAddress?: string;
  evidenceHash: string;
}

export class CredentialVaultEngine {
  /**
   * ANI-757 Tenant/RLS + Credential Boundary Validator
   * Enforces strict cross-tenant deny, expiry, revocation, and sandbox isolation.
   */
  validateCredentialAccess(params: {
    actorWorkspaceId: string;
    credential: WorkspaceCredentialRecord;
    isDemoActor: boolean;
    requiredScopes?: string[];
  }): { allowed: boolean; reason?: string } {
    const { actorWorkspaceId, credential, isDemoActor, requiredScopes = [] } = params;

    // 1. Cross-Tenant Barrier (Zero-Tolerance IDOR defense)
    if (actorWorkspaceId !== credential.workspaceId) {
      return {
        allowed: false,
        reason: `Cross-tenant credential access violation: actor [${actorWorkspaceId}] cannot access credential of workspace [${credential.workspaceId}].`,
      };
    }

    // 2. Revocation Check
    if (credential.revokedAt) {
      return {
        allowed: false,
        reason: `Credential [${credential.credentialId}] was revoked at ${credential.revokedAt}.`,
      };
    }

    // 3. Expiry Check
    if (new Date(credential.expiresAt).getTime() <= Date.now()) {
      return {
        allowed: false,
        reason: `Credential [${credential.credentialId}] expired at ${credential.expiresAt}.`,
      };
    }

    // 4. Sandbox / Demo Isolation Boundary
    if (isDemoActor && !credential.isSandboxNamespace) {
      return {
        allowed: false,
        reason: 'SHOWCASE_DEMO actor is strictly restricted to sandbox-namespace credentials only.',
      };
    }

    // 5. Scope Enclosure Check
    const missingScopes = requiredScopes.filter((sc) => !credential.scopes.includes(sc));
    if (missingScopes.length > 0) {
      return {
        allowed: false,
        reason: `Credential missing required scopes: [${missingScopes.join(', ')}]. Re-consent required.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Scope Difference & Re-consent State Machine (ANI-757 & ANI-793)
   * Detects permission widening to prevent silent permission creep.
   */
  calculateScopeDiff(
    currentScopes: string[],
    requestedScopes: string[]
  ): { newScopes: string[]; requiresReconsent: boolean } {
    const newScopes = requestedScopes.filter((sc) => !currentScopes.includes(sc));
    return {
      newScopes,
      requiresReconsent: newScopes.length > 0,
    };
  }

  /**
   * Message & Automation Consent Evidence Validator
   * Enforces legal opt-in, non-revocation, and non-expired consent.
   */
  validateMessageConsent(evidence: ConsentEvidenceRecord): {
    isValid: boolean;
    reason?: string;
  } {
    if (evidence.revokedAt) {
      return {
        isValid: false,
        reason: `Consent [${evidence.consentId}] was revoked on ${evidence.revokedAt}. Messaging denied.`,
      };
    }

    if (evidence.expiresAt && new Date(evidence.expiresAt).getTime() <= Date.now()) {
      return {
        isValid: false,
        reason: `Consent [${evidence.consentId}] has expired on ${evidence.expiresAt}.`,
      };
    }

    if (!evidence.evidenceHash || evidence.evidenceHash.length < 8) {
      return {
        isValid: false,
        reason: 'Consent record lacks immutable cryptographic evidence hash.',
      };
    }

    return { isValid: true };
  }
}
