import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReplyDraftEditor } from './reply-draft-editor'
import type { ConversationDetailDto } from './detail-model'
const ws='11111111-1111-4111-8111-111111111111', key='dm:22222222-2222-4222-8222-222222222222'
const base: ConversationDetailDto={ thread:{id:key,workspaceId:ws,channel:'instagram_dm',customerName:'local',consent:'granted',status:'draft_ready',unread:true,lastMessage:{text:'문의',receivedAt:'2026-10-25T10:00:00Z',fromCustomer:true},draft:{text:'기존',sources:['원문']},sendBlockers:[]},messages:[],targetLabel:'local',fingerprint:'a'.repeat(64),version:1,delivery:'none',complete:true }
afterEach(()=>vi.unstubAllGlobals())
describe('Track 2 reply raw snapshot readback',()=>{
 it.each(['valid','wrong-workspace','missing-fingerprint'])('%s readback에서 원문·가게·지문 일치 전에는 검토를 열지 않는다',async mode=>{
  const raw='  새 답안\n그대로  ', fp=mode==='missing-fingerprint'?null:'b'.repeat(64)
  const fetcher=vi.fn(async (_url,init)=>Response.json(init?.method==='PATCH'?{saved:true,fingerprint:fp}:{...base,fingerprint:fp,thread:{...base.thread,workspaceId:mode==='wrong-workspace'?'foreign':ws,draft:{text:raw,sources:['원문']}}}))
  vi.stubGlobal('fetch',fetcher);const saved=vi.fn();render(<ReplyDraftEditor workspaceId={ws} detail={base} onDirty={vi.fn()} onSaved={saved}/> )
  fireEvent.change(screen.getByLabelText('답안 내용'),{target:{value:raw}});fireEvent.click(screen.getByRole('button',{name:'답안 저장'}))
  if(mode==='valid')await waitFor(()=>expect(saved).toHaveBeenCalledTimes(1));else {await screen.findByRole('alert');expect(saved).not.toHaveBeenCalled()}
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({draftText:raw,expectedFingerprint:base.fingerprint,expectedUpdatedAt:null})
 })
})
