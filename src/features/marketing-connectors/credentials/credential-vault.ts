import 'server-only';

import type { ConnectorId } from '../catalog';

export type CredentialVaultErrorCode =
  | 'INVALID_KEY'
  | 'MISSING_KEY'
  | 'DECRYPTION_FAILED'
  | 'UNSUPPORTED_ALGORITHM'
  | 'CREDENTIAL_NOT_FOUND'
  | 'STALE_GENERATION'
  | 'INVALID_TOKEN_PAYLOAD';

export class CredentialVaultError extends Error {
  readonly code: CredentialVaultErrorCode;

  constructor(code: CredentialVaultErrorCode, message: string) {
    super(message);
    this.name = 'CredentialVaultError';
    this.code = code;
    Object.setPrototypeOf(this, CredentialVaultError.prototype);
  }
}

export type EncryptedToken = Readonly<{
  ciphertext: string;
  iv: string;
  algorithm: 'AES-GCM-256';
}>;

export type StoredCredentialRecord = Readonly<{
  workspaceId: string;
  connectorId: ConnectorId;
  consentGeneration: number;
  encryptedAccessToken: EncryptedToken;
  encryptedRefreshToken: EncryptedToken | null;
  expiresAt: string | null;
  grantedScopes: readonly string[];
  createdAt: string;
  updatedAt: string;
}>;

export interface CredentialVaultGateway {
  getCredential(
    workspaceId: string,
    connectorId: ConnectorId
  ): Promise<StoredCredentialRecord | null>;

  saveCredential(record: StoredCredentialRecord): Promise<void>;

  updateCredentialTokens(params: {
    workspaceId: string;
    connectorId: ConnectorId;
    encryptedAccessToken: EncryptedToken;
    encryptedRefreshToken: EncryptedToken | null;
    expiresAt: string | null;
    updatedAt: string;
  }): Promise<void>;

  deleteCredential?(
    workspaceId: string,
    connectorId: ConnectorId
  ): Promise<void>;
}

export type SaveConnectorCredentialInput = Readonly<{
  workspaceId: string;
  connectorId: ConnectorId;
  consentGeneration: number;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: string | null;
  grantedScopes: readonly string[];
  keyBase64?: string;
}>;

export type SavedConnectorCredentialResult = Readonly<{
  workspaceId: string;
  connectorId: ConnectorId;
  consentGeneration: number;
  expiresAt: string | null;
  grantedScopes: readonly string[];
  savedAt: string;
}>;

export type LoadedConnectorCredential = Readonly<{
  workspaceId: string;
  connectorId: ConnectorId;
  consentGeneration: number;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  grantedScopes: readonly string[];
}>;

export type RotateConnectorTokenInput = Readonly<{
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: string | null;
}>;

export type VaultOptions = Readonly<{
  keyBase64?: string;
}>;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function decodeBase64Url(value: string): Uint8Array {
  try {
    const normalized = value.replace(/-/gu, '+').replace(/_/gu, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return new Uint8Array(0);
  }
}

function encodeBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '');
}

async function importAesKey(keyBase64: string): Promise<CryptoKey> {
  const bytes = decodeBase64Url(keyBase64);
  if (bytes.byteLength !== 32) {
    throw new CredentialVaultError(
      'INVALID_KEY',
      'Encryption key must be a 32-byte base64/base64url encoded string'
    );
  }
  return crypto.subtle.importKey(
    'raw',
    bytes.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

function resolveKey(explicitKey?: string): string {
  const key = explicitKey ?? process.env.MARKETING_CONNECTOR_TOKEN_KEY;
  if (!key || typeof key !== 'string' || !key.trim()) {
    throw new CredentialVaultError(
      'MISSING_KEY',
      'MARKETING_CONNECTOR_TOKEN_KEY is not configured and no explicit key was provided'
    );
  }
  return key.trim();
}

/**
 * Web Crypto API AES-GCM-256 기반 단일 토큰 암호화
 */
export async function encryptConnectorToken(
  plaintext: string,
  keyBase64: string
): Promise<EncryptedToken> {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new CredentialVaultError(
      'INVALID_TOKEN_PAYLOAD',
      'Token to encrypt must be a non-empty string'
    );
  }

  const cryptoKey = await importAesKey(keyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintextBytes = textEncoder.encode(plaintext);

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    cryptoKey,
    plaintextBytes
  );

  return Object.freeze({
    ciphertext: encodeBase64Url(ciphertextBuffer),
    iv: encodeBase64Url(iv),
    algorithm: 'AES-GCM-256' as const,
  });
}

/**
 * Web Crypto API AES-GCM-256 기반 단일 토큰 복호화
 * 평문 토큰을 콘솔이나 에러 메시지에 절대 노출하지 않음
 */
export async function decryptConnectorToken(
  encrypted: { ciphertext: string; iv: string; algorithm?: string },
  keyBase64: string
): Promise<string> {
  if (encrypted.algorithm && encrypted.algorithm !== 'AES-GCM-256') {
    throw new CredentialVaultError(
      'UNSUPPORTED_ALGORITHM',
      `Unsupported encryption algorithm: ${encrypted.algorithm}`
    );
  }

  const cryptoKey = await importAesKey(keyBase64);
  const ivBytes = decodeBase64Url(encrypted.iv);
  const ciphertextBytes = decodeBase64Url(encrypted.ciphertext);

  if (ivBytes.byteLength !== 12 || ciphertextBytes.byteLength === 0) {
    throw new CredentialVaultError(
      'DECRYPTION_FAILED',
      'Failed to decrypt credential token due to invalid payload or tampering'
    );
  }

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes.buffer as ArrayBuffer },
      cryptoKey,
      ciphertextBytes.buffer as ArrayBuffer
    );
    return textDecoder.decode(decryptedBuffer);
  } catch {
    throw new CredentialVaultError(
      'DECRYPTION_FAILED',
      'Failed to decrypt credential token due to invalid payload or tampering'
    );
  }
}

