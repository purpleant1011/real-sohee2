export function checkNodeVersion(minMajor?: number): boolean
export function checkPlaywrightResolution(
  startPath?: string,
  resolver?: ((startPath?: string) => { ok: boolean; package?: string; error?: string }) | null
): { ok: boolean; package?: string; error?: string }
export function runConnectorSetup(options?: {
  homeDir?: string
  dryRun?: boolean
  skipBuild?: boolean
  silent?: boolean
  platform?: NodeJS.Platform
  skipPlaywrightCheck?: boolean
  playwrightResolver?: ((startPath?: string) => { ok: boolean; package?: string; error?: string }) | null
  rootDir?: string
}): Promise<{
  ok: boolean
  dryRun: boolean
  manifest: Readonly<{
    name: string
    description: string
    path: string
    type: 'stdio'
    allowed_origins: readonly string[]
  }>
  manifestPaths: string[]
  plannedFiles: string[]
  extensionId: string
}>
