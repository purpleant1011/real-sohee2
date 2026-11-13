"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export type TabItem = {
  content: React.ReactNode
  id: string
  label: string
}

interface TabsContextValue {
  value: string
  onValueChange: (val: string) => void
}

const TabsContext = React.createContext<TabsContextValue | null>(null)

function useTabsContext() {
  const context = React.useContext(TabsContext)
  if (!context) throw new Error("Tabs components must be used within <Tabs />")
  return context
}

type LegacyTabsProps = {
  "aria-label"?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  tabs?: TabItem[]
  value?: string
  children?: React.ReactNode
  className?: string
}

export function Tabs({
  className,
  tabs,
  "aria-label": ariaLabel,
  children,
  defaultValue = "",
  value: controlledValue,
  onValueChange: controlledOnChange,
  ...props
}: LegacyTabsProps & React.HTMLAttributes<HTMLDivElement>) {
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue || tabs?.[0]?.id || "")
  const isControlled = controlledValue !== undefined
  const currentValue = isControlled ? controlledValue : uncontrolledValue

  const handleValueChange = React.useCallback((val: string) => {
    if (!isControlled) setUncontrolledValue(val)
    controlledOnChange?.(val)
  }, [isControlled, controlledOnChange])

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (!tabs || tabs.length === 0) return
    let nextIndex = index
    if (e.key === 'ArrowRight') {
      nextIndex = (index + 1) % tabs.length
    } else if (e.key === 'ArrowLeft') {
      nextIndex = (index - 1 + tabs.length) % tabs.length
    } else if (e.key === 'Home') {
      nextIndex = 0
    } else if (e.key === 'End') {
      nextIndex = tabs.length - 1
    } else {
      return
    }
    e.preventDefault()
    const nextTab = tabs[nextIndex]
    if (nextTab) {
      handleValueChange(nextTab.id)
      const el = document.getElementById(nextTab.id)
      el?.focus()
    }
  }

  if (tabs && tabs.length > 0) {
    return (
      <div className={cn("w-full space-y-2", className)} {...props}>
        <div role="tablist" aria-label={ariaLabel} className="inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground">
          {tabs.map((t, idx) => (
            <button
              key={t.id}
              id={t.id}
              role="tab"
              type="button"
              tabIndex={t.id === currentValue ? 0 : -1}
              aria-controls={`panel-${t.id}`}
              aria-selected={t.id === currentValue}
              onClick={() => handleValueChange(t.id)}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              className={cn(
                "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
                t.id === currentValue && "bg-background text-foreground shadow-xs font-semibold"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tabs.map((t) => (
          t.id === currentValue && (
            <div key={t.id} id={`panel-${t.id}`} role="tabpanel" aria-labelledby={t.id} tabIndex={0} className="mt-2 ring-offset-background focus-visible:outline-none">
              {t.content}
            </div>
          )
        ))}
      </div>
    )
  }

  return (
    <TabsContext.Provider value={{ value: currentValue, onValueChange: handleValueChange }}>
      <div className={cn("w-full space-y-2", className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  )
}

export function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

export function TabsTrigger({
  className,
  value,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) {
  const { value: activeValue, onValueChange } = useTabsContext()
  const isSelected = activeValue === value

  return (
    <button
      role="tab"
      type="button"
      aria-selected={isSelected}
      onClick={() => onValueChange(value)}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
        isSelected && "bg-background text-foreground shadow-xs font-semibold",
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function TabsContent({
  className,
  value,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { value: string }) {
  const { value: activeValue } = useTabsContext()
  if (activeValue !== value) return null

  return (
    <div
      role="tabpanel"
      tabIndex={0}
      className={cn("mt-2 ring-offset-background focus-visible:outline-none", className)}
      {...props}
    >
      {children}
    </div>
  )
}
