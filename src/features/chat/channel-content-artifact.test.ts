import { expect,it } from 'vitest'
import { channelContentArtifact, scheduleProjection } from './channel-content-artifact'
it('maps generated Threads content to a confirmation preview',()=>expect(channelContentArtifact({channel:'threads',segments:['본문'],mediaIds:[],question:'질문'})).toMatchObject({kind:'channel_preview',requiresConfirmation:true,statusLabel:'검토 준비됨'}))
it('maps Naver Blog to the connected review flow',()=>expect(channelContentArtifact({channel:'naver_blog',title:'제목',introduction:'소개',sections:[],keywords:[],imagePlacements:[],cta:'문의'})).toMatchObject({kind:'channel_preview',statusLabel:'검토 준비됨'}))
it('blocks schedule projection without exact approval identity',()=>expect(scheduleProjection({contentVersionId:null,approvalId:null,fingerprint:null})).toEqual({allowed:false,code:'APPROVAL_IDENTITY_REQUIRED'}))
