import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createProfileImageGateway, getProfileImageUrl } from '@/features/account/profile-image-repository'
import { PersonalSettings } from '@/features/mobile-settings/personal-settings'

export const dynamic = 'force-dynamic'

export default async function PersonalPrivacyPage() {
  const supabase = await createServerSupabaseClient()
  const { data: claimsData } = await supabase.auth.getClaims()
  const userId = typeof claimsData?.claims?.sub === 'string' ? claimsData.claims.sub : null

  if (!userId) {
    redirect('/login')
    return null
  }

  const [avatarUrl, profileResult] = await Promise.all([
    getProfileImageUrl(userId, createProfileImageGateway(supabase)),
    supabase.from('profiles').select('display_name').eq('id', userId).maybeSingle(),
  ])

  const displayName = profileResult.data?.display_name ?? null
  const profileLoadError = Boolean(profileResult.error)

  return (
    <PersonalSettings
      initialAvatarUrl={avatarUrl}
      initialDisplayName={displayName}
      profileLoadError={profileLoadError}
    />
  )
}
