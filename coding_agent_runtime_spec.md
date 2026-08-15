# ARCHITECTURAL SPECIFICATION & IMPLEMENTATION PLAN: LOCAL CODING AGENT RUNTIME

> **DIRECTIVE FOR THE INGESTING AI AGENT:**
> 1. **Phase 0 - Pre-Execution Audit (MANDATORY):** Before writing, modifying, or deleting any file in the workspace, you must thoroughly analyze the existing codebase and inspect this specification document.
> 2. **Critical Assessment Report:** You must produce an initial audit report outlining:
>    - Current architectural fit and structural compatibility.
>    - Potential risks, edge cases, performance bottlenecks, and resource risks (especially VRAM/RAM contention).
>    - Concrete architectural benefits and trade-offs.
> 3. **Wait for Human Confirmation:** Present your audit and await explicit human confirmation before executing Task 1 of the implementation checklist.

---

## 1. Executive Summary & Core Architectural Principles

This document defines the architecture and implementation blueprint for an extensible, local-first coding assistant runtime driven by **Ollama**. The system is built from a baseline constraint of consumer hardware (**8 GB VRAM / 16 GB System RAM**), while remaining fully scalable to multi-GPU and high-tier model matrices.

### Core Pillars:
1. **Dynamic State Machine (FSM):** Instant hot-swapping between `ASK`, `PLAN`, and `AGENT` modes without losing session context or conversational continuity.
2. **Preemptive Resource & VRAM Manager:** Active VRAM/RAM inspection, explicit model eviction (`keep_alive: 0`), and dynamic KV cache allocation preventing Out-Of-Memory (OOM) failures.
3. **Plan-Driven TDD Execution Engine:** Structured task tracking via `.assistant/plan.md`, test-driven validation per task, bounded auto-repair retries (max 3), and verified halting conditions.
4. **Context Lifecycle & Rolling Compaction:** High-watermark context monitoring (75-80%), aggressive output truncation, and rolling background summaries with immutable anchor preservation.
5. **Defense-in-Depth Guardrails:** Workspace canonical path jailing, sensitive file deny-lists, command execution sandboxing, and graceful abort signals.

---

## 2. Dynamic Runtime Finite State Machine (FSM)

### 2.1 State Matrix & Permissions

| Dimension | ASK Mode | PLAN Mode | AGENT Mode |
| :--- | :--- | :--- | :--- |
| **Primary Intent** | Code exploration, architecture discussion, Q&A | Requirement decomposition, architectural design | Autonomous code modification & test verification |
| **Allowed Tools** | `read_file_range`, `search_code`, `get_ast_outline`, `list_directory` | Read tools + `save_plan`, `update_plan_task` | Full read/write + `apply_diff_patch`, `create_file`, `delete_file`, `run_command` |
| **Filesystem Access** | Read-Only | Read-Only (except `.assistant/plan.md`) | Read / Write jailed within workspace root |
| **Terminal / CLI** | Disabled | Disabled | Sandboxed execution with timeout & status tracking |
| **Context Behavior** | Conversational Q&A | Structured Markdown Plan Generation | Task-driven iterative tool-calling loop |

### 2.2 In-Flight Hot-Swapping & Interruption Protocol

```
                     ┌──────────────────────────────────────┐
                     │          USER / RUNTIME EVENT        │
                     └───────┬──────────────┬───────────────┘
                             │              │
              [Mode Switch]  │              │  [Emergency / Error]
                             ▼              ▼
                     ┌──────────────────────────────┐
                     │   Graceful AbortController   │
                     │  - SIGINT to active subproc  │
                     │  - Stash uncommitted changes │
                     └──────────────┬───────────────┘
                                    │
               ┌────────────────────┼────────────────────┐
               ▼                    ▼                    ▼
        ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
        │     ASK     │◄────►│    PLAN     │◄────►│    AGENT    │
        └─────────────┘      └─────────────┘      └─────────────┘
```

#### Hot-Swapping Procedure:
1. **Interrupt Active Subprocesses:** When a mode switch is received, fire an `AbortSignal` to kill any running child processes (linters, test suites, long shell scripts) to prevent zombie locks.
2. **State Checkpointing:** Create an in-memory snapshot and internal git stash (`.assistant/checkpoints/`) preserving dirty workspace state.
3. **Dynamic Tool Schema Swap:** Instantaneously replace the active `tools` definition passed to the Ollama API without resetting the chat history.
4. **Context Bridge Injection:** Inject a synthetic system message informing the newly activated mode of previous progress, pending tasks, and recent failure logs.

---

## 3. Model Router & Hardware Resource Manager

### 3.1 Tiered Model Matrix

