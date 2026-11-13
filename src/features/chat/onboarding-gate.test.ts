import { describe, expect, it } from 'vitest'
import { gateChatEntry } from './onboarding-gate'
describe('onboarding chat gate',()=>{it('requires onboarding before general chat',()=>expect(gateChatEntry(false)).toEqual({status:'onboarding_required',href:'/start'}));it('allows completed workspaces',()=>expect(gateChatEntry(true)).toEqual({status:'ready'}))})
