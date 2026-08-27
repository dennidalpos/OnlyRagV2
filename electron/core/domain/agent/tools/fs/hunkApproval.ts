import type { AgentToolCall } from '../../agentTypes'
import { computeLineDiff, groupDiffIntoHunks, reconstructWithApprovedHunks } from '../../diffEngine'
import { projectPendingChange } from '../../pendingChangeProjection'
import { FILE_MUTATION_TOOL_TO_PROPOSAL_TYPE } from '../toolExecutionContracts'

/** Rewrites a mutation to the subset of hunks explicitly approved by the user. */
export function reconcileApprovedHunks(
  parsedTool: AgentToolCall,
  approvedHunkIndices: number[] | undefined,
  beforeContent: string,
): AgentToolCall {
  if (!approvedHunkIndices) return parsedTool
  const proposalType = FILE_MUTATION_TOOL_TO_PROPOSAL_TYPE[parsedTool.tool]
  if (!proposalType) return parsedTool

  const filePath = parsedTool.parameters?.filePath
  const proposedContent = projectPendingChange(
    {
      type: proposalType,
      content: parsedTool.parameters?.content,
      targetContent: parsedTool.parameters?.targetContent,
      replacementContent: parsedTool.parameters?.replacementContent,
      replacements: parsedTool.parameters?.replacements,
    },
    beforeContent,
  )
  const diffLines = computeLineDiff(beforeContent, proposedContent)
  const hunks = groupDiffIntoHunks(diffLines)
  if (approvedHunkIndices.length >= hunks.length) return parsedTool

  return {
    ...parsedTool,
    tool: 'write_file',
    parameters: {
      ...parsedTool.parameters,
      filePath,
      content: reconstructWithApprovedHunks(diffLines, hunks, new Set(approvedHunkIndices)),
    },
  }
}
