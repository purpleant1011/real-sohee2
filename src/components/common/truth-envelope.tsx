import React from "react"
import { Badge } from "@/components/ui/badge"
import { AlertCircle, HelpCircle, Clock, ShieldCheck, Calculator } from "lucide-react"

export type FactKind = "OBSERVED" | "CALCULATED" | "ESTIMATED" | "DECLARED" | "UNKNOWN"

export type TruthStatus = "NO_DATA" | "UNKNOWN" | "UNPRICED" | "STALE" | "LIVE"

export type TruthEnvelopeProps = {
  factKind?: FactKind
  status?: TruthStatus
  observedAt?: string | null
  sourceType?: string | null
  confidence?: number | null
  children?: React.ReactNode
  className?: string
}

export function TruthBadge({
  factKind = "OBSERVED",
  status = "LIVE",
  observedAt,
}: {
  factKind?: FactKind
  status?: TruthStatus
  observedAt?: string | null
}) {
  if (status === "NO_DATA" || status === "UNKNOWN") {
    return (
      <Badge variant="outline" className="text-[10px] text-muted-foreground border-border/60 flex items-center gap-1 font-medium">
        <HelpCircle className="size-3 text-muted-foreground" />
        데이터 없음
      </Badge>
    )
  }

  if (status === "UNPRICED") {
    return (
      <Badge variant="outline" className="text-[10px] text-state-warn border-state-warn/30 bg-state-warn/10 flex items-center gap-1 font-medium">
        <AlertCircle className="size-3" />
        가격 미정
      </Badge>
    )
  }

  if (status === "STALE") {
    return (
      <Badge variant="outline" className="text-[10px] text-state-wait border-state-wait/30 bg-state-wait/10 flex items-center gap-1 font-medium">
        <Clock className="size-3" />
        동기화 지연
      </Badge>
    )
  }

  switch (factKind) {
    case "OBSERVED":
      return (
        <Badge variant="outline" className="text-[10px] text-state-ok border-state-ok/30 bg-state-ok/10 flex items-center gap-1 font-medium">
          <ShieldCheck className="size-3" />
          실제 관측됨
        </Badge>
      )
    case "CALCULATED":
      return (
        <Badge variant="outline" className="text-[10px] text-primary border-primary/30 bg-primary/10 flex items-center gap-1 font-medium">
          <Calculator className="size-3" />
          계산한 값
        </Badge>
      )
    case "ESTIMATED":
      return (
        <Badge variant="outline" className="text-[10px] text-state-quiet border-state-quiet/30 bg-state-quiet/10 flex items-center gap-1 font-medium">
          <AlertCircle className="size-3" />
          추정됨
        </Badge>
      )
    default:
      return (
        <Badge variant="outline" className="text-[10px] text-muted-foreground border-border/60 font-medium">
          확인 중
        </Badge>
      )
  }
}

export function NoDataFallback({
  title = "데이터 없음",
  description = "현재 관측된 실데이터가 없습니다.",
  source,
}: {
  title?: string
  description?: string
  source?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center border border-dashed border-border/60 rounded-lg bg-muted/20">
      <HelpCircle className="size-8 text-muted-foreground/60 mb-2" />
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground mt-1">{description}</p>
      {source && (
        <span className="text-[10px] text-muted-foreground/70 font-mono mt-2 bg-muted px-2 py-0.5 rounded">
          출처: {source}
        </span>
      )}
    </div>
  )
}
