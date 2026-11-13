import React, { type AnchorHTMLAttributes, forwardRef } from 'react'

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string | { pathname?: string; query?: Record<string, string> }
  asChild?: boolean
  prefetch?: boolean
  scroll?: boolean
}

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  props,
  ref
) {
  const { href, onClick, children, ...rest } = props
  delete (rest as Record<string, unknown>).asChild
  delete (rest as Record<string, unknown>).prefetch
  delete (rest as Record<string, unknown>).scroll

  const hrefString = typeof href === 'string' ? href : (href?.pathname || '/')

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (!e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      if (hrefString && (hrefString.startsWith('/') || hrefString.startsWith('.'))) {
        e.preventDefault()
        const url = new URL(hrefString, window.location.origin)
        window.history.pushState(null, '', url.toString())
        window.dispatchEvent(new PopStateEvent('popstate'))
      }
    }
  }

  return (
    <a ref={ref} href={hrefString} onClick={handleClick} {...rest}>
      {children}
    </a>
  )
})

export default Link
