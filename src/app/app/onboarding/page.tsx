import { redirect } from 'next/navigation'

/** Legacy entry point: all new-owner traffic now goes through the guided /start flow. */
export default async function OnboardingPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>
}) {
  const resolvedParams = props.searchParams ? await props.searchParams : undefined
  const params = new URLSearchParams()
  for (const [key, val] of Object.entries(resolvedParams ?? {})) {
    if (Array.isArray(val)) val.forEach((item) => params.append(key, item))
    else if (val !== undefined) params.append(key, val)
  }
  const query = params.toString()
  redirect(query ? `/start?${query}` : '/start')
}