/**
 * 공급자 자격 증명 암호화 및 영속화
 * - 현재 저장된 세대보다 이전 세대 토큰 저장 시 STALE_GENERATION 에러 거부
 */
export async function saveConnectorCredential(
  input: SaveConnectorCredentialInput,
  gateway: CredentialVaultGateway,
  options?: VaultOptions
): Promise<SavedConnectorCredentialResult> {
  const key = resolveKey(input.keyBase64 ?? options?.keyBase64);

  const existing = await gateway.getCredential(
    input.workspaceId,
    input.connectorId
  );
  if (existing && existing.consentGeneration > input.consentGeneration) {
    throw new CredentialVaultError(
      'STALE_GENERATION',
      `Cannot overwrite consent generation ${existing.consentGeneration} with older generation ${input.consentGeneration}`
    );
  }

  const encryptedAccessToken = await encryptConnectorToken(
    input.accessToken,
    key
  );
  const encryptedRefreshToken = input.refreshToken
    ? await encryptConnectorToken(input.refreshToken, key)
    : null;

  const now = new Date().toISOString();
  const record: StoredCredentialRecord = {
    workspaceId: input.workspaceId,
    connectorId: input.connectorId,
    consentGeneration: input.consentGeneration,
    encryptedAccessToken,
    encryptedRefreshToken,
    expiresAt: input.expiresAt,
    grantedScopes: input.grantedScopes,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await gateway.saveCredential(record);

  return Object.freeze({
    workspaceId: record.workspaceId,
    connectorId: record.connectorId,
    consentGeneration: record.consentGeneration,
    expiresAt: record.expiresAt,
    grantedScopes: record.grantedScopes,
    savedAt: now,
  });
}

/**
 * 자격 증명 복호화 및 반환
 * - 유효한 세대 검증 (stale generation 요청 차단)
 * - 평문 토큰을 콘솔이나 에러 메시지에 절대 로깅하지 않음
 */
export async function loadConnectorCredential(
  workspaceId: string,
  connectorId: ConnectorId,
  generation: number,
  gateway: CredentialVaultGateway,
  options?: VaultOptions
): Promise<LoadedConnectorCredential> {
  const record = await gateway.getCredential(workspaceId, connectorId);
  if (!record) {
    throw new CredentialVaultError(
      'CREDENTIAL_NOT_FOUND',
      `Credential for ${connectorId} not found in workspace ${workspaceId}`
    );
  }

  if (record.consentGeneration !== generation) {
    throw new CredentialVaultError(
      'STALE_GENERATION',
      `Requested generation ${generation} does not match active generation ${record.consentGeneration}`
    );
  }

  const key = resolveKey(options?.keyBase64);

  const accessToken = await decryptConnectorToken(
    record.encryptedAccessToken,
    key
  );
  const refreshToken = record.encryptedRefreshToken
    ? await decryptConnectorToken(record.encryptedRefreshToken, key)
    : null;

  return Object.freeze({
    workspaceId: record.workspaceId,
    connectorId: record.connectorId,
    consentGeneration: record.consentGeneration,
    accessToken,
    refreshToken,
    expiresAt: record.expiresAt,
    grantedScopes: record.grantedScopes,
  });
}

/**
 * 토큰 리프레시 시 원자적 교체 및 만료시각 갱신
 */
export async function rotateConnectorToken(
  workspaceId: string,
  connectorId: ConnectorId,
  newTokens: RotateConnectorTokenInput,
  gateway: CredentialVaultGateway,
  options?: VaultOptions
): Promise<void> {
  const existing = await gateway.getCredential(workspaceId, connectorId);
  if (!existing) {
    throw new CredentialVaultError(
      'CREDENTIAL_NOT_FOUND',
      `Cannot rotate non-existent credential for ${connectorId} in workspace ${workspaceId}`
    );
  }

  const key = resolveKey(options?.keyBase64);

  const encryptedAccessToken = await encryptConnectorToken(
    newTokens.accessToken,
    key
  );

  let encryptedRefreshToken: EncryptedToken | null =
    existing.encryptedRefreshToken;

  if (newTokens.refreshToken !== undefined) {
    encryptedRefreshToken = newTokens.refreshToken
      ? await encryptConnectorToken(newTokens.refreshToken, key)
      : null;
  }

  const now = new Date().toISOString();

  await gateway.updateCredentialTokens({
    workspaceId,
    connectorId,
    encryptedAccessToken,
    encryptedRefreshToken,
    expiresAt: newTokens.expiresAt,
    updatedAt: now,
  });
}

/**
 * 특정 세대의 자격증명을 안전하게 영구 삭제
 * - 만약 DB의 현재 세대가 인자로 전달된 세대보다 높은 최신 세대이면 STALE_GENERATION 에러로 거부 (재연결된 새 토큰 오삭제 방지)
 * - 대상 자격증명이 이미 존재하지 않는 경우 멱등적으로 성공
 */
export async function deleteCredential(
  workspaceId: string,
  connectorId: ConnectorId,
  consentGeneration: number,
  gateway: CredentialVaultGateway
): Promise<void> {
  const existing = await gateway.getCredential(workspaceId, connectorId);
  if (!existing) {
    return;
  }

  if (existing.consentGeneration > consentGeneration) {
    throw new CredentialVaultError(
      'STALE_GENERATION',
      `Cannot delete newer consent generation ${existing.consentGeneration} with target generation ${consentGeneration}`
    );
  }

  if (gateway.deleteCredential) {
    await gateway.deleteCredential(workspaceId, connectorId);
  }
}

