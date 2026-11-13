/**
 * Goal Completion Contract & CompletionEvaluator (ANI-948 / GC-06)
 *
 * Inviolable Invariant:
 * "no tool call ≠ Work completed"
 *
 * Prevents autonomous models from closing an ActionGraph simply by returning 0 tool calls.
 * Verifies that mandatory nodes, outcome predicates, evidence predicates, and external
 * readback verifications are verified and satisfied before an ActionGraph transitions to COMPLETED.
 */

import type { ActionGraph, ActionGraphNode } from './agent-loop-engine'

export interface EvidencePredicate {
  type?: 'readback' | 'durable_proof' | 'custom' | string
  channel?: string
  hasReadbackEvidence?: boolean
  hasDurableProof?: boolean
  requireUrl?: boolean
  requireReceiptId?: boolean
  check?: (evidence: any[], graph: ActionGraph) => boolean
  description?: string
}

export interface RequiredOutcomeContract {
  nodeId?: string
  actionName?: string
  capabilityId?: string
  toolName?: string
  requiredStatus?: 'VERIFIED' | 'COMPLETED'
  isMandatory?: boolean
  description?: string
}

export interface GoalCompletionContract {
  goalId?: string
  goalTitle?: string
  mandatoryNodeIds?: string[]
  requiredEvidence?: EvidencePredicate | EvidencePredicate[]
  requiredOutcomes?: RequiredOutcomeContract[]
  requireAllNodesTerminal?: boolean
  replanOnFailure?: boolean
  hasReadbackEvidence?: boolean
  hasDurableProof?: boolean
}

export type CompletionEvaluationErrorCode =
  | 'UNMET_COMPLETION_PREDICATES'
  | 'REPLAN_REQUIRED'
  | 'RESULT_UNKNOWN_UNRESOLVED'
  | 'PENDING_MANDATORY_APPROVALS'
  | 'MANDATORY_NODE_INCOMPLETE'

export interface CompletionEvaluationResult {
  passed: boolean
  status: 'COMPLETED' | 'FAILED' | 'REPLAN_REQUIRED'
  errorCode?: CompletionEvaluationErrorCode
  reasons: string[]
  unmetPredicates?: string[]
  unresolvedNodes?: string[]
  pendingApprovals?: string[]
  evaluatedNodesCount: number
  evaluatedStepsCount: number
}

