'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { scheduleSchema } from '../schedule-schema'

const uuidSchema=z.string().uuid(); type Scheduled=Readonly<{scheduleId:string;publishAt:string}>
const fail=(message:string):ActionResult<Scheduled>=>({error:{message,requestId:'content-schedule'}})
const changeSchema=z.object({workspaceId:uuidSchema,scheduleId:uuidSchema,expectedUpdatedAt:z.string().datetime({offset:true}),scheduledLocal:z.string(),timezone:z.string()}).strict()
const cancelSchema=z.object({workspaceId:uuidSchema,scheduleId:uuidSchema,expectedUpdatedAt:z.string().datetime({offset:true})}).strict()

function scheduleMutationMessage(error:unknown,fallback:string){
 const message=String((error as {message?:unknown}|null)?.message)
 if(message.includes('schedule_changed'))return'다른 곳에서 일정이 변경됐어요. 최신 시간을 확인해 주세요.'
 if(message.includes('schedule_customer_conflict'))return'고객 예약과 가까운 시간이에요. 다른 시간을 선택해 주세요.'
 if(message.includes('schedule_channel_conflict'))return'같은 채널의 다른 게시 일정과 가까워요. 다른 시간을 선택해 주세요.'
 if(message.includes('schedule_minimum_lead_time'))return'게시 준비 시간을 위해 한 시간 이후로 선택해 주세요.'
 if(message.includes('schedule_channel_disconnected'))return'게시 채널 연결을 다시 확인해 주세요.'
 return fallback
}

function localToUtc(value:string, timezone:string):string|null {
 const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(value); if(!match)return null
 const wanted=match.slice(1,7).map(Number); const target=Date.UTC(wanted[0],wanted[1]-1,wanted[2],wanted[3],wanted[4],wanted[5]); let instant=target
 const formatter=new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})
 for(let attempt=0;attempt<4;attempt+=1){const parts=formatter.formatToParts(new Date(instant));const read=(type:Intl.DateTimeFormatPartTypes)=>Number(parts.find((part)=>part.type===type)?.value);const represented=Date.UTC(read('year'),read('month')-1,read('day'),read('hour'),read('minute'),read('second'));instant=target-(represented-instant)}
 const parts=formatter.formatToParts(new Date(instant));const final=[Number(parts.find(p=>p.type==='year')?.value),Number(parts.find(p=>p.type==='month')?.value),Number(parts.find(p=>p.type==='day')?.value),Number(parts.find(p=>p.type==='hour')?.value),Number(parts.find(p=>p.type==='minute')?.value),Number(parts.find(p=>p.type==='second')?.value)]
 return final.every((part,index)=>part===wanted[index])?new Date(instant).toISOString():null
}

export async function scheduleContentAction(input:unknown):Promise<ActionResult<Scheduled>>{
 const normalized=typeof input==='object'&&input!==null&&'scheduledLocal' in input&&typeof input.scheduledLocal==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.scheduledLocal)?{...input,scheduledLocal:`${input.scheduledLocal}:00`}:input
 const parsed=scheduleSchema.safeParse(normalized); if(!parsed.success)return fail('예약 날짜와 시간대를 확인해 주세요.')
 const publishAt=localToUtc(parsed.data.scheduledLocal,parsed.data.timezone); if(!publishAt)return fail('예약 시각을 시간대로 변환하지 못했습니다.')
 try{const supabase=await createServerSupabaseClient();const{data:userData,error:userError}=await supabase.auth.getUser();const userId=userData?.user?.id;if(userError||typeof userId!=='string')return fail('로그인 후 다시 시도해 주세요.')
 const{data:membership,error:membershipError}=await supabase.from('workspace_members').select('role, status').eq('workspace_id',parsed.data.workspaceId).eq('user_id',userId).maybeSingle();if(membershipError||membership?.status!=='active'||(membership.role!=='owner'&&membership.role!=='manager'))return fail('일정 예약은 작업공간 소유자와 관리자만 할 수 있습니다.')
 const{data,error}=await supabase.rpc('schedule_approved_content',{p_workspace_id:parsed.data.workspaceId,p_approval_id:parsed.data.approvalId,p_publish_at:publishAt,p_timezone:parsed.data.timezone,p_channel_connection_id:parsed.data.channelConnectionId});const id=uuidSchema.safeParse(data);if(error||!id.success)return fail(scheduleMutationMessage(error,'일정을 저장하지 못했습니다. 확인 상태와 예약 시각을 다시 살펴봐 주세요.'))
 revalidatePath('/app/schedule');revalidatePath('/app/work');return{data:{scheduleId:id.data,publishAt}}
 }catch{return fail('일정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')}
}

