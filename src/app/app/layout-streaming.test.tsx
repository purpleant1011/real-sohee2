import React, { Suspense, isValidElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn(() => new Promise(() => {})) }))
import ProtectedAppLayout from './layout'
import { createServerSupabaseClient } from '@/lib/supabase/server'

describe('인증 레이아웃 스트리밍 경계', () => {
  it('서버 조회 전에 공개 로딩 경계를 반환하고 보호된 본문은 그 안에 둔다', () => {
    const view = ProtectedAppLayout({ children: <p>보호된 본문</p> })
    expect(isValidElement(view)).toBe(true)
    if (!isValidElement<{ fallback: React.ReactNode; children: React.ReactElement }>(view)) return
    expect(view.type).toBe(Suspense)
    expect(view.props.fallback).toBeTruthy()
    expect(view.props.children.type).not.toBe('p')
    expect(createServerSupabaseClient).not.toHaveBeenCalled()
  })
})
