import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { buildManualAssistPackage } from './manual-assist-package'
import { UnavailableSessionBroker } from './unavailable-session-broker'
import { executeApprovedAction } from './actions/execute-approved-action'
import type { ApprovedExternalAction } from './types'

const approvedDaangnAction: ApprovedExternalAction = {
  workspaceId: '10000000-0000-4000-8000-000000000001',
  channel: 'daangn_business',
  actionKind: 'news_post',
  target: { externalId: 'daangn-business-001', label: '소희 뷰티 성수점' },
  contentVersion: {
    id: '20000000-0000-4000-8000-000000000001',
    fingerprint: 'a'.repeat(64),
    text: '이번 주 신규 예약 혜택을 안내합니다.',
    media: [
      { id: '30000000-0000-4000-8000-000000000001', position: 0, signedUrl: 'https://storage.example.test/one.png' },
      { id: '30000000-0000-4000-8000-000000000002', position: 1, signedUrl: 'https://storage.example.test/two.png' },
    ],
  },
  approval: { id: '40000000-0000-4000-8000-000000000001', fingerprint: 'b'.repeat(64) },
}

describe('unavailable supervised session broker', () => {
  it('fails closed when no protected session runtime is configured', async () => {
    const broker = new UnavailableSessionBroker()

    await expect(broker.execute({ action: approvedDaangnAction, sessionReferenceId: '50000000-0000-4000-8000-000000000001' }))
      .resolves.toEqual({ ok: false, code: 'BROKER_UNAVAILABLE', status: 'manual_assist_required' })
  })

  it('packages exact approved text and ordered media for manual completion', () => {
    const pkg = buildManualAssistPackage(approvedDaangnAction)

    expect(pkg.contentVersionId).toBe(approvedDaangnAction.contentVersion.id)
    expect(pkg.targetLabel).toBe('소희 뷰티 성수점')
    expect(pkg.text).toBe(approvedDaangnAction.contentVersion.text)
    expect(pkg.media.map((item) => item.position)).toEqual([0, 1])
    expect(pkg.destinationUrl).toBe('https://business.daangn.com/')
    expect(pkg.resultRecordingPath).toContain(approvedDaangnAction.contentVersion.id)
  })

  it('releases the external action credit when the broker is unavailable', async () => {
    const release = vi.fn().mockResolvedValue(undefined)

    await expect(executeApprovedAction(approvedDaangnAction, {
      broker: new UnavailableSessionBroker(),
      sessionReferenceId: '50000000-0000-4000-8000-000000000001',
      credits: { releaseExternalActionCredit: release },
    })).resolves.toMatchObject({ ok: false, code: 'BROKER_UNAVAILABLE' })

    expect(release).toHaveBeenCalledWith({
      workspaceId: approvedDaangnAction.workspaceId,
      approvalFingerprint: approvedDaangnAction.approval.fingerprint,
      reason: 'BROKER_UNAVAILABLE',
    })
  })
})