async function getAuthorizedClient(workspaceId:string){
 const supabase=await createServerSupabaseClient();const{data:userData,error:userError}=await supabase.auth.getUser();const userId=userData?.user?.id
 if(userError||typeof userId!=='string')return null
 const{data:membership,error}=await supabase.from('workspace_members').select('role, status').eq('workspace_id',workspaceId).eq('user_id',userId).maybeSingle()
 if(error||membership?.status!=='active'||(membership.role!=='owner'&&membership.role!=='manager'))return null
 return supabase
}

export async function rescheduleContentAction(input:unknown):Promise<ActionResult<Scheduled>>{
 const source=typeof input==='object'&&input!==null&&'scheduledLocal' in input&&typeof input.scheduledLocal==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.scheduledLocal)?{...input,scheduledLocal:`${input.scheduledLocal}:00`}:input
 const parsed=changeSchema.safeParse(source);if(!parsed.success)return fail('변경할 예약 날짜와 시간대를 확인해 주세요.')
 const scheduleInput=scheduleSchema.safeParse({...parsed.data,approvalId:'00000000-0000-4000-8000-000000000000',versionId:'00000000-0000-4000-8000-000000000000',channelConnectionId:'00000000-0000-4000-8000-000000000000'})
 if(!scheduleInput.success)return fail('변경할 예약 날짜와 시간대를 확인해 주세요.')
 const publishAt=localToUtc(parsed.data.scheduledLocal,parsed.data.timezone);if(!publishAt)return fail('예약 시각을 시간대로 변환하지 못했습니다.')
 try{const supabase=await getAuthorizedClient(parsed.data.workspaceId);if(!supabase)return fail('일정 변경은 작업공간 소유자와 관리자만 할 수 있습니다.')
 const{data,error}=await supabase.rpc('reschedule_content_guarded',{p_workspace_id:parsed.data.workspaceId,p_schedule_id:parsed.data.scheduleId,p_expected_updated_at:parsed.data.expectedUpdatedAt,p_publish_at:publishAt,p_timezone:parsed.data.timezone});const id=uuidSchema.safeParse(data);if(error||!id.success)return fail(scheduleMutationMessage(error,'일정을 변경하지 못했습니다. 예약 상태와 시각을 다시 확인해 주세요.'))
 revalidatePath('/app/schedule');return{data:{scheduleId:id.data,publishAt}}
 }catch{return fail('일정을 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.')}
}

export async function cancelScheduleAction(input:unknown):Promise<ActionResult<Readonly<{scheduleId:string}>>>{
 const parsed=cancelSchema.safeParse(input);if(!parsed.success)return{error:{message:'취소할 일정을 확인해 주세요.',requestId:'content-schedule'}}
 try{const supabase=await getAuthorizedClient(parsed.data.workspaceId);if(!supabase)return{error:{message:'일정 취소는 작업공간 소유자와 관리자만 할 수 있습니다.',requestId:'content-schedule'}}
 const{data,error}=await supabase.rpc('cancel_schedule_guarded',{p_workspace_id:parsed.data.workspaceId,p_schedule_id:parsed.data.scheduleId,p_expected_updated_at:parsed.data.expectedUpdatedAt});const id=uuidSchema.safeParse(data);if(error||!id.success)return{error:{message:scheduleMutationMessage(error,'일정을 취소하지 못했습니다. 현재 상태를 다시 확인해 주세요.'),requestId:'content-schedule'}}
 revalidatePath('/app/schedule');revalidatePath('/app/work');return{data:{scheduleId:id.data}}
 }catch{return{error:{message:'일정을 취소하지 못했습니다. 잠시 후 다시 시도해 주세요.',requestId:'content-schedule'}}}
}
