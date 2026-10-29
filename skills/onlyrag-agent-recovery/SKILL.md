---
name: onlyrag-agent-recovery
description: Change OnlyRag interrupted-agent recovery, retained requests, run checkpoints or explicit reconciliation of effects with an unknown outcome.
triggers: ["agent recovery", "interrupted agent", "agent checkpoint", "agent-task-recovery.json", "abandon run", "inflight reconciliation", "riprendi task", "abbandona esecuzione"]
tags: ["agent recovery", "checkpoints"]
---

# Interrupted agent runs

- Start at `electron/core/application/taskQueueAppService.ts`, `electron/core/infrastructure/filesystem/agentTaskRecoveryRepository.ts` and `electron/core/presentation/agentIpc.ts`. Keep the accepted request durable before enqueueing; the pending ledger and execution checkpoint have different roles.
- Preserve `runId`, `conversationId` and plan revision through resume, events and approvals. Recovery is explicit and ordered within the original conversation; a new identity must not overwrite pending work. Terminal receipts prevent replay.
- A retained `apply_action` phase with no acknowledged outcome cannot be resumed by repeating the tool. Keep inspection and explicit abandonment: bind the confirmation to an unchanged evidence digest, archive request/evidence with readback, then release the conversation. Failure or concurrent admission keeps the pending run protected.
- `electron/core/infrastructure/filesystem/agentCheckpointStore.ts` stores file baselines per run. Incremental checkpointing must retain the first pre-edit bytes and the conversation identity; cancellation does not automatically restore files. Full-access changes outside the workspace do not belong to that workspace's restore.
- Check `electron/core/application/agentOrchestratorSessionState.ts` when changing persistence before tools and after results; restoring only the queue or only the file journal is insufficient.
- Select `electron/core/application/agentTaskRecovery.test.ts`, the checkpoint-store tests and `src/components/coding/AgentTaskRecoveryBanner.test.tsx` using [verification commands](../code-quality-and-linting/SKILL.md). When native crash validation is required, `npm run test:e2e:agent-crash` builds and interrupts owned fixture processes; it does not simulate power loss.
- See [agent-runtime.md](../../docs/agent-runtime.md) for the flow and [tool policy](../agent-security-and-tool-calling/SKILL.md) for ordinary execution gates.