The runtime dynamically routes tasks according to complexity while respecting strict resource budgets:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                             ROUTER DISPATCHER                            │
│           (Inspects: Token Budget, AST Complexity, Task Type)            │
└───────┬──────────────────────────┬───────────────────────────┬───────────┘
        │                          │                           │
        ▼                          ▼                           ▼
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────────┐
│  FAST / ROUTER   │      │ WORKHORSE (CORE) │      │  HEAVY (ON-DEMAND)   │
│ qwen2.5-coder:3b │      │qwen2.5-coder:7b-q4│     │  qwen2.5-coder:14b   │
│ VRAM: ~2.2 GB    │      │ VRAM: ~5.8 GB    │      │ VRAM: ~9.2 GB (Split)│
└──────────────────┘      └──────────────────┘      └──────────────────────┘
```

### 3.2 Preemptive Eviction & Memory Negotiation

Before dispatching an inference call to Ollama:

$$	ext{Required\_Memory} = 	ext{Model\_Weights} + 	ext{KV\_Cache\_Reservation}$$

```python
# Conceptual Allocation & Eviction Logic
def prepare_model_for_task(target_model: str, required_vram_gb: float):
    available_vram_gb = get_free_vram()
    if available_vram_gb < required_vram_gb:
        # Evict all currently active models from VRAM
        active_models = ollama_client.ps()
        for model in active_models:
            ollama_client.generate(model=model.name, keep_alive=0)
    
    # Load target model with specific retention policy
    keep_alive = "10m" if target_model == "workhorse" else "0"
    return keep_alive
```

---

## 4. Plan-Driven Execution & TDD Halting Logic

### 4.1 Standard Specification for `.assistant/plan.md`

All implementation plans must follow this strict, machine-parseable format:

```markdown
# Implementation Plan: <Feature / Goal Title>

## 1. Architectural Summary & Scope
<Concise technical overview of modified modules and dependency interactions>

## 2. Execution Checklist
- [ ] **Task 1: <Task Title>**
  - **Files:** `path/to/target_file.ext`
  - **Instructions:** <Precise step-by-step implementation instructions>
  - **Verification Command:** `<test or lint command, e.g. pytest tests/test_module.py>`
  - **Success Criteria:** `<Explicit exit code 0 or expected output>`

- [ ] **Task 2: <Task Title>**
  - **Files:** `path/to/second_file.ext`
  - **Instructions:** <Precise instructions>
  - **Verification Command:** `<test command>`
  - **Success Criteria:** `<Criteria>`

## 3. Final Verification
- **Global Command:** `pytest tests/`
- **Goal Definition:** All unit and integration tests pass without regression.
```

### 4.2 Agent Execution Loop & Anti-Loop Guardrails

```
             ┌──────────────────────────────────────────────┐
             │       AGENT parses `.assistant/plan.md`      │
             └──────────────────────┬───────────────────────┘
                                    │
                    [ Are all tasks marked [x]? ]
                     ├── YES ──► Run Final Global Verification
                     │           └── If Pass: Send GOAL_COMPLETED
                     └── NO
                         │
                         ▼
             ┌──────────────────────────────────────────────┐
             │ Locate First Incomplete Task: `- [ ] Task N` │
             ├──────────────────────────────────────────────┤
             │ 1. Read relevant code context                │
             │ 2. Apply surgical diff patch (`apply_patch`) │
             │ 3. Execute Verification Command              │
             └──────────────────────┬───────────────────────┘
                                    │
                          [ Verification Passed? ]
                           ├── YES ──► Mark `- [x] Task N` in plan.md
                           │           Reset retry counter -> Next Task
                           └── NO
                               │
                    [ Retry Count < 3? ]
                     ├── YES ──► Analyze stderr, increment retry, loop
                     └── NO  ──► Pause execution, trigger state switch
                                 to PLAN mode with failure summary
```

#### Deterministic Halting & Anti-Loop Safeguards:
1. **Action Idempotency Check:** Hash every tool invocation `(tool_name, args)`. If identical parameters are executed 2 consecutive times without workspace file mutations, force-halt the agent.
2. **Task Retry Bounding:** Maximum 3 automated fix attempts per task. If unresolved, stop and request human intervention.
3. **Hard Step Limit:** Configurable max step budget per user prompt (default: 20 tool iterations).

---

## 5. Context Lifecycle & Compaction Strategy

To prevent context exhaustion and model hallucination during long-running agent tasks:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        CONTEXT MEMORY SEGMENTATION                       │
├──────────────────────────────────────────────────────────────────────────┤
│ [TIER 1 - IMMUTABLE ANCHOR] System Prompt + Active `.assistant/plan.md`  │
├──────────────────────────────────────────────────────────────────────────┤
│ [TIER 2 - ROLLING SUMMARY]  Compressed history of prior completed tasks │
├──────────────────────────────────────────────────────────────────────────┤
│ [TIER 3 - TRANSIENT BUFFER] Truncated stdout/stderr logs of tests (±15L) │
├──────────────────────────────────────────────────────────────────────────┤
│ [TIER 4 - ACTIVE WINDOW]    Current Task Prompt, Code Snippets, Last Tool│
└──────────────────────────────────────────────────────────────────────────┘
```

