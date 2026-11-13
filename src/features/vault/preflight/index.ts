import { findItemsNeedingReapproval, verifyVaultFingerprint, type PolicyChange, type PolicyVersions, type VaultFingerprintVerification } from '../fingerprint/fingerprint'
import type { VaultReader, VaultServiceRoleWriter } from '../model/vault-repository'
import type { VaultItem, VaultJson, VaultPreflightOverall } from '../types'

export type PreflightStatus = 'PASS' | 'FAIL' | 'NOT_APPLICABLE' | 'UNKNOWN'
export type PreflightCode = 'FINGERPRINT' | 'CONTENT_EXPIRY' | 'HOLD_AGE' | 'IMAGE_RIGHTS' | 'IMAGE_QC' | 'POLICY' | 'CONNECTION' | 'ACCOUNT'
export interface PreflightCheck {
  code: PreflightCode
  status: PreflightStatus
  message: string
  action: string | null
}
export interface PreflightResult {
  overall: VaultPreflightOverall
  canRelease: boolean
  items: PreflightCheck[]
  blockedReasons: string[]
}
/** Evidence is read from authoritative sources by the caller, not inferred from a preview. */
type CurrentFingerprint = VaultFingerprintVerification extends infer T
  ? T extends VaultFingerprintVerification ? Omit<T, 'fingerprint'> : never
  : never
export interface PreflightSnapshot {
  fingerprint: CurrentFingerprint | null
  /** null is a confirmed absence of an expiry field; an invalid date is unknown. */
  validUntil: string | null
  imageRights: 'VALID' | 'EXPIRED' | 'UNKNOWN'
  imageQc: 'VALID' | 'EXPIRED' | 'UNKNOWN'
  /** null means the policy source was unavailable. [] means no policies changed. */
  policyChanges: readonly PolicyChange[] | null
  approvedPolicyVersions: PolicyVersions | null
  approvedAccountId: string | null
}
export interface PreflightConnectionHealth {
  connection: 'VERIFIED' | 'DISCONNECTED' | 'EXPIRED' | 'UNKNOWN'
  tokenExpiresAt: string | null
  providerReview: 'APPROVED' | 'PENDING' | 'REJECTED' | 'UNKNOWN'
  accountId: string | null
  accountLabel?: string | null
}
/** Narrow ports have no external-action or publishing write capability. */
export interface PreflightPorts {
  vault: Pick<VaultReader, 'getItem'> & Pick<VaultServiceRoleWriter, 'recordPreflightRun'>
  readSnapshot(workspaceId: string, item: VaultItem): Promise<PreflightSnapshot | null>
  readConnectionHealth(workspaceId: string, channel: VaultItem['channel']): Promise<PreflightConnectionHealth | null>
}

const verdict = (code: PreflightCode, status: PreflightStatus, message: string, action: string | null = null): PreflightCheck => ({ code, status, message, action })
const unknown = (code: PreflightCode, subject: string, action: string): PreflightCheck => verdict(code, 'UNKNOWN', `${subject} 확인 결과를 가져올 수 없어요`, action)
const isDate = (value: string): boolean => Number.isFinite(Date.parse(value))

