"use client";

import React, { useSyncExternalStore } from "react";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/components/theme-provider";

const emptySubscribe = () => () => {};

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const isMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  if (!isMounted) {
    return (
      <div className={`w-8 h-8 rounded-xl bg-black/5 dark:bg-white/5 animate-pulse ${className}`} />
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={`relative flex items-center justify-center w-8 h-8 rounded-xl border transition-all select-none cursor-pointer focus:outline-hidden ${
        isDark
          ? "bg-[#1C1E22] border-[rgba(255,255,255,0.12)] text-[#FBBF24] hover:bg-[#282B30]"
          : "bg-[#FAF9F7] border-[#EAE7E3] text-[#4A4744] hover:bg-[#F3F1ED]"
      } ${className}`}
      title={isDark ? "라이트 모드로 전환" : "다크 모드로 전환"}
      aria-label="Toggle theme"
    >
      {isDark ? (
        <Sun className="w-4 h-4 transition-transform duration-300 hover:rotate-45" />
      ) : (
        <Moon className="w-4 h-4 transition-transform duration-300 hover:-rotate-12" />
      )}
    </button>
  );
}
