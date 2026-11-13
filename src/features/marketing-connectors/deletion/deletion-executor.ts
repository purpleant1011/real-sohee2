import 'server-only';
import type { ConnectorId } from '../catalog';
import {
  loadConnectorCredential,
  deleteCredential,
  CredentialVaultError,
  type CredentialVaultGateway,
  type LoadedConnectorCredential,
} from '../credentials/credential-vault';
import {
  revokeConsentScope,
  type ConsentLedgerGateway,
} from '../consent/consent-ledger';
import type { DeletionJob } from './deletion-job-repository';

export interface DeletionExecutorGateway {
  readonly vaultGateway: CredentialVaultGateway;
  readonly consentGateway?: ConsentLedgerGateway;
  readonly revokeConsent?: (params: {
    workspaceId: string;
    connectorId: ConnectorId;
    consentGeneration: number;
    now: string;
  }) => Promise<void>;
  readonly revokeEvidence?: (params: {
    workspaceId: string;
    connectorId: ConnectorId;
    now: string;
  }) => Promise<void>;
  readonly updateConnectionStatus?: (params: {
    workspaceId: string;
    connectorId: ConnectorId;
    status: 'disconnected' | 'revoked';
    now: string;
  }) => Promise<void>;
  readonly revokeRemoteToken?: (params: {
    connectorId: ConnectorId;
    token: string;
  }) => Promise<{ ok: boolean; status?: number; error?: string }>;
  readonly fetch?: typeof fetch;
}

export interface ConnectorDeletionExecutionResult {
  readonly ok: boolean;
  readonly jobId: string;
  readonly workspaceId: string;
  readonly connectorId: ConnectorId;
  readonly consentGeneration: number;
  readonly remoteRevoked: boolean;
  readonly credentialDeleted: boolean;
  readonly consentRevoked: boolean;
  readonly evidenceRevoked: boolean;
  readonly connectionDisconnected: boolean;
  readonly completedAt: string;
}

export interface ExecuteConnectorDeletionOptions {
  readonly now?: string;
}

const GOOGLE_CONNECTOR_IDS: ReadonlySet<ConnectorId> = new Set([
  'google_calendar',
  'google_docs',
  'google_sheets',
  'gmail',
  'google_drive',
]);

function isGoogleConnector(connectorId: ConnectorId): boolean {
  return GOOGLE_CONNECTOR_IDS.has(connectorId);
}

/**
 * 연결 해제 및 토큰 폐기 원격 실행기 (F06)
 *
 * 1단계: F03 Vault에서 access/refresh 토큰 복호화 로드
 * 2단계: 공급자가 원격 revoke를 지원하는 경우 호출 (Google: POST https://oauth2.googleapis.com/revoke). 400은 무시하고 계속 진행.
 * 3단계: Vault 토큰 영구 삭제 (deleteCredential - 최신 세대 오삭제 방지)
 * 4단계: F04 동의 원장 status = 'revoked' 기록
 * 5단계: marketing_connector_evidence 원장 대상 revoked_at = now() 설정
 * 6단계: marketing_connector_connections 상태를 disconnected로 전이
 * 단계별 멱등성 및 원자적 완료 보장
 */
