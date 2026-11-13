import { describe, expect, it, vi } from 'vitest'

import { SOHEE_EXTENSION_ID, sendPairCurrentBrowser, sendPrepareCurrentBrowser } from './external-extension-client'

const input = {
  pairingCode: 'c'.repeat(32),
  displayName: '업무용 Chrome',
  requestId: '10000000-0000-4000-8000-000000000001',
  targetExternalId: 'findk3',
  environment: 'test',
} as const

describe('Sohee web to extension client', () => {
  it('reports a missing extension when runtime messaging is unavailable', async () => {
    await expect(sendPairCurrentBrowser(input, {})).resolves.toEqual({ state: 'extension_missing' })
  })

  it('sends the opaque code only to the fixed Sohee extension', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, state: 'ready' })
    await expect(sendPairCurrentBrowser(input, { runtime: { sendMessage } })).resolves.toEqual({ state: 'ready' })
    expect(sendMessage).toHaveBeenCalledWith(SOHEE_EXTENSION_ID, {
      type: 'PAIR_CURRENT_BROWSER', pairingCode: input.pairingCode,
      displayName: input.displayName, requestedChannel: 'naver_blog', requestId: input.requestId,
      targetExternalId: 'findk3', environment: 'test',
    })
  })

  it('fails closed on an unexpected extension response', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, state: 'made_up_state', token: 'secret' })
    await expect(sendPairCurrentBrowser(input, { runtime: { sendMessage } })).resolves.toEqual({ state: 'failed' })
  })

  it('asks the installed extension to reuse its current device before creating another one', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, state: 'channel_confirmation_required' })
    await expect(sendPrepareCurrentBrowser({
      targetExternalId: 'findk3', environment: 'test', requestId: input.requestId,
    }, { runtime: { sendMessage } })).resolves.toEqual({ state: 'channel_confirmation_required' })
    expect(sendMessage).toHaveBeenCalledWith(SOHEE_EXTENSION_ID, {
      type: 'PREPARE_NAVER_CONNECTION', targetExternalId: 'findk3', environment: 'test', requestId: input.requestId,
    })
  })
})
