import 'server-only'

import type { DueAutomationResult } from './due-runner'
import { runDueAutomations, type DueAutomationDependencies } from './due-runner'

/**
 * The cron entry remains report-only until concrete credit, notification, and
 * performance ports are integrated. It deliberately cannot dispatch content
 * or any supervised external action.
 */
export type ReportOnlyRuntime=Readonly<{enabled:boolean;dependencies?:DueAutomationDependencies;run?:typeof runDueAutomations}>
export function reportOnlyRuntimeFromEnv(dependencies?:DueAutomationDependencies):ReportOnlyRuntime{return{enabled:process.env.SOHEE_REPORT_ONLY_DUE_ENABLED==='1',dependencies}}
export async function runReportOnlyDueAutomations(_now: Date, _workerId: string, runtime?:ReportOnlyRuntime): Promise<DueAutomationResult> {
  if(runtime?.enabled&&runtime.run)return runtime.run(_now,_workerId,runtime.dependencies as DueAutomationDependencies)
  if(runtime?.enabled&&runtime.dependencies)return runDueAutomations(_now,_workerId,runtime.dependencies)
  return Object.freeze({ runs: Object.freeze([]) })
}
