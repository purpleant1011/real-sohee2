import { redirect } from 'next/navigation'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { NotificationCenterFailure } from '@/features/notifications/notification-center'
import { getNotificationCenter } from '@/features/notifications/repository'
import { readPushTokenLookup } from '@/features/pwa/server/read-push-token'
import { NotificationsEntry } from './notifications-entry'

export default async function NotificationsPage(){const workspace=await getCurrentWorkspaceContext();if(!workspace)redirect('/app/onboarding');const result=await getNotificationCenter(workspace.workspaceId);if(result.error)return <NotificationCenterFailure />;const pushTokenLookup=await readPushTokenLookup({userId:result.data.userId});return <NotificationsEntry data={result.data} workspaceId={workspace.workspaceId} pushTokenLookup={pushTokenLookup}/>}
