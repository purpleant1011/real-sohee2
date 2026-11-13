import { ActionGraphResumeEngine } from '@/features/tool-runtime/action-graph-resume-engine'

const [mode, runId, workspaceId] = process.argv.slice(2)
let dispatches = 0
const emit = (event: object) => process.stdout.write(`CAR_WORKER:${JSON.stringify(event)}\n`)
const hold = async () => {
  emit({ type: 'ready', pid: process.pid, dispatches })
  // The parent kills only this owned process, after the durable checkpoint.
  process.stdin.resume()
  await new Promise<void>(() => {})
}
try {
  const graph = await ActionGraphResumeEngine.resumeGraph(runId, workspaceId)
  const result = await ActionGraphResumeEngine.executeGraph(graph, {
    workspaceId,
    executor: async node => {
      // in-flight is a suspended local stub, never a provider request.
      if (mode === 'in-flight') { dispatches++; await hold() }
      if (node.isExternalMutation) throw new Error('SANDBOX_EXTERNAL_WRITE_BLOCKED')
      dispatches++
      return { status: 'COMPLETED', output: { localFixture: true } }
    },
    onNodeCompleted: mode === 'checkpointed' ? hold : undefined,
  })
  emit({ type: 'result', pid: process.pid, dispatches, status: result.status, nodes: result.nodes?.map(node => node.status) })
} catch (error) {
  emit({ type: 'result', pid: process.pid, dispatches, status: 'BLOCKED', error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' })
}
