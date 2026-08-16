"""
sidecar/services/agent_orchestration_service.py

Application / Service Layer — SLM Agent Orchestration

Implements the 3-Level Stratified Retry Escalation State Machine:

  Level 1 — Same model, corrective prompt injection, temperature=0.0
  Level 2 — Few-Shot forced template for the specific failing tool
  Level 3 — Graceful degradation: exit tool loop → linear RAG text response

Connects to Ollama local REST API (http://localhost:11434).
Max context window respected via ContextBudgeter from the Domain layer.
"""

from __future__ import annotations

import json
import logging
from enum import Enum, auto
from dataclasses import dataclass, field
from typing import Any

import httpx

from sidecar.domain.slm_agent import (
    ContextBudgeter,
    ContextMessage,
    ParsedToolCall,
    ParseFailure,
    ToolDefinition,
    ToolValidator,
    build_few_shot_corrective_prompt,
    build_system_prompt,
    parse_tool_call,
)

logger = logging.getLogger("PythonSidecar")

OLLAMA_BASE_URL = "http://localhost:11434"
OLLAMA_CHAT_ENDPOINT = f"{OLLAMA_BASE_URL}/api/chat"
OLLAMA_GENERATE_ENDPOINT = f"{OLLAMA_BASE_URL}/api/generate"

# ---------------------------------------------------------------------------
# State Machine Types
# ---------------------------------------------------------------------------

class EscalationLevel(Enum):
    NONE = auto()
    LEVEL_1_CORRECTIVE = auto()
    LEVEL_2_FEW_SHOT = auto()
    LEVEL_3_DEGRADED = auto()


@dataclass
class OrchestrationResult:
    """Final result returned to the FastAPI presentation layer."""
    success: bool
    tool_name: str | None
    arguments: dict[str, Any] | None
    text_response: str | None           # populated on L3 degradation
    escalation_level: str               # "NONE" | "L1" | "L2" | "L3_DEGRADED"
    error_detail: str | None = None
    attempts: int = 0


@dataclass
class OrchestrationRequest:
    model: str                                      # e.g. "qwen2.5:7b"
    user_message: str
    tools: list[ToolDefinition]
    history: list[ContextMessage] = field(default_factory=list)
    rag_context: str | None = None
    max_context_tokens: int = 4096
    max_retries: int = 3                            # total L1+L2 budget
    few_shot_examples: dict[str, dict[str, Any]] = field(default_factory=dict)
    # Optional tool executor callback: fn(tool_name, arguments) -> str
    tool_executor: Any | None = None


# ---------------------------------------------------------------------------
# Ollama Adapter (Sync — runs in asyncio.to_thread from FastAPI endpoint)
# ---------------------------------------------------------------------------

class OllamaAdapter:
    """
    Thin synchronous wrapper for Ollama /api/chat.
    Keeps a persistent httpx.Client for connection pooling.
    """

    def __init__(self, timeout: float = 120.0) -> None:
        self._client = httpx.Client(timeout=timeout)

    def chat(
        self,
        model: str,
        messages: list[dict[str, str]],
        temperature: float = 0.7,
        top_p: float = 0.9,
    ) -> str:
        """
        Sends a chat request to Ollama and returns the assistant content string.
        Raises httpx.HTTPError on network or HTTP failures.
        """
        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": temperature,
                "top_p": top_p,
                "num_predict": 512,
            },
        }
        logger.debug("OllamaAdapter: POST %s model=%s temp=%.2f", OLLAMA_CHAT_ENDPOINT, model, temperature)
        resp = self._client.post(OLLAMA_CHAT_ENDPOINT, json=payload)
        resp.raise_for_status()
        data = resp.json()
        content = data.get("message", {}).get("content", "")
        if not content:
            logger.warning("OllamaAdapter: received empty response from model '%s'.", model)
        return content

    def close(self) -> None:
        self._client.close()


# ---------------------------------------------------------------------------
# Corrective Prompt Builders (Levels 1 & 2)
# ---------------------------------------------------------------------------

