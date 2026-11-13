export interface RenderedCopyEntry {
  route: string
  url: string
  entries: Array<{ kind: string; text: string; attr?: string; where?: string }>
}

export function parseDriverOutput(stdout: string, stderr?: string): RenderedCopyEntry[]
