import type { Metadata } from 'next'
import Link from 'next/link'
import type { WorkspaceContext } from '@/features/auth/workspace-context'
import styles from '@/features/marketing/marketing.module.css'

export const metadata: Metadata = {
  title: '사용자 데이터 삭제 | 소희',
  description: '소희 사용자 데이터 삭제 요청 방법과 처리 상태 확인 방법을 안내합니다.',
}

export function DataDeletionGuide({ workspace }: Readonly<{ workspace: WorkspaceContext | null }>) {
  return (
    <article className={styles.legalPage}>
      <p className={styles.kicker}>개인정보 안내</p>
      <h1>사용자 데이터 삭제</h1>
      <p className={styles.legalLead}>
        소희 계정 또는 연결된 Meta 계정과 관련된 데이터 삭제를 요청하고, 발급된 확인 코드로 처리 상태를 확인할 수 있습니다.
      </p>
      <div className={styles.legalSections}>
        <section>
          <h2>삭제 요청 범위</h2>
          <p>활성 멤버는 현재 작업공간에 연결된 본인 계정 데이터를 요청할 수 있습니다. 작업공간 전체 데이터 삭제는 소유자만 요청할 수 있습니다.</p>
          <p>Instagram 또는 Threads가 보내는 서명된 삭제 요청은 별도 콜백 기능이 명시적으로 활성화된 경우에만 검증 후 접수됩니다. 접수만으로 자동으로 공식 채널 연결을 해제하거나 저장 자격 증명을 삭제하지 않습니다.</p>
        </section>
        <section>
          <h2>요청 방법</h2>
          <p>로그인한 뒤 아래 버튼으로 요청을 접수합니다. Meta 계정에서 시작된 요청은 별도 콜백이 활성화된 경우 검증 후 접수 상태로 기록되며, 운영 검토를 거쳐 처리됩니다.</p>
          {workspace ? (
            <div className={styles.deletionActions}>
              <form action={`/api/workspaces/${workspace.workspaceId}/data-deletion-requests`} method="post">
                <input name="scope" type="hidden" value="member" />
                <button className={styles.deletionButton} type="submit">내 데이터 삭제 요청</button>
              </form>
              {workspace.role === 'owner' ? (
                <form action={`/api/workspaces/${workspace.workspaceId}/data-deletion-requests`} method="post">
                  <input name="scope" type="hidden" value="workspace" />
                  <button className={styles.deletionDangerButton} type="submit">작업공간 전체 삭제 요청</button>
                </form>
              ) : (
                <p>작업공간 전체 삭제 요청은 소유자만 접수할 수 있습니다.</p>
              )}
            </div>
          ) : (
            <Link className={styles.deletionButton} href="/login?next=%2Fdata-deletion">
              로그인하고 삭제 요청하기
            </Link>
          )}
        </section>
        <section>
          <h2>처리 상태 확인</h2>
          <p>접수 후 이동하는 상태 페이지를 보관해 주세요. 상태는 접수, 처리 중, 완료 또는 반려로 표시되며 임의의 코드를 완료로 처리하지 않습니다.</p>
          <p>확인 코드는 평문으로 저장하지 않습니다. 서버에는 코드의 SHA-256 해시만 보관하고, 공개 상태 화면에는 사용자 ID나 작업공간 ID를 표시하지 않습니다.</p>
        </section>
        <section>
          <h2>보관 예외</h2>
          <p>법령, 분쟁 대응, 부정 이용 방지 또는 정산을 위해 반드시 필요한 최소 기록은 적용 근거와 보관 기간에 따라 분리 보관될 수 있습니다. 요청 기록 자체는 처리 증명을 위해 최소 항목만 남깁니다.</p>
        </section>
      </div>
    </article>
  )
}

export async function loadDataDeletionPage(
  loadWorkspace: () => Promise<WorkspaceContext | null>,
) {
  let workspace: WorkspaceContext | null = null
  try {
    workspace = await loadWorkspace()
  } catch {
    // The deletion instructions must remain public when optional account context is unavailable.
  }
  return <DataDeletionGuide workspace={workspace} />
}

export default async function DataDeletionPage() {
  const { getCurrentWorkspaceContext } = await import('@/features/auth/current-workspace')
  return loadDataDeletionPage(getCurrentWorkspaceContext)
}
