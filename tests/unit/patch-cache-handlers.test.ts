import { describe, expect, it } from 'vitest'
// @ts-expect-error mjs helper without types
import { patchLoadCustomCacheHandlers } from '../../scripts/lib/patch-cache-handlers.mjs'

describe('patchLoadCustomCacheHandlers', () => {
  it('loadCustomCacheHandlers 본문만 비우고 뒤따르는 메서드(getPublicDir 등)는 보존한다', () => {
    const src = 'class A{async loadCustomCacheHandlers(e){let t=await import(e);return t}getPublicDir(){return 1}async other(){return 2}}'
    const out = patchLoadCustomCacheHandlers(src)
    expect(out).toContain('async loadCustomCacheHandlers(){return;}')
    expect(out).toContain('getPublicDir(){return 1}')
    expect(out).toContain('async other(){return 2}')
    expect(out).not.toContain('import(e)')
  })
  it('이미 패치된 코드는 그대로 두고, 중첩 중괄호·문자열 속 중괄호가 있어도 균형을 맞춘다', () => {
    const patched = 'class A{async loadCustomCacheHandlers() { return; }\n getPublicDir(){return 1}}'
    expect(patchLoadCustomCacheHandlers(patched)).toBe(patched)
    const nested = 'class A{async loadCustomCacheHandlers(){if(x){a("}")}for(;;){}}getPublicDir(){}}'
    const out = patchLoadCustomCacheHandlers(nested)
    expect(out).toBe('class A{async loadCustomCacheHandlers(){return;}getPublicDir(){}}')
  })
})

describe('멱등성(재빌드 사고 방지)', () => {
  it('여러 번 적용해도 같은 결과이고 getPublicDir 가 남는다', () => {
    const src = 'class A{\n    async loadCustomCacheHandlers() {\n        const {x} = y;\n        await import(x);\n    }\n    getPublicDir() {\n        return 1;\n    }\n}'
    const once = patchLoadCustomCacheHandlers(src)
    const twice = patchLoadCustomCacheHandlers(once)
    expect(twice).toBe(once)
    expect(twice).toContain('getPublicDir() {')
  })
})
