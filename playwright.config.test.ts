import { describe, expect, it } from 'vitest'
import { resolveE2EPort } from './playwright.config'
describe('resolveE2EPort',()=>{it('accepts only safe positive ports and otherwise keeps 3100',()=>{expect(resolveE2EPort('3112')).toBe(3112);for(const value of ['0','-1','65536','abc','3.2'])expect(resolveE2EPort(value)).toBe(3100)})})