export async function executeConnectorDeletion(
  job: DeletionJob,
  gateway: DeletionExecutorGateway,
  options?: ExecuteConnectorDeletionOptions
): Promise<ConnectorDeletionExecutionResult> {
  const effectiveNowIso = options?.now ?? new Date().toISOString();

  let loadedCredential: LoadedConnectorCredential | null = null;
  let isVaultStale = false;

  // 1단계: Vault에서 access/refresh 토큰 복호화 로드
  try {
    loadedCredential = await loadConnectorCredential(
      job.workspaceId,
      job.connectorId,
      job.consentGeneration,
      gateway.vaultGateway
    );
  } catch (err: unknown) {
    if (err instanceof CredentialVaultError) {
      if (err.code === 'CREDENTIAL_NOT_FOUND') {
        // 이미 자격 증명이 삭제되었거나 존재하지 않음 (멱등적 계속 진행)
        loadedCredential = null;
      } else if (err.code === 'STALE_GENERATION') {
        // DB에 이미 더 최신 세대가 저장되어 있음 (재연결된 새 토큰 보호)
        isVaultStale = true;
        loadedCredential = null;
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  }

  // 2단계: 공급자가 원격 revoke를 지원하는 경우 호출
  let remoteRevoked = false;
  if (loadedCredential && !isVaultStale) {
    const tokenToRevoke =
      loadedCredential.refreshToken ?? loadedCredential.accessToken;

    if (gateway.revokeRemoteToken) {
      const res = await gateway.revokeRemoteToken({
        connectorId: job.connectorId,
        token: tokenToRevoke,
      });

      if (res.ok) {
        remoteRevoked = true;
      } else if (res.status === 400) {
        // 토큰이 이미 폐기되었거나 유효하지 않은 경우 무시하고 계속 진행
        remoteRevoked = false;
      } else {
        throw new Error(
          res.error ?? `Remote token revocation failed with status ${res.status}`
        );
      }
    } else if (isGoogleConnector(job.connectorId)) {
      const fetchImpl = gateway.fetch ?? fetch;
      const body = new URLSearchParams({ token: tokenToRevoke }).toString();

      const response = await fetchImpl('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });

      if (response.ok) {
        remoteRevoked = true;
      } else if (response.status === 400) {
        // 토큰이 이미 만료/폐기된 경우
        remoteRevoked = false;
      } else {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `Google token revocation failed with status ${response.status}: ${errorText}`
        );
      }
    }
  }

  // 3단계: Vault 토큰 영구 삭제
  let credentialDeleted = false;
  if (!isVaultStale) {
    try {
      await deleteCredential(
        job.workspaceId,
        job.connectorId,
        job.consentGeneration,
        gateway.vaultGateway
      );
      credentialDeleted = true;
    } catch (err: unknown) {
      if (
        err instanceof CredentialVaultError &&
        err.code === 'STALE_GENERATION'
      ) {
        // 최신 세대 토큰 보호
        credentialDeleted = false;
      } else {
        throw err;
      }
    }
  }

  // 4단계: F04 동의 원장 status = 'revoked' 기록
  let consentRevoked = false;
  if (gateway.revokeConsent) {
    await gateway.revokeConsent({
      workspaceId: job.workspaceId,
      connectorId: job.connectorId,
      consentGeneration: job.consentGeneration,
      now: effectiveNowIso,
    });
    consentRevoked = true;
  } else if (gateway.consentGateway) {
    await revokeConsentScope(
      job.workspaceId,
      job.connectorId,
      job.requestedBy ?? 'system',
      gateway.consentGateway,
      effectiveNowIso
    );
    consentRevoked = true;
  }

  // 5단계: marketing_connector_evidence 원장 대상 revoked_at = now() 설정
  let evidenceRevoked = false;
  if (gateway.revokeEvidence) {
    await gateway.revokeEvidence({
      workspaceId: job.workspaceId,
      connectorId: job.connectorId,
      now: effectiveNowIso,
    });
    evidenceRevoked = true;
  }

  // 6단계: marketing_connector_connections 상태를 disconnected로 전이
  let connectionDisconnected = false;
  if (gateway.updateConnectionStatus) {
    await gateway.updateConnectionStatus({
      workspaceId: job.workspaceId,
      connectorId: job.connectorId,
      status: 'disconnected',
      now: effectiveNowIso,
    });
    connectionDisconnected = true;
  }

  return Object.freeze({
    ok: true,
    jobId: job.id,
    workspaceId: job.workspaceId,
    connectorId: job.connectorId,
    consentGeneration: job.consentGeneration,
    remoteRevoked,
    credentialDeleted,
    consentRevoked,
    evidenceRevoked,
    connectionDisconnected,
    completedAt: effectiveNowIso,
  });
}
