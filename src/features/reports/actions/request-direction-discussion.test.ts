import { describe, expect, it, vi } from 'vitest'
import { requestDirectionDiscussionAction } from './request-direction-discussion'
const id='10000000-0000-4000-8000-000000000001'
describe('direction discussion action',()=>{it('strictly rejects extra input',async()=>{const repo={request:vi.fn()}; const result=await requestDirectionDiscussionAction({workspaceId:id,reportId:id,direction:'다음 편',extra:true},repo); expect(result).toEqual({data:{status:'invalid_input'}}); expect(repo.request).not.toHaveBeenCalled()})})
