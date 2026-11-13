import React from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChannelControlCenter } from './channel-control-center'

describe('ChannelControlCenter — 연결 상태를 게시 검증으로 승격하지 않는다', () => {
  it('CONNECTED 만으로 "실게시 검증 완료"를 주장하지 않는다', () => {
    const { container } = render(
      <ChannelControlCenter
        initialConnections={{
          INSTAGRAM: { status: 'CONNECTED', accountLabel: '@test_store' },
        }}
      />,
    )
    const text = container.textContent ?? ''

    expect(text).not.toMatch(/실게시 검증 완료/)
    expect(text).toMatch(/연결됨 · 게시 검증 전/)
  })

  it('연결 개수를 "인증 성공"으로 단정하지 않고 "모두 해금"을 약속하지 않는다', () => {
    const { container } = render(
      <ChannelControlCenter
        initialConnections={{
          INSTAGRAM: { status: 'CONNECTED', accountLabel: '@test_store' },
        }}
      />,
    )
    const text = container.textContent ?? ''

    expect(text).not.toMatch(/연동 완료 \(인증 성공\)/)
    expect(text).not.toMatch(/잠긴 메뉴들을 모두 해금/)
    expect(text).toMatch(/게시 검증은 아직/)
  })
})

describe('ChannelControlCenter — 미검증 영수증을 발행 완료로 표시하지 않는다', () => {
  it('VERIFIED 가 아닌 영수증은 "발행 완료 (확인됨)" 으로 표시하지 않는다', async () => {
    const { container } = render(
      <ChannelControlCenter
        initialConnections={{ INSTAGRAM: { status: 'CONNECTED', accountLabel: '@test_store' } }}
      />,
    )
    const text = container.textContent ?? ''

    // 연결만 된 상태에서는 발행 완료 문구가 어디에도 없어야 한다.
    expect(text).not.toMatch(/실제 외부 게시물 발행 완료 \(확인됨\)/)
  })
})
