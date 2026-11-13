import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ getUser:vi.fn(), maybeSingle:vi.fn(), rpc:vi.fn(), revalidatePath:vi.fn() }))
vi.mock('@/lib/supabase/server',()=>({createServerSupabaseClient:vi.fn(async()=>({auth:{getUser:mocks.getUser},from:vi.fn(()=>{const q={select:vi.fn(()=>q),eq:vi.fn(()=>q),maybeSingle:mocks.maybeSingle};return q}),rpc:mocks.rpc}))}))
vi.mock('next/cache',()=>({revalidatePath:mocks.revalidatePath}))
import { cancelScheduleAction, rescheduleContentAction, scheduleContentAction } from './schedule-content'

const input={workspaceId:'20000000-0000-4000-8000-000000000001',approvalId:'30000000-0000-4000-8000-000000000001',versionId:'40000000-0000-4000-8000-000000000001',channelConnectionId:'50000000-0000-4000-8000-000000000001',scheduledLocal:'2026-08-10T18:00:00',timezone:'Asia/Seoul'}
describe('scheduleContentAction',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.getUser.mockResolvedValue({data:{user:{id:'u'}},error:null});mocks.maybeSingle.mockResolvedValue({data:{role:'manager',status:'active'},error:null});mocks.rpc.mockResolvedValue({data:'60000000-0000-4000-8000-000000000001',error:null})})
 it('converts the explicit IANA local time to UTC and calls the approved-content RPC',async()=>{
  await expect(scheduleContentAction(input)).resolves.toEqual({data:{scheduleId:'60000000-0000-4000-8000-000000000001',publishAt:'2026-08-10T09:00:00.000Z'}})
  expect(mocks.rpc).toHaveBeenCalledWith('schedule_approved_content',expect.objectContaining({p_publish_at:'2026-08-10T09:00:00.000Z',p_timezone:'Asia/Seoul'}))
 })
 it('blocks reviewers before the scheduling RPC',async()=>{mocks.maybeSingle.mockResolvedValue({data:{role:'reviewer',status:'active'},error:null});await expect(scheduleContentAction(input)).resolves.toMatchObject({error:{requestId:'content-schedule'}});expect(mocks.rpc).not.toHaveBeenCalled()})
 it('translates schedule conflicts into a user decision',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{message:'schedule_customer_conflict'}})
  await expect(scheduleContentAction(input)).resolves.toMatchObject({error:{message:'고객 예약과 가까운 시간이에요. 다른 시간을 선택해 주세요.'}})
 })
 it('changes an existing schedule through the controlled RPC',async()=>{
  await expect(rescheduleContentAction({workspaceId:input.workspaceId,scheduleId:'60000000-0000-4000-8000-000000000001',expectedUpdatedAt:'2026-08-10T08:00:00.000Z',scheduledLocal:'2026-08-11T19:30',timezone:'Asia/Seoul'})).resolves.toEqual({data:{scheduleId:'60000000-0000-4000-8000-000000000001',publishAt:'2026-08-11T10:30:00.000Z'}})
  expect(mocks.rpc).toHaveBeenCalledWith('reschedule_content_guarded',{p_workspace_id:input.workspaceId,p_schedule_id:'60000000-0000-4000-8000-000000000001',p_expected_updated_at:'2026-08-10T08:00:00.000Z',p_publish_at:'2026-08-11T10:30:00.000Z',p_timezone:'Asia/Seoul'})
 })
 it('returns a stable message when another device changed the schedule',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{message:'schedule_changed'}})
  await expect(rescheduleContentAction({workspaceId:input.workspaceId,scheduleId:'60000000-0000-4000-8000-000000000001',expectedUpdatedAt:'2026-08-10T08:00:00.000Z',scheduledLocal:'2026-08-11T19:30',timezone:'Asia/Seoul'})).resolves.toMatchObject({error:{message:'다른 곳에서 일정이 변경됐어요. 최신 시간을 확인해 주세요.'}})
 })
 it('cancels a pending schedule through the controlled RPC',async()=>{
  await expect(cancelScheduleAction({workspaceId:input.workspaceId,scheduleId:'60000000-0000-4000-8000-000000000001',expectedUpdatedAt:'2026-08-10T08:00:00.000Z'})).resolves.toEqual({data:{scheduleId:'60000000-0000-4000-8000-000000000001'}})
  expect(mocks.rpc).toHaveBeenCalledWith('cancel_schedule_guarded',{p_workspace_id:input.workspaceId,p_schedule_id:'60000000-0000-4000-8000-000000000001',p_expected_updated_at:'2026-08-10T08:00:00.000Z'})
 })
})
