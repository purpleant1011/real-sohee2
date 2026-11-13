import { redirect } from 'next/navigation'

/**
 * 레거시/오타 경로 `/app/account/channels` 를 올바른 채널 관리 경로(`/app/channels`)로 리다이렉트한다.
 * (ANI-1707, `/app/settings/channels` 와 동일 정책)
 */
export default function AccountChannelsPage() {
  redirect('/app/channels')
}
