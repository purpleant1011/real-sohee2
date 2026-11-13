import { Suspense } from 'react'
import { ApprovalsEntry } from './approvals-entry'

export default function ApprovalsPage() {
  return <Suspense fallback={<p role="status" className="p-6">확인할 작업을 불러오고 있어요.</p>}><ApprovalsEntry /></Suspense>
}
