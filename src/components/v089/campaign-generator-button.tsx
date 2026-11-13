"use client";

import { useState } from "react";
import { Sparkles, Loader2, CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";

export function CampaignGeneratorButton({ workspaceId }: { workspaceId?: string }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  async function handleGenerate() {
    if (!workspaceId) {
      alert("워크스페이스 정보를 확인할 수 없습니다.");
      return;
    }
    try {
      setLoading(true);
      setMessage(null);
      const res = await fetch(`/api/workspaces/${workspaceId}/campaigns/auto-generate`, {
        method: "POST"
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || "캠페인 생성에 실패했습니다.");
        return;
      }
      setMessage("7일 캠페인이 생성되었습니다!");
      router.refresh();
    } catch (err: any) {
      alert(err.message || "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {message && (
        <span className="text-xs text-state-ok font-bold flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5" /> {message}
        </span>
      )}
      <button
        type="button"
        disabled={loading}
        onClick={handleGenerate}
        className="px-4 py-2 rounded-xl bg-gradient-to-r from-state-wait to-primary hover:from-state-wait hover:to-primary text-primary-foreground font-bold text-xs shadow-md transition flex items-center gap-2 disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>소희가 7일 플랜 생성 중...</span>
          </>
        ) : (
          <>
            <Sparkles className="w-3.5 h-3.5 text-state-warn" />
            <span>원클릭 7일 캠페인 자동 생성</span>
          </>
        )}
      </button>
    </div>
  );
}
