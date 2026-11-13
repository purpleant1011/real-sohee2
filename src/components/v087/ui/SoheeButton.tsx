"use client";

import React from "react";
import { motion, type HTMLMotionProps } from "motion/react";

interface SoheeButtonProps extends HTMLMotionProps<"button"> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
  icon?: React.ReactNode;
}

export function SoheeButton({
  variant = "primary",
  size = "md",
  children,
  icon,
  className = "",
  disabled,
  ...props
}: SoheeButtonProps) {
  const sizeClasses = {
    sm: "px-3 py-1.5 text-xs rounded-xl min-h-[36px] gap-1.5 font-semibold",
    md: "px-4 py-2 text-xs sm:text-sm rounded-xl min-h-[44px] gap-2 font-bold",
    lg: "px-6 py-3 text-sm sm:text-base rounded-2xl min-h-[48px] gap-2.5 font-extrabold",
  }[size];

  const variantClasses = {
    primary:
      "bg-[#6D4AFF] hover:bg-[#5A35EB] text-white shadow-[0_1px_2px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.25)] hover:shadow-[0_4px_16px_rgba(109,74,255,0.35)] active:bg-[#4E2ED4] border border-[#5A35EB]/30",
    secondary:
      "bg-[#F1EDFF] hover:bg-[#E5DEFF] text-[#5333E0] dark:bg-[#231C44] dark:hover:bg-[#2F265C] dark:text-[#C3B4FF] border border-[#DCD3FF] dark:border-[#3D3075]",
    outline:
      "bg-white hover:bg-[#F6F4F0] text-[#171717] dark:bg-[#141517] dark:hover:bg-[#1C1E22] dark:text-zinc-100 border border-[#EAE7E3] dark:border-[rgba(255,255,255,0.1)] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.8),0_1px_2px_rgba(0,0,0,0.03)]",
    ghost:
      "bg-transparent hover:bg-[#F6F4F0] text-[#666666] hover:text-[#171717] dark:hover:bg-[#1C1E22] dark:text-zinc-400 dark:hover:text-zinc-100",
    danger:
      "bg-[#EF4444] hover:bg-[#DC2626] text-white shadow-[0_1px_2px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.2)] hover:shadow-[0_4px_16px_rgba(239,68,68,0.3)] border border-[#DC2626]/30",
  }[variant];

  return (
    <motion.button
      whileHover={disabled ? undefined : { scale: 1.015 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={{ type: "spring", stiffness: 450, damping: 30 }}
      disabled={disabled}
      className={`inline-flex items-center justify-center select-none transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D4AFF] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none ${sizeClasses} ${variantClasses} ${className}`}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{children}</span>
    </motion.button>
  );
}
