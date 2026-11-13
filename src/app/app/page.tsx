import { readAppWorkspace } from "@/features/auth/app-workspace.server";
import { TodayHome } from "@/components/home-today/today-home";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AppHomePage() {
  const { userId, workspace, error } = await readAppWorkspace();
  if (!userId || typeof userId !== "string") {
    // 로그인 후 원래 앱 화면으로 돌아올 수 있도록 복귀 경로를 붙인다.
    redirect(`/login?next=${encodeURIComponent("/app")}`);
  }

  if (error) {
    console.error("[AppHomePage] Workspace membership query failed:", error);
    return (
      <div data-testid="workspace-resolution-error" className="min-h-screen p-8 flex flex-col items-center justify-center text-center bg-background">
        <div className="max-w-md w-full p-6 rounded-lg border border-state-danger/30 bg-state-danger-soft">
          <h1 className="text-lg font-bold text-state-danger mb-2">가게 정보를 불러오지 못했어요</h1>
          <p className="text-sm text-state-danger">
            사장님의 가게 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.
          </p>
        </div>
      </div>
    );
  }

  // layout과 동일 요청의 멤버십·쿠키 재검증 결과를 사용한다.
  if (!workspace?.workspaceId) {
    // 워크스페이스가 없는 신규 계정은 온보딩으로 이동
    redirect("/start");
  }

  // Keep authenticated home HTML usable while installed-app client chunks are still loading.
  return <TodayHome workspaceId={workspace.workspaceId} />;
}


