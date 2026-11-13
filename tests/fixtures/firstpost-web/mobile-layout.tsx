import React from 'react'
import { MobileR2Provider } from '../../../src/features/mobile-shell/r2-gate'
import { MobileAppShell, ShellScreen } from '../../../src/features/mobile-shell'
import { MobileHomeView } from '../../../src/features/mobile-decision/mobile-home-view'
import { makeMobileHome } from '../../../src/features/mobile-decision/test-fixtures'
import { R2Inbox } from '../../../src/features/mobile-inbox/r2-inbox'
import { R2ConversationDetail } from '../../../src/features/mobile-inbox/r2-conversation-detail'
import { MobileLedgerView } from '../../../src/features/mobile-inbox/ledger-view'
const workspaceId='a7920000-0000-4000-8000-000000000001'
export function MobileLayoutHarness() {
  const path=location.pathname
  const home=makeMobileHome();home.workspaceId=workspaceId;home.businessName='격리 레이아웃 fixture'
  const now='2026-10-25T12:00:00Z'
  const content=path==='/app/inbox'?<R2Inbox workspaceId={workspaceId}/>:path.startsWith('/app/engagement/')?<R2ConversationDetail workspaceId={workspaceId} threadKey={decodeURIComponent(path.split('/').at(-1)!)}/>:path==='/app/schedule'?<MobileAppShell><ShellScreen mode="BROWSE" title="예약표"><MobileLedgerView snapshot={{loadState:'ready',workspaceId,timeZone:'Asia/Seoul',now,checkedAt:now,complete:true,entries:[{id:'geometry-only',workspaceId,customerName:'합성 고객 · 레이아웃 fixture',serviceLabel:'긴 서비스명과 예약 상태의 모바일 줄바꿈 확인',startsAt:'2026-10-25T13:00:00Z',endsAt:'2026-10-25T14:00:00Z',status:'confirmed',source:'owner_confirmed',ledgerVerifiedAt:now,otherSurfaceStatus:null}]}}/></ShellScreen></MobileAppShell>:<MobileAppShell><ShellScreen mode="BROWSE" title="오늘"><MobileHomeView view={home} onRefresh={()=>location.reload()} onDelegate={()=>location.assign('/app/work/new')}/></ShellScreen></MobileAppShell>
  return <MobileR2Provider enabled>{content}<aside style={{position:'fixed',top:0,right:0,zIndex:100,fontSize:10,background:'#fff',color:'#000',padding:'2px 6px'}}>로컬 격리/레이아웃 fixture · 운영 증거 아님</aside></MobileR2Provider>
}
