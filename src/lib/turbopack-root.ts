export function resolveTurbopackRoot(input: {
  cwd: string
  isLocalE2E: boolean
  localE2ERoot?: string
}): string {
  if (input.isLocalE2E && input.localE2ERoot) return input.localE2ERoot
  return input.cwd
}
