"use client";

import React, { useRef, useState } from "react";
import { motion, type HTMLMotionProps } from "motion/react";

interface SoheeCardProps extends HTMLMotionProps<"div"> {
  children: React.ReactNode;
  variant?: "default" | "elevated" | "interactive" | "hero" | "subtle";
  enableSpotlight?: boolean;
}

export function SoheeCard({
  children,
  variant = "default",
  enableSpotlight = true,
  className = "",
  ...props
}: SoheeCardProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: -400, y: -400 });
  const [opacity, setOpacity] = useState(0);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!enableSpotlight || !divRef.current) return;
    const rect = divRef.current.getBoundingClientRect();
    setPosition({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const variantStyles = {
    default:
      "bg-white dark:bg-[#141517] border border-[#EAE7E3] dark:border-[rgba(255,255,255,0.08)] shadow-[0_1px_3px_rgba(0,0,0,0.03),0_4px_12px_-2px_rgba(0,0,0,0.03),inset_0_1px_0_0_rgba(255,255,255,0.9)]",
    elevated:
      "bg-white dark:bg-[#141517] border border-[#EAE7E3] dark:border-[rgba(255,255,255,0.1)] shadow-[0_8px_24px_-4px_rgba(0,0,0,0.06),0_2px_6px_rgba(0,0,0,0.02),inset_0_1px_0_0_rgba(255,255,255,0.95)]",
    interactive:
      "bg-white dark:bg-[#141517] border border-[#EAE7E3] dark:border-[rgba(255,255,255,0.08)] shadow-[0_1px_3px_rgba(0,0,0,0.03),inset_0_1px_0_0_rgba(255,255,255,0.9)] hover:border-[#6D4AFF]/40 hover:shadow-[0_8px_24px_-4px_rgba(109,74,255,0.1),inset_0_1px_0_0_rgba(255,255,255,1)] cursor-pointer",
    hero:
      "bg-gradient-to-b from-white to-[#FAF8F5] dark:from-[#181A1E] dark:to-[#121315] border border-[#DCD3FF] dark:border-[#3D3075] shadow-[0_12px_36px_-6px_rgba(109,74,255,0.12),inset_0_1px_0_0_rgba(255,255,255,1)]",
    subtle:
      "bg-[#F6F4F0] dark:bg-[#1C1E22] border border-[#EAE7E3] dark:border-[rgba(255,255,255,0.05)] shadow-none",
  }[variant];

  return (
    <motion.div
      ref={divRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => enableSpotlight && setOpacity(1)}
      onMouseLeave={() => enableSpotlight && setOpacity(0)}
      transition={{ type: "spring", stiffness: 350, damping: 25 }}
      className={`relative overflow-hidden rounded-2xl p-5 sm:p-6 transition-all duration-200 ${variantStyles} ${className}`}
      {...props}
    >
      {enableSpotlight && (
        <div
          className="pointer-events-none absolute -inset-px transition-opacity duration-300 z-0"
          style={{
            opacity,
            background: `radial-gradient(500px circle at ${position.x}px ${position.y}px, rgba(109, 74, 255, 0.07), transparent 45%)`,
          }}
        />
      )}
      <div className="relative z-10">{children}</div>
    </motion.div>
  );
}
