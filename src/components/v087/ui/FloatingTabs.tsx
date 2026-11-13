"use client";

import React from "react";
import { motion } from "motion/react";

export interface TabItem {
  id: string;
  label: string;
  count?: number | string;
  icon?: React.ComponentType<{ className?: string }>;
}

interface FloatingTabsProps {
  tabs: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  layoutId?: string;
  className?: string;
}

export function FloatingTabs({
  tabs,
  activeId,
  onChange,
  layoutId = "floating-tab-pill",
  className = "",
}: FloatingTabsProps) {
  return (
    <div
      className={`inline-flex items-center gap-1 p-1 rounded-2xl bg-[#F6F4F0] dark:bg-[#1C1E22] border border-[#EAE7E3] dark:border-[rgba(255,255,255,0.06)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)] ${className}`}
    >
      {tabs.map((tab) => {
        const isActive = activeId === tab.id;
        const Icon = tab.icon;

        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`relative flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D4AFF] select-none ${
              isActive
                ? "text-[#171717] dark:text-white"
                : "text-[#666666] hover:text-[#171717] dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {isActive && (
              <motion.div
                layoutId={layoutId}
                className="absolute inset-0 rounded-xl bg-white dark:bg-[#282B32] shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04),inset_0_1px_0_0_rgba(255,255,255,1)]"
                transition={{ type: "spring", stiffness: 450, damping: 32 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              {Icon && <Icon className={`w-3.5 h-3.5 ${isActive ? "text-[#6D4AFF]" : "text-[#8C8A87]"}`} />}
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span
                  className={`px-1.5 py-0.2 text-[10px] font-black rounded-full ${
                    isActive
                      ? "bg-[#F1EDFF] text-[#5333E0] dark:bg-[#3D3075] dark:text-[#DCD3FF]"
                      : "bg-[#EAE7E3] text-[#666666] dark:bg-zinc-800 dark:text-zinc-400"
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
