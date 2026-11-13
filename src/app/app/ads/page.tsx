import { resolveActiveWorkspaceSelection } from "@/features/auth/active-workspace";
import { readPreferredWorkspaceIdFromCookies } from "@/features/auth/active-workspace.server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AdsView } from "./ads-view";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdsPage() {
  const supabase = await createServerSupabaseClient();
  const { data: claimsData } = await supabase.auth.getClaims();

  const userId = claimsData?.claims?.sub;
  if (!userId || typeof userId !== "string") {
    redirect("/login");
  }

  const { data: memberships, error } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, status")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[AdsPage] Workspace query error:", error);
  }

  // ANI-1779: layout 과 같은 가게를 열도록 쿠키 선택을 따른다(서버·화면 same truth).
  const preferredWorkspaceId = await readPreferredWorkspaceIdFromCookies();
  const workspace = resolveActiveWorkspaceSelection(memberships, preferredWorkspaceId);
  if (!workspace?.workspaceId) {
    redirect("/app/onboarding");
  }

  return <AdsView workspaceId={workspace.workspaceId} />;
}
