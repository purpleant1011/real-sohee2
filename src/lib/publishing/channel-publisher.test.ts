import { describe, it, expect } from 'vitest'
import { ChannelPublisher } from './channel-publisher'
import { CreditEconomyEngine } from '@/features/marketing-agent/engine/credit-economy'

describe('Channel Publisher & RAW Verification Engine (ANI-320)', () => {
  it('1. Dispatches content across 4 channels and returns verified HTTP 200 URLs', async () => {
    const res = await ChannelPublisher.publish({
      channel: 'INSTAGRAM',
      content: '바이름 청라점 봄맞이 1:1 맞춤 자연눈썹 시안 룩북'
    })

    expect(res.channel).toBe('INSTAGRAM')
    expect(res.httpStatus).toBe(200)
    expect(res.verified).toBe(true)
    expect(res.publishedUrl).toContain('instagram.com/p/')
  })

  it('2. Atomically reserves and settles credit only after all 4 channels pass RAW verification', async () => {
    const initialAccount = CreditEconomyEngine.createAccount('ws-test', 'PLAN_150K')
    expect(initialAccount.balanceSC).toBe(30000)

    const payloads = [
      { channel: 'INSTAGRAM' as const, content: '피드 포스팅' },
      { channel: 'THREADS' as const, content: '스레드 타래' },
      { channel: 'NAVER_BLOG' as const, content: '네이버 블로그 칼럼' },
      { channel: 'DAANGN' as const, content: '당근 동네소식' }
    ]

    const { results, account, settledSC } = await ChannelPublisher.publishMultiChannelAndSettle(
      initialAccount,
      payloads,
      420
    )

    expect(results.length).toBe(4)
    expect(settledSC).toBe(420)
    expect(account.balanceSC).toBe(30000 - 420)
    expect(account.reservedSC).toBe(0)
  })
})
