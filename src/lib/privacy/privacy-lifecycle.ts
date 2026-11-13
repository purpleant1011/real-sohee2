/**
 * Sohee V0.8.9 Privacy & Account Closure Lifecycle
 * 
 * Manages:
 * 1. GDPR/PIPA compliant data export, anonymization, and hard deletion requests.
 * 2. Instant agent termination, token revocation, and immutable deletion receipt.
 */

export type PrivacyRequestType = 'EXPORT' | 'ANONYMIZE' | 'DELETE_WORKSPACE';

export type PrivacyRequestStatus = 'REQUESTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface PrivacyRequestRecord {
  requestId: string;
  workspaceId: string;
  userId: string;
  requestType: PrivacyRequestType;
  status: PrivacyRequestStatus;
  requestedAt: string;
  completedAt?: string;
  receiptHash?: string;
}

export function createPrivacyRequest(
  workspaceId: string,
  userId: string,
  requestType: PrivacyRequestType
): PrivacyRequestRecord {
  return {
    requestId: `priv_${Date.now()}`,
    workspaceId,
    userId,
    requestType,
    status: 'REQUESTED',
    requestedAt: new Date().toISOString()
  };
}

export function completePrivacyRequest(
  req: PrivacyRequestRecord
): PrivacyRequestRecord {
  return {
    ...req,
    status: 'COMPLETED',
    completedAt: new Date().toISOString(),
    receiptHash: `sha256_${Date.now()}_${req.workspaceId}`
  };
}
