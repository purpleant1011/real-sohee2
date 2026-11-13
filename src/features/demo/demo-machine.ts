export type DemoStep = 0 | 1 | 2 | 3 | 4 | 5

export function advanceDemo(step: DemoStep): DemoStep {
  return Math.min(5, step + 1) as DemoStep
}

export function resetDemo(): 0 {
  return 0
}