/** Pure, deterministic verdicts; neither the gate nor the external world is mutated. */
export function evaluatePreflight(
  item: VaultItem, snapshot: PreflightSnapshot | null, health: PreflightConnectionHealth | null, now: Date,
  holdDays = 14,
): PreflightResult {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid evaluation time')
  if (!Number.isSafeInteger(holdDays) || holdDays < 0) throw new Error('Invalid hold period')
  const checks: PreflightCheck[] = []
  const fingerprint = snapshot?.fingerprint
  if (!fingerprint || !item.approvedFingerprint || !item.fingerprintSchemaVersion || fingerprint.fingerprintSchemaVersion !== item.fingerprintSchemaVersion) {
    checks.push(unknown('FINGERPRINT', '승인한 내용', '승인 기록과 현재 내용을 다시 확인해 주세요'))
  } else {
    try {
      const matchesIdentity = fingerprint.fingerprintSchemaVersion !== 3 || (
        fingerprint.fingerprintSchemaVersion === 3 &&
        fingerprint.payload.workspaceId === item.workspaceId && fingerprint.payload.contentId === item.contentId &&
        fingerprint.payload.versionId === item.versionId && fingerprint.payload.channel === item.channel
      )
      const valid = matchesIdentity && verifyVaultFingerprint({ ...fingerprint, fingerprint: item.approvedFingerprint } as VaultFingerprintVerification)
      checks.push(valid
        ? verdict('FINGERPRINT', 'PASS', '승인한 내용과 현재 내용이 같아요')
        : verdict('FINGERPRINT', 'FAIL', '승인 후 내용이 달라졌어요', '변경 내용을 다시 승인해 주세요'))
    } catch {
      checks.push(unknown('FINGERPRINT', '승인한 내용', '현재 내용을 다시 확인해 주세요'))
    }
  }

  if (!snapshot) checks.push(unknown('CONTENT_EXPIRY', '문구 유효기간', '문구를 다시 확인해 주세요'))
  else if (snapshot.validUntil === null) checks.push(verdict('CONTENT_EXPIRY', 'NOT_APPLICABLE', '이 문구에는 유효기간이 없어요'))
  else if (!isDate(snapshot.validUntil)) checks.push(unknown('CONTENT_EXPIRY', '문구 유효기간', '문구 유효기간을 확인해 주세요'))
  else if (Date.parse(snapshot.validUntil) <= now.getTime()) checks.push(verdict('CONTENT_EXPIRY', 'FAIL', '문구 유효기간이 지났어요', '문구와 유효기간을 수정하고 다시 승인해 주세요'))
  else checks.push(verdict('CONTENT_EXPIRY', 'PASS', '문구 유효기간이 남아 있어요'))

  if (!item.heldAt || !isDate(item.heldAt) || Date.parse(item.heldAt) > now.getTime()) checks.push(unknown('HOLD_AGE', '보관 기간', '보관 날짜를 확인해 주세요'))
  else if (now.getTime() - Date.parse(item.heldAt) > holdDays * 86_400_000) checks.push(verdict('HOLD_AGE', 'FAIL', '보관 기간이 길어 다시 확인해야 해요', '내용과 발행 대상을 다시 확인해 주세요'))
  else checks.push(verdict('HOLD_AGE', 'PASS', '보관 기간이 재확인 기준 이내예요'))

  for (const [code, state, subject] of [
    ['IMAGE_RIGHTS', snapshot?.imageRights, '이미지 사용 권리'],
    ['IMAGE_QC', snapshot?.imageQc, '이미지 품질 확인'],
  ] as const) {
    if (!state || state === 'UNKNOWN') checks.push(unknown(code, subject, `${subject} 상태를 다시 확인해 주세요`))
    else if (state === 'EXPIRED') checks.push(verdict(code, 'FAIL', `${subject}이 만료됐어요`, `${subject}을 갱신하거나 이미지를 교체해 주세요`))
    else checks.push(verdict(code, 'PASS', `${subject}이 유효해요`))
  }

  if (item.approvalState !== 'APPROVED' || item.releaseGate === null || item.releaseGate === 'RELEASE_REQUESTED' || item.deletedAt !== null) {
    checks.push(verdict('POLICY', 'FAIL', '현재 보관 항목은 발행 승인을 다시 확인해야 해요', '보관 상태와 승인을 확인해 주세요'))
  } else if (!snapshot?.policyChanges || !snapshot.approvedPolicyVersions) checks.push(unknown('POLICY', '승인 정책', '현재 정책과 승인 기록을 확인해 주세요'))
  else if (snapshot.policyChanges.some(change => findItemsNeedingReapproval([{
    id: item.id, channel: item.channel, approvalState: item.approvalState, policyVersions: snapshot.approvedPolicyVersions!,
  }], change).length > 0)) checks.push(verdict('POLICY', 'FAIL', '승인에 영향을 주는 정책이 변경됐어요', '새 정책에 맞게 다시 승인해 주세요'))
  else checks.push(verdict('POLICY', 'PASS', '승인에 영향을 주는 정책 변경이 없어요'))

  if (item.channel === 'naver_blog' || item.channel === 'daangn_business') {
    checks.push(verdict('CONNECTION', 'NOT_APPLICABLE', '이 채널의 연결 상태 검사는 아직 준비 중이에요', '지원되는 채널에서 발행해 주세요'))
  } else if (!health || health.connection === 'UNKNOWN' || health.providerReview === 'UNKNOWN' ||
    (health.connection === 'VERIFIED' && health.tokenExpiresAt !== null && !isDate(health.tokenExpiresAt))) {
    checks.push(unknown('CONNECTION', '채널 연결과 앱 심사', '채널 연결 상태를 다시 확인해 주세요'))
  } else if (health.connection !== 'VERIFIED' || health.providerReview !== 'APPROVED' ||
    (health.tokenExpiresAt !== null && Date.parse(health.tokenExpiresAt) <= now.getTime())) {
    checks.push(verdict('CONNECTION', 'FAIL', '채널 연결, 인증 또는 앱 심사 상태 때문에 발행할 수 없어요', '채널을 다시 연결하고 앱 심사 상태를 확인해 주세요'))
  } else checks.push(verdict('CONNECTION', 'PASS', '채널 연결과 앱 심사 상태가 유효해요'))

  if (!snapshot?.approvedAccountId || !health?.accountId) checks.push(unknown('ACCOUNT', '대상 계정', '승인 당시 계정과 현재 연결 계정을 확인해 주세요'))
  else if (snapshot.approvedAccountId !== health.accountId ||
    (fingerprint?.fingerprintSchemaVersion === 3 && fingerprint.fingerprintSchemaVersion === 3 && fingerprint.payload.targetAccountId !== snapshot.approvedAccountId)) {
    checks.push(verdict('ACCOUNT', 'FAIL', '승인한 계정과 현재 연결된 계정이 달라요', '올바른 계정을 연결하거나 다시 승인해 주세요'))
  } else checks.push(verdict('ACCOUNT', 'PASS', '승인한 계정과 연결된 계정이 같아요'))

  const overall: VaultPreflightOverall = checks.some(check => check.status === 'FAIL') ? 'FAIL' :
    checks.some(check => check.status === 'UNKNOWN' || (check.code === 'CONNECTION' && check.status === 'NOT_APPLICABLE')) ? 'UNKNOWN' : 'PASS'
  const canRelease = overall === 'PASS'
  return { overall, canRelease, items: checks, blockedReasons: checks.filter(check => check.status === 'FAIL' || check.status === 'UNKNOWN' || (check.code === 'CONNECTION' && check.status === 'NOT_APPLICABLE')).map(check => check.message) }
}

