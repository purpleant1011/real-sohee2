import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getOperatorCompatibilityRedirect } from './compatibility-redirect'

export default async function OperatorCompatibilityLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  void children
  const requestHeaders = await headers()
  redirect(getOperatorCompatibilityRedirect(requestHeaders.get('x-sohee-pathname') ?? '/operator'))
}
