export const DEFAULT_BASE_URL: string
export const TARGET_ROUTE: string
export const DRIVER_MARKER: string
export const DEFAULT_OUT_DIR: string
export function isServerReachable(url: string, timeoutMs?: number): Promise<boolean>
export function findEgoBrowser(): string | null
export function checkAxeCoreInstalled(repoRoot?: string): boolean
export function parseDriverOutput(stdout?: string, stderr?: string): any
export function evaluateMeasurements(raw: any): {
  overall: 'PASS' | 'FAIL' | 'NOT_MEASURED'
  items: Record<string, { status: 'PASS' | 'FAIL' | 'NOT_MEASURED'; message: string; details?: any }>
}
export function buildDriverScript(options: { baseUrl: string; targetRoute: string; outDir: string; hasAxeCore: boolean }): string
export function runChannelStudioMeasure(options?: Record<string, unknown>): Promise<unknown>