/** Only the preflight evidence insert is permitted; read errors become blocking unknown evidence. */
export async function runPreflight(
  ports: PreflightPorts, input: { workspaceId: string; itemId: string; triggeredBy: string | null; now: Date; holdDays?: number },
): Promise<PreflightResult> {
  const item = await ports.vault.getItem(input.workspaceId, input.itemId)
  if (!item || item.workspaceId !== input.workspaceId || item.id !== input.itemId) throw new Error('Vault item unavailable')
  const [snapshot, health] = await Promise.all([
    ports.readSnapshot(input.workspaceId, item).catch(() => null),
    ports.readConnectionHealth(input.workspaceId, item.channel).catch(() => null),
  ])
  const result = evaluatePreflight(item, snapshot, health, input.now, input.holdDays)
  await ports.vault.recordPreflightRun({
    workspaceId: input.workspaceId, vaultItemId: item.id, overall: result.overall,
    items: result.items as unknown as VaultJson[], triggeredBy: input.triggeredBy,
  })
  return result
}

export function summarizePreflights(results: readonly PreflightResult[]): { passed: number; needsReview: number; blockedReasons: string[] } {
  return {
    passed: results.filter(result => result.canRelease).length,
    needsReview: results.filter(result => !result.canRelease).length,
    blockedReasons: results.flatMap(result => result.blockedReasons),
  }
}