def _build_l1_corrective_message(failure: ParseFailure, original_output: str) -> str:
    """Level-1: return exact error details to the model for self-correction."""
    return (
        "Your previous response was NOT valid JSON.\n"
        f"EXACT ERROR: {failure.reason} — {failure.detail}\n"
        f"YOUR PREVIOUS OUTPUT: {original_output[:300]}\n\n"
        "Correct your output now. Respond ONLY with the JSON object. No prose."
    )


def _build_l3_degraded_message(
    user_message: str,
    rag_context: str | None,
    failure_summary: str,
) -> str:
    """Level-3: plain question for the model to answer as pure text RAG."""
    context_block = ""
    if rag_context:
        context_block = f"\n\nCONTEXT:\n{rag_context[:2000]}"
    return (
        f"Tool execution failed after multiple attempts: {failure_summary}\n"
        f"Answer the following as a helpful assistant using only the provided context "
        f"(no tool calls):{context_block}\n\nQUESTION: {user_message}"
    )


# ---------------------------------------------------------------------------
# 3-Level Retry Escalation State Machine
# ---------------------------------------------------------------------------

class AgentOrchestrationService:
    """
    Orchestrates the SLM agent loop with a 3-level stratified retry
    escalation state machine.

    Usage:
        service = AgentOrchestrationService()
        result = service.run(request)   # blocking; call via asyncio.to_thread
    """

    def __init__(self, ollama: OllamaAdapter | None = None) -> None:
        self._ollama = ollama or OllamaAdapter()

    # ------------------------------------------------------------------
    # Public Entry Point
    # ------------------------------------------------------------------

    def run(self, req: OrchestrationRequest) -> OrchestrationResult:
        """
        Execute the full orchestration loop for a single user turn.
        Returns OrchestrationResult to the presentation layer.
        """
        validator = ToolValidator(req.tools)
        budgeter = ContextBudgeter(req.max_context_tokens)
        system_prompt = build_system_prompt(req.tools)

        system_msg = ContextMessage(role="system", content=system_prompt)
        tool_defs_msg = ContextMessage(role="system", content="")   # already in system prompt
        rag_msg = ContextMessage(role="user", content=f"CONTEXT:\n{req.rag_context}") if req.rag_context else None
        history = list(req.history)

        # Add current user turn to history
        history.append(ContextMessage(role="user", content=req.user_message))

        failure: ParseFailure | None = None
        last_raw_output = ""
        escalation = EscalationLevel.NONE

        for attempt in range(1, req.max_retries + 2):  # +2 → allow L1, L2, then L3 path
            messages = budgeter.budget_messages(system_msg, tool_defs_msg, rag_msg, history)
            ollama_messages = [{"role": m.role, "content": m.content} for m in messages]

            # --- Determine temperature for this attempt ---
            temperature = 0.0 if escalation == EscalationLevel.LEVEL_1_CORRECTIVE else 0.7

            try:
                raw_output = self._ollama.chat(
                    model=req.model,
                    messages=ollama_messages,
                    temperature=temperature,
                )
            except httpx.HTTPError as exc:
                logger.error("OllamaAdapter HTTP error on attempt %d: %s", attempt, exc)
                failure = ParseFailure(
                    reason="OLLAMA_HTTP_ERROR",
                    raw_output="",
                    detail=str(exc),
                )
                break  # skip to L3

            last_raw_output = raw_output

            # --- Parse SLM output ---
            parse_result = parse_tool_call(raw_output)

            if isinstance(parse_result, ParseFailure):
                failure = parse_result
                logger.warning("Attempt %d parse failure: %s — %s", attempt, failure.reason, failure.detail)
                escalation, history = self._escalate(
                    escalation, failure, last_raw_output, req, history
                )
                if escalation == EscalationLevel.LEVEL_3_DEGRADED:
                    break
                continue

            # --- Validate against registered tools ---
            validated = validator.validate(parse_result)

            if isinstance(validated, ParseFailure):
                failure = validated
                logger.warning("Attempt %d validation failure: %s — %s", attempt, failure.reason, failure.detail)
                escalation, history = self._escalate(
                    escalation, failure, last_raw_output, req, history
                )
                if escalation == EscalationLevel.LEVEL_3_DEGRADED:
                    break
                continue

            # --- SUCCESS: tool call is valid ---
            logger.info(
                "Orchestration SUCCESS on attempt %d (escalation=%s): tool='%s'",
                attempt, escalation.name, validated.tool_name,
            )
            return OrchestrationResult(
                success=True,
                tool_name=validated.tool_name,
                arguments=validated.arguments,
                text_response=None,
                escalation_level=_escalation_label(escalation),
                attempts=attempt,
            )

        # ----------------------------------------------------------------
        # LEVEL 3 — Graceful Degradation to pure text RAG response
        # ----------------------------------------------------------------
        logger.error(
            "Orchestration: entering Level-3 graceful degradation after %d attempts.",
            attempt,
        )
        failure_summary = failure.detail if failure else "Unknown failure after max retries."
        degraded_prompt = _build_l3_degraded_message(
            user_message=req.user_message,
            rag_context=req.rag_context,
            failure_summary=failure_summary,
        )
        try:
            text_answer = self._ollama.chat(
                model=req.model,
                messages=[
                    {"role": "system", "content": "You are a helpful assistant. Answer concisely from the context provided. No JSON."},
                    {"role": "user", "content": degraded_prompt},
                ],
                temperature=0.3,
            )
        except httpx.HTTPError as exc:
            text_answer = f"[Agent Studio degraded: unable to reach Ollama. {exc}]"

        return OrchestrationResult(
            success=False,
            tool_name=None,
            arguments=None,
            text_response=text_answer,
            escalation_level="L3_DEGRADED",
            error_detail=failure_summary,
            attempts=attempt,
        )

    # ------------------------------------------------------------------
    # Private Helpers
    # ------------------------------------------------------------------

    def _escalate(
        self,
        current: EscalationLevel,
        failure: ParseFailure,
        last_raw: str,
        req: OrchestrationRequest,
        history: list[ContextMessage],
    ) -> tuple[EscalationLevel, list[ContextMessage]]:
        """
        Advance the state machine and inject the appropriate corrective
        message into the conversation history.
        """
        if current == EscalationLevel.NONE:
            # → Level 1: corrective prompt, temperature=0.0 on next call
            corrective = _build_l1_corrective_message(failure, last_raw)
            history.append(ContextMessage(role="user", content=corrective))
            logger.info("Escalation → Level 1 (corrective prompt, temp=0.0).")
            return EscalationLevel.LEVEL_1_CORRECTIVE, history

        if current == EscalationLevel.LEVEL_1_CORRECTIVE:
            # → Level 2: few-shot template injection for the failing tool
            tool_name_hint = self._guess_intended_tool(failure, req.tools)
            tool_def = next((t for t in req.tools if t.name == tool_name_hint), None)
            example_args = req.few_shot_examples.get(tool_name_hint or "", {})

            if tool_def and example_args:
                few_shot_prompt = build_few_shot_corrective_prompt(
                    tool_def=tool_def,
                    failure=failure,
                    input_description=req.user_message[:120],
                    example_args=example_args,
                )
            else:
                few_shot_prompt = (
                    f"FINAL ATTEMPT. Error: {failure.detail}\n"
                    "Output a valid JSON tool call NOW. No prose."
                )
            history.append(ContextMessage(role="user", content=few_shot_prompt))
            logger.info("Escalation → Level 2 (few-shot forced template).")
            return EscalationLevel.LEVEL_2_FEW_SHOT, history

        # Level 2 also failed → Level 3
        logger.error("Escalation → Level 3 (graceful RAG degradation).")
        return EscalationLevel.LEVEL_3_DEGRADED, history

    @staticmethod
    def _guess_intended_tool(
        failure: ParseFailure,
        tools: list[ToolDefinition],
    ) -> str | None:
        """
        Best-effort: infer which tool the model was trying to call
        based on substrings in the failure detail or raw output.
        """
        combined = (failure.detail + " " + failure.raw_output).lower()
        for tool in tools:
            if tool.name.lower() in combined:
                return tool.name
        return tools[0].name if tools else None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _escalation_label(level: EscalationLevel) -> str:
    labels = {
        EscalationLevel.NONE: "NONE",
        EscalationLevel.LEVEL_1_CORRECTIVE: "L1",
        EscalationLevel.LEVEL_2_FEW_SHOT: "L2",
        EscalationLevel.LEVEL_3_DEGRADED: "L3_DEGRADED",
    }
    return labels.get(level, "UNKNOWN")
