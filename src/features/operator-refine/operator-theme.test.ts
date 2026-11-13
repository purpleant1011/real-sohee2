import { describe, expect, it } from 'vitest'
import { operatorProLayoutToken, operatorTheme } from './operator-theme'

describe('operatorTheme', () => {
  it('uses the approved Sohee operator palette instead of Ant Design blue defaults', () => {
    expect(operatorTheme.token?.colorPrimary).toBe('#6f3fd4')
    expect(operatorTheme.token?.colorSuccess).toBe('#2f9e7a')
    expect(operatorTheme.token?.colorBgLayout).toBe('#fbfafb')
    expect(operatorTheme.token?.borderRadius).toBe(8)
  })

  it('locks the ProLayout sidebar to the approved dark purple shell', () => {
    expect(operatorProLayoutToken.sider?.colorMenuBackground).toBe('#24162d')
    expect(operatorProLayoutToken.sider?.colorTextMenu).toBe('#eadff0')
    expect(operatorProLayoutToken.sider?.colorTextMenuSelected).toBe('#ffffff')
  })
})
