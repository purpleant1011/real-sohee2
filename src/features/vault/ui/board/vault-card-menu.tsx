'use client'

import { forwardRef } from 'react'
import { Button, Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components'
import { MoreHorizontal } from 'lucide-react'

export type VaultCardMenuProps = {
  /** Names the trigger for screen readers, e.g. "네이버 블로그 2026년 10월 8일". */
  label: string
  onOpenBundle: () => void
}

/**
 * Card menu for manual-publishing channels. Built on the same accessible primitives as the shared dialog:
 * arrow keys move, Enter picks, Escape closes and returns focus to the trigger.
 */
export const VaultCardMenu = forwardRef<HTMLButtonElement, VaultCardMenuProps>(function VaultCardMenu({ label, onOpenBundle }, ref) {
  return (
    <MenuTrigger>
      <Button
        ref={ref}
        aria-label={`${label} 더 보기`}
        className="inline-flex size-11 items-center justify-center rounded-md border border-input bg-background text-foreground shadow-sm outline-none hover:bg-accent data-[focus-visible]:ring-2 data-[focus-visible]:ring-ring"
      >
        <MoreHorizontal className="size-4" aria-hidden="true" />
      </Button>
      <Popover placement="bottom end" className="z-[90] min-w-48 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg">
        <Menu aria-label={`${label} 메뉴`} className="outline-none" onAction={() => onOpenBundle()}>
          <MenuItem
            id="bundle"
            textValue="복사용 글 열기"
            className="flex min-h-11 cursor-pointer items-center rounded-md px-3 text-sm outline-none data-[focused]:bg-accent data-[focused]:text-accent-foreground"
          >
            복사용 글 열기
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  )
})
