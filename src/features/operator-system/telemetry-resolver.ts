export type FreshnessGrade = 'FRESH' | 'STALE' | 'UNKNOWN';
export type ObservabilityStatus = 'HEALTHY' | 'DEGRADED' | 'STALE' | 'UNKNOWN' | 'INCIDENT';

export interface TelemetryPointInput {
  source: string;
  measured_at: string | null;
  window: string;
  query_id: string;
  latency_ms: number | null;
  uptime_pct: number | null;
  now?: Date;
}

export interface MeasuredTelemetryPoint {
  source: string;
  measured_at: string | null;
  window: string;
  query_id: string;
  freshness_grade: FreshnessGrade;
  status: ObservabilityStatus;
  latency_ms: number | null;
  uptime_pct: number | null;
  error_rate_pct: number | null;
}

export interface SystemNodeReadModel {
  name: string;
  type: string;
  telemetry: MeasuredTelemetryPoint;
  statusLabel: string;
  latencyLabel: string;
  uptimeLabel: string;
}

/**
 * Evaluates freshness:
 * <= 5 minutes: FRESH
 * 5 ~ 30 minutes: STALE
 * > 30 minutes or missing: UNKNOWN
 */
export function evaluateFreshnessGrade(measuredAt: string | null, now = new Date()): FreshnessGrade {
  if (!measuredAt) return 'UNKNOWN';

  const timestamp = new Date(measuredAt).getTime();
  if (isNaN(timestamp)) return 'UNKNOWN';

  const diffMs = now.getTime() - timestamp;
  if (diffMs < 0) return 'UNKNOWN'; // future timestamp is invalid

  if (diffMs <= 5 * 60 * 1000) return 'FRESH';
  if (diffMs <= 30 * 60 * 1000) return 'STALE';
  return 'UNKNOWN';
}

/**
 * Resolves a single telemetry point with fail-closed rules.
 */
export function resolveTelemetryPoint(input: TelemetryPointInput): MeasuredTelemetryPoint {
  const now = input.now ?? new Date();
  const freshness = evaluateFreshnessGrade(input.measured_at, now);

  let status: ObservabilityStatus = 'UNKNOWN';
  if (freshness === 'UNKNOWN') {
    status = 'UNKNOWN';
  } else if (freshness === 'STALE') {
    status = 'STALE';
  } else if (input.uptime_pct !== null && input.uptime_pct < 95.0) {
    status = 'DEGRADED';
  } else if (input.latency_ms !== null && input.latency_ms > 2000) {
    status = 'DEGRADED';
  } else if (input.uptime_pct !== null || input.latency_ms !== null) {
    status = 'HEALTHY';
  }

  return {
    source: input.source,
    measured_at: input.measured_at,
    window: input.window,
    query_id: input.query_id,
    freshness_grade: freshness,
    status,
    latency_ms: input.latency_ms,
    uptime_pct: input.uptime_pct,
    error_rate_pct: null,
  };
}

/**
 * Standard infrastructure components that must be monitored.
 * If no real telemetry is provided, they are rendered as UNKNOWN with no false-green numbers.
 */
const STANDARD_INFRA_COMPONENTS = [
  { name: 'Cloudflare Workers Edge (icn01)', type: 'EDGE_RUNTIME', source: 'CLOUDFLARE_ANALYTICS' },
  { name: 'Cloudflare Queues (Dispatch Worker)', type: 'ASYNC_QUEUE', source: 'CLOUDFLARE_QUEUES' },
  { name: 'Supabase PostgreSQL (Transaction Core)', type: 'PRIMARY_DB', source: 'SUPABASE_HEALTH' },
  { name: 'Cloudflare R2 Asset Storage', type: 'OBJECT_STORAGE', source: 'R2_ANALYTICS' },
  { name: 'Google Gemini Pro / Flash API', type: 'AI_INFERENCE_GATEWAY', source: 'GEMINI_METRICS' },
];

/**
 * Resolves system infrastructure nodes based on actual observations.
 * Never invents fake 99.98% or 18ms.
 */
export function resolveInfrastructureNodes(
  observations: readonly { source: string; observedAt?: string | null; state?: string; metricValue?: number | null }[] = [],
  incidents: readonly { impactScope?: string | null; status?: string | null }[] = [],
  now = new Date()
): SystemNodeReadModel[] {
  const observationMap = new Map(observations.map(o => [o.source, o]));

  return STANDARD_INFRA_COMPONENTS.map(comp => {
    const obs = observationMap.get(comp.source);
    const measuredAt = obs?.observedAt ?? null;
    const latency = obs?.metricValue ?? null;
    const hasActiveIncident = incidents.some(inc => inc.status !== 'resolved' && inc.impactScope?.includes(comp.source));

    const telemetry = resolveTelemetryPoint({
      source: comp.source,
      measured_at: measuredAt,
      window: '5m',
      query_id: `chk-${comp.source.toLowerCase()}`,
      latency_ms: latency,
      uptime_pct: null, // Only actual calculated uptime should be populated
      now,
    });

    if (hasActiveIncident) {
      telemetry.status = 'INCIDENT';
    }

    const statusLabel = telemetry.status;
    const latencyLabel = telemetry.latency_ms !== null ? `${telemetry.latency_ms}ms` : '-';
    const uptimeLabel = telemetry.uptime_pct !== null ? `${telemetry.uptime_pct.toFixed(2)}%` : '-';

    return {
      name: comp.name,
      type: comp.type,
      telemetry,
      statusLabel,
      latencyLabel,
      uptimeLabel,
    };
  });
}
