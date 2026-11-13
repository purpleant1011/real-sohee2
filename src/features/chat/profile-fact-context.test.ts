import { describe, expect, it } from 'vitest'
import { selectApprovedProfileFacts } from './profile-fact-context'
describe('approved profile fact context',()=>{it('includes only active approved facts and source IDs',()=>expect(selectApprovedProfileFacts([{id:'a',text:'승인 사실',status:'approved',sourceId:'s1'},{id:'p',text:'대기',status:'pending',sourceId:'s2'},{id:'r',text:'거절',status:'rejected',sourceId:'s3'},{id:'x',text:'오래됨',status:'approved',sourceId:'s4',stale:true}])).toEqual([{id:'a',text:'승인 사실',sourceId:'s1'}]))})
