import * as React from "react"
import { cn } from "@/lib/utils"

function Switch({
  className,
  checked,
  onCheckedChange,
  disabled,
  ...props
}: Omit<React.ComponentProps<"button">, "onChange"> & {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onCheckedChange?.(!checked)}
      data-slot="switch"
      data-state={checked ? "checked" : "unchecked"}
      className={cn(
        // 터치 영역 44x44(mobile-r2 R1/MIN_TOUCH). 시각 트랙은 안쪽 span 이 담당한다.
        "peer inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <span
        data-slot="switch-track"
        className={cn(
          "pointer-events-none flex h-5 w-9 items-center rounded-full border-2 border-transparent shadow-xs transition-colors",
          checked ? "bg-primary" : "bg-input",
        )}
      >
        <span
          data-slot="switch-thumb"
          data-state={checked ? "checked" : "unchecked"}
          className={cn(
            "pointer-events-none block size-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </span>
    </button>
  )
}

export { Switch }