export class CompletionEvaluator {
  /**
   * Evaluates whether an ActionGraph has satisfied all completion criteria and contracts.
   */
  public static evaluate(
    actionGraph: ActionGraph,
    contract?: GoalCompletionContract
  ): CompletionEvaluationResult {
    const reasons: string[] = []
    const unmetPredicates: string[] = []
    const unresolvedNodes: string[] = []
    const pendingApprovals: string[] = []

    const steps = actionGraph.steps || []
    const nodes = actionGraph.nodes || []

    // 1. Check for Unresolved RESULT_UNKNOWN statuses (Inviolable Gate)
    for (const step of steps) {
      const isUnknownStatus = (step.status as string) === 'RESULT_UNKNOWN'
      const isUnknownError = step.error?.code === 'RESULT_UNKNOWN'
      const isUnknownResult =
        (step.result as any)?.status === 'RESULT_UNKNOWN' ||
        (step.result as any)?.verificationState === 'RESULT_UNKNOWN' ||
        (step.result as any)?.errorCode === 'RESULT_UNKNOWN'

      if (isUnknownStatus || isUnknownError || isUnknownResult) {
        const id = step.toolCallId || step.toolId || `step_${step.stepIndex}`
        unresolvedNodes.push(id)
        reasons.push(`Unresolved RESULT_UNKNOWN status detected in execution step [${id}]`)
      }
    }

    for (const node of nodes) {
      const isUnknownStatus = node.status === 'RESULT_UNKNOWN'
      const isUnknownEvidence = (node.evidence as any)?.verificationState === 'RESULT_UNKNOWN'

      if (isUnknownStatus || isUnknownEvidence) {
        unresolvedNodes.push(node.nodeId)
        reasons.push(`Unresolved RESULT_UNKNOWN status detected in ActionGraph node [${node.nodeId}]`)
      }
    }

    if ((actionGraph.finalEvidence as any)?.verificationState === 'RESULT_UNKNOWN') {
      unresolvedNodes.push('finalEvidence')
      reasons.push('Unresolved RESULT_UNKNOWN state in ActionGraph finalEvidence')
    }

    if (unresolvedNodes.length > 0) {
      return {
        passed: false,
        status: contract?.replanOnFailure ? 'REPLAN_REQUIRED' : 'FAILED',
        errorCode: 'RESULT_UNKNOWN_UNRESOLVED',
        reasons,
        unresolvedNodes,
        evaluatedNodesCount: nodes.length,
        evaluatedStepsCount: steps.length
      }
    }

    // 2. Check for Pending Mandatory Approvals
    if (actionGraph.status === 'AWAITING_APPROVAL') {
      pendingApprovals.push(actionGraph.runId)
      reasons.push(`ActionGraph run [${actionGraph.runId}] is awaiting human approval`)
    }

    for (const step of steps) {
      if (step.status === 'AWAITING_APPROVAL') {
        const id = step.toolCallId || step.toolId || `step_${step.stepIndex}`
        pendingApprovals.push(id)
        reasons.push(`Execution step [${id}] is awaiting approval`)
      } else if (step.proposal && (step.proposal as any).status === 'PENDING') {
        pendingApprovals.push(step.proposal.proposalId)
        reasons.push(`Execution proposal [${step.proposal.proposalId}] has not been approved`)
      }
    }

    for (const node of nodes) {
      if (node.status === 'AWAITING_APPROVAL' || (node.requiresApproval && node.approvalStatus !== 'APPROVED')) {
        pendingApprovals.push(node.nodeId)
        reasons.push(`ActionGraph node [${node.nodeId}] is awaiting approval`)
      }
    }

    if (pendingApprovals.length > 0) {
      return {
        passed: false,
        status: 'FAILED',
        errorCode: 'PENDING_MANDATORY_APPROVALS',
        reasons,
        pendingApprovals,
        evaluatedNodesCount: nodes.length,
        evaluatedStepsCount: steps.length
      }
    }

    // 3. Check Mandatory Nodes Terminal Status
    const incompleteMandatoryNodes: string[] = []

    if (nodes.length > 0) {
      for (const node of nodes) {
        const isExplicitMandatory = node.isMandatory === true
        const isInMandatoryIds = contract?.mandatoryNodeIds?.includes(node.nodeId)
        const isInRequiredOutcomes = contract?.requiredOutcomes?.some(
          o => (o.nodeId === node.nodeId || o.capabilityId === node.capabilityId || o.actionName === node.actionName) && o.isMandatory !== false
        )
        const isMandatory =
          isExplicitMandatory ||
          Boolean(isInMandatoryIds) ||
          Boolean(isInRequiredOutcomes) ||
          (node.isMandatory !== false && !contract?.mandatoryNodeIds && !contract?.requiredOutcomes)

        if (isMandatory) {
          const isTerminalSatisfied = node.status === 'VERIFIED' || node.status === 'COMPLETED'
          if (!isTerminalSatisfied) {
            incompleteMandatoryNodes.push(node.nodeId)
            reasons.push(`Mandatory ActionGraph node [${node.nodeId}] is in non-terminal/non-verified status '${node.status}'`)
          }
        }
      }
    }

    if (contract?.mandatoryNodeIds && contract.mandatoryNodeIds.length > 0) {
      for (const reqId of contract.mandatoryNodeIds) {
        const matchedNode = nodes.find(n => n.nodeId === reqId)
        const matchedStep = steps.find(s => s.toolCallId === reqId || s.toolId === reqId || s.toolName === reqId)
        if (!matchedNode && !matchedStep) {
          incompleteMandatoryNodes.push(reqId)
          reasons.push(`Mandatory node [${reqId}] was neither planned nor executed`)
        } else if (matchedStep && matchedStep.status !== 'COMPLETED' && (matchedStep.status as any) !== 'VERIFIED') {
          incompleteMandatoryNodes.push(reqId)
          reasons.push(`Execution step for mandatory node [${reqId}] finished with status '${matchedStep.status}'`)
        }
      }
    }

    if (contract?.requiredOutcomes && contract.requiredOutcomes.length > 0) {
      for (const outcome of contract.requiredOutcomes) {
        if (outcome.isMandatory === false) continue
        const reqStatus = outcome.requiredStatus || 'COMPLETED'
        const matchedNode = nodes.find(
          n => (outcome.nodeId && n.nodeId === outcome.nodeId) ||
               (outcome.actionName && n.actionName === outcome.actionName) ||
               (outcome.capabilityId && n.capabilityId === outcome.capabilityId)
        )
        const matchedStep = steps.find(
          s => (outcome.nodeId && s.toolCallId === outcome.nodeId) ||
               (outcome.capabilityId && s.toolId === outcome.capabilityId) ||
               (outcome.toolName && s.toolName === outcome.toolName)
        )

        let isMet = false
        if (matchedNode) {
          isMet = reqStatus === 'VERIFIED'
            ? matchedNode.status === 'VERIFIED'
            : (matchedNode.status === 'VERIFIED' || matchedNode.status === 'COMPLETED')
        } else if (matchedStep) {
          isMet = reqStatus === 'VERIFIED'
            ? (matchedStep.status as any) === 'VERIFIED' || Boolean(matchedStep.evidence?.hasReadbackEvidence || matchedStep.evidence?.readbackVerified)
            : (matchedStep.status === 'COMPLETED' || (matchedStep.status as any) === 'VERIFIED')
        }

        if (!isMet) {
          const id = outcome.nodeId || outcome.actionName || outcome.capabilityId || 'required_outcome'
          incompleteMandatoryNodes.push(id)
          reasons.push(`Required outcome [${id}] (${outcome.description || reqStatus}) not satisfied`)
        }
      }
    }

    if (incompleteMandatoryNodes.length > 0) {
      return {
        passed: false,
        status: contract?.replanOnFailure ? 'REPLAN_REQUIRED' : 'FAILED',
        errorCode: 'UNMET_COMPLETION_PREDICATES',
        reasons,
        unresolvedNodes: incompleteMandatoryNodes,
        evaluatedNodesCount: nodes.length,
        evaluatedStepsCount: steps.length
      }
    }

    // 4. Check Required Evidence Predicates
    const allEvidence: any[] = []
    if (actionGraph.finalEvidence) {
      allEvidence.push(actionGraph.finalEvidence)
    }
    for (const step of steps) {
      if (step.evidence) {
        allEvidence.push(step.evidence)
      }
    }
    for (const node of nodes) {
      if (node.evidence) {
        allEvidence.push(node.evidence)
      }
    }

    const hasReadback = allEvidence.some(ev =>
      Boolean(
        ev.readbackVerified === true ||
        ev.hasReadbackEvidence === true ||
        ev.readbackHash ||
        (ev.url && typeof ev.url === 'string' && ev.url.trim().length > 0 && ev.httpStatus && ev.httpStatus >= 200 && ev.httpStatus < 400)
      )
    )

    const hasDurable = allEvidence.some(ev =>
      Boolean(
        ev.hasDurableProof === true ||
        (ev.receiptId && typeof ev.receiptId === 'string' && ev.receiptId.trim().length > 0) ||
        (ev.durableProofId && typeof ev.durableProofId === 'string' && ev.durableProofId.trim().length > 0) ||
        (ev.authoritativeId && typeof ev.authoritativeId === 'string' && ev.authoritativeId.trim().length > 0)
      )
    ) || nodes.some(n => Boolean(n.evidenceId))

    const predicatesToCheck: EvidencePredicate[] = []

    if (contract?.hasReadbackEvidence === true) {
      predicatesToCheck.push({ type: 'readback', hasReadbackEvidence: true, description: 'hasReadbackEvidence' })
    }
    if (contract?.hasDurableProof === true) {
      predicatesToCheck.push({ type: 'durable_proof', hasDurableProof: true, description: 'hasDurableProof' })
    }

    if (contract?.requiredEvidence) {
      const list = Array.isArray(contract.requiredEvidence) ? contract.requiredEvidence : [contract.requiredEvidence]
      predicatesToCheck.push(...list)
    }

    for (const pred of predicatesToCheck) {
      if (pred.hasReadbackEvidence === true && !hasReadback) {
        unmetPredicates.push('hasReadbackEvidence')
        reasons.push(pred.description || 'Required independent readback evidence is missing')
      }

      if (pred.hasDurableProof === true && !hasDurable) {
        unmetPredicates.push('hasDurableProof')
        reasons.push(pred.description || 'Required durable proof evidence is missing')
      }

      if (pred.requireUrl === true) {
        const hasUrl = allEvidence.some(ev => Boolean(ev.url && typeof ev.url === 'string' && ev.url.trim().length > 0))
        if (!hasUrl) {
          unmetPredicates.push(pred.description || 'requireUrl')
          reasons.push(`Required live URL in evidence is missing: ${pred.description || 'requireUrl'}`)
        }
      }

      if (pred.requireReceiptId === true) {
        const hasRcpt = allEvidence.some(ev => Boolean(ev.receiptId && typeof ev.receiptId === 'string' && ev.receiptId.trim().length > 0))
        if (!hasRcpt) {
          unmetPredicates.push(pred.description || 'requireReceiptId')
          reasons.push(`Required receiptId in evidence is missing: ${pred.description || 'requireReceiptId'}`)
        }
      }

      if (pred.channel) {
        const hasChannel = allEvidence.some(ev => ev.channel === pred.channel)
        if (!hasChannel) {
          unmetPredicates.push(pred.description || `channel:${pred.channel}`)
          reasons.push(`Required evidence for channel '${pred.channel}' is missing`)
        }
      }

      if (pred.check) {
        const passed = pred.check(allEvidence, actionGraph)
        if (!passed) {
          unmetPredicates.push(pred.description || 'customPredicate')
          reasons.push(`Custom evidence predicate failed: ${pred.description || 'custom'}`)
        }
      }
    }

    if (unmetPredicates.length > 0) {
      return {
        passed: false,
        status: contract?.replanOnFailure ? 'REPLAN_REQUIRED' : 'FAILED',
        errorCode: 'UNMET_COMPLETION_PREDICATES',
        reasons,
        unmetPredicates: Array.from(new Set(unmetPredicates)),
        evaluatedNodesCount: nodes.length,
        evaluatedStepsCount: steps.length
      }
    }

    return {
      passed: true,
      status: 'COMPLETED',
      reasons: [],
      evaluatedNodesCount: nodes.length,
      evaluatedStepsCount: steps.length
    }
  }
}