* **Watermark Trigger:** When total context reaches **75% of max context window**:
  1. Truncate all previous `run_command` outputs to the first 5 lines and last 10 lines.
  2. Invoke Fast Router (`qwen2.5-coder:3b`) to compress completed interaction turns into a high-density rolling summary.
  3. Rebuild the prompt context retaining Tier 1, Tier 2, and Tier 4 intact.

---

## 6. Security Guardrails & Workspace Sandboxing

1. **Canonical Path Resolution (Anti-Path Traversal):**
   ```python
   def validate_path(target_path: str, workspace_root: str) -> str:
       resolved_target = os.path.realpath(os.path.abspath(target_path))
       resolved_root = os.path.realpath(os.path.abspath(workspace_root))
       if not resolved_target.startswith(resolved_root):
           raise PermissionError(f"Access denied: '{target_path}' is outside workspace root.")
       return resolved_target
   ```
2. **Sensitive File Deny-List:**
   Strictly block read and write calls to:
   - Credentials: `.env*`, `*.pem`, `*.key`, `id_rsa*`, `credentials.json`
   - Source control internals: `.git/*`
   - Heavy dependencies: `node_modules/*`, `.venv/*`, `target/*` (filtered from deep recursive reads)
3. **CLI Command Sandboxing:**
   - Blacklist destructive operations (`rm -rf /`, `mkfs`, `sudo`, `dd`).
   - Hard execution timeout: 30 seconds default (configurable per verification task).
   - Set execution working directory strictly to `workspace_root`.

---

## 7. Implementation Checklist for AI Agent

- [ ] **Phase 0: Workspace Analysis & Critical Audit**
  - **Action:** Inspect the workspace structure, existing dependencies, runtime environment, and available linters/test runners.
  - **Output:** Produce the Critical Audit Report (Risks, Trade-offs, Architectural Fit) and request human confirmation.

- [ ] **Phase 1: Core Type Definitions & State Machine (FSM)**
  - **Files:** `src/core/types.ts` (or `.py`), `src/core/state_machine.ts`
  - **Instructions:** Implement `AppMode` enum (`ASK`, `PLAN`, `AGENT`), permission validator, event dispatcher, and `AbortController` cancellation hooks.
  - **Verification:** Unit test state transitions and permission denials across modes.

- [ ] **Phase 2: Hardware Monitor & Ollama Model Manager**
  - **Files:** `src/engine/ollama_client.ts`, `src/engine/resource_manager.ts`
  - **Instructions:** Implement VRAM/RAM polling, dynamic model eviction (`keep_alive: 0`), and fallback routing between 3B, 7B, and 14B models.
  - **Verification:** Test simulated memory pressure and verify unload commands sent to Ollama API.

- [ ] **Phase 3: Tool Execution Engine & Security Sandboxing**
  - **Files:** `src/tools/file_tools.ts`, `src/tools/terminal_tools.ts`, `src/tools/patch_engine.ts`
  - **Instructions:** Implement `read_file_range`, `search_code`, `apply_diff_patch`, `save_plan`, and `run_command` with path jailing and timeout guards.
  - **Verification:** Test path traversal rejection (`../../etc/passwd`) and patch application accuracy.

- [ ] **Phase 4: Plan Parser & Agent TDD Execution Loop**
  - **Files:** `src/agent/plan_manager.ts`, `src/agent/execution_loop.ts`
  - **Instructions:** Implement markdown checklist parser (`- [ ]` / `- [x]`), automated test verification runner, 3-retry error recovery loop, and `GOAL_COMPLETED` notifier.
  - **Verification:** Run a mock 2-step task plan to completion; verify halting on test success and halting on max retries.

- [ ] **Phase 5: Context Lifecycle & Compactor Engine**
  - **Files:** `src/context/token_counter.ts`, `src/context/compactor.ts`
  - **Instructions:** Implement token threshold tracker (75% watermark), test output truncator, and rolling summarizer.
  - **Verification:** Feed a large mock conversation into compactor and verify token reduction while preserving anchors.

- [ ] **Phase 6: Integration & Global Verification**
  - **Files:** `src/index.ts` / Main application entrypoint
  - **Instructions:** Wire the UI/CLI interface, state transitions, tool execution, and Ollama bridge together.
  - **Verification:** Execute an end-to-end coding task across Ask, Plan, and Agent modes.
