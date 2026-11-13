import { redirect } from 'next/navigation'

export default async function OperatorWorkspaceCompatibilityPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  redirect(`/admin/workspaces/${encodeURIComponent(workspaceId)}`)
}
