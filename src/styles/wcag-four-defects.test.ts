import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// CSS 모듈은 jsdom 에서 계산값을 얻을 수 없어 규칙 텍스트로 계약을 고정한다(globals.test.ts 와 같은 방식).
const marketingCss = readFileSync(
  resolve(process.cwd(), 'src/features/marketing/v085-marketing.module.css'),
  'utf8',
)
const loginCss = readFileSync(resolve(process.cwd(), 'src/app/(auth)/login/login.module.css'), 'utf8')

describe('WCAG 1.4.3 공개 상세 페이지 색 대비', () => {
  it('.detailPage 도 --v-* 토큰을 상속받아 var(--v-ink) 가 유효하다', () => {
    // 토큰은 .page 에만 있었고 .detailPage 는 var(--v-ink) 를 썼지만 해석되지 않아
    // 다크에서 상속된 밝은 글자가 #fbfaf7 배경 위에 얹혔다(1.07:1).
    expect(marketingCss).toMatch(/\.page,\s*\.detailPage\s*\{[^}]*--v-ink:\s*#27222d/)
    expect(marketingCss).toMatch(/\.detailPage\s*\{[^}]*background:\s*#fbfaf7[^}]*color:\s*var\(--v-ink\)/)
    // 페이지 배경/overflow 는 .page 에만 남긴다(상세 페이지 배경은 그대로 라이트 고정).
    expect(marketingCss).toMatch(/\.page\s*\{[^}]*background:\s*#fbfaf7[^}]*overflow:\s*hidden/)
  })
})

describe('WCAG 1.4.3 로그인 브랜드 배지 다크 대비', () => {
  it('다크에서만 배지 글자를 어두운 잉크로 바꾼다', () => {
    expect(loginCss).toMatch(
      /:global\(:root\[data-theme='dark'\]\)\s*\.authBrand\s*>\s*span\s*\{[^}]*color:\s*#17121a/,
    )
    // 라이트(기본)는 #6941c6 위 흰 글자를 유지한다.
    expect(loginCss).toMatch(/\.authBrand\s*>\s*span\s*\{[^}]*color:\s*#ffffff/)
  })
})
