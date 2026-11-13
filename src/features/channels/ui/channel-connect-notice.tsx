import { AlertCircle, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ConnectNotice } from './channel-display'

export function ChannelConnectNotice({
  notice,
  className,
}: {
  notice: ConnectNotice | null
  className?: string
}) {
  if (!notice) return null

  return (
    <div
      role={notice.kind === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex flex-col gap-3 rounded-xl border p-4 text-sm sm:flex-row sm:items-start sm:justify-between',
        notice.kind === 'success'
          ? 'border-emerald-500/30 bg-emerald-50/80 text-emerald-950 dark:bg-emerald-950/20 dark:text-emerald-100'
          : 'border-border bg-muted/60',
        className,
      )}
    >
      <div className="flex gap-3">
        {notice.kind === 'success' ? (
          <Check className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
        ) : (
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        )}
        <div>
          <p className="font-semibold">{notice.title}</p>
          <p className="mt-1 text-muted-foreground whitespace-pre-line">{notice.message}</p>
        </div>
      </div>
      {notice.action && (
        <div className="pt-2 sm:pt-0 sm:shrink-0">
          <Button asChild size="sm" variant="outline" className="min-h-[44px] min-w-[44px] w-full sm:w-auto">
            <a href={notice.action.href}>{notice.action.label}</a>
          </Button>
        </div>
      )}
    </div>
  )
}
