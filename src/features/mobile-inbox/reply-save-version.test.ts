import { expect, it, vi } from 'vitest'
import { PATCH } from '@/app/api/workspaces/[workspaceId]/mobile-inbox/[threadKey]/draft/route'
import { computeMobileApprovalFingerprint } from '@/features/mobile-approvals/fingerprint'
const ws='11111111-1111-4111-8111-111111111111', id='22222222-2222-4222-8222-222222222222'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('@/features/quick-start/route-auth',()=>({authorizeQuickRequest:async()=>({workspaceId:ws,userId:'local',role:'owner',admin:{rpc},supabase:{from:()=>{const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{workspace_id:ws,draft_text:'reply',updated_at:'2026-10-25T10:00:00.001Z'},error:null})};return q}}}),isResponse:(v:unknown)=>v instanceof Response}))
it('지문이 같아도 관측한 draft timestamp가 달라졌으면 서버 CAS 전에 409다',async()=>{
 const fingerprint=computeMobileApprovalFingerprint({kind:'dm',workspaceId:ws,threadId:id,draftText:'reply'})
 const response=await PATCH(new Request('http://localhost',{method:'PATCH',body:JSON.stringify({draftText:'new reply',expectedFingerprint:fingerprint,expectedUpdatedAt:'2026-10-25T10:00:00.000Z'})}),{params:Promise.resolve({workspaceId:ws,threadKey:`dm:${id}`})})
 expect(response.status).toBe(409);expect(rpc).not.toHaveBeenCalled()
})
