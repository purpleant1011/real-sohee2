import { redirect } from 'next/navigation'

/**
 * 레거시 고아 경로 `/app/account/automation` 을 정식 자동화 설정 경로(`/app/settings/automation`)로 리다이렉트한다.
 */
export default async function AutomationPage() {
  redirect('/app/settings/automation')
}
