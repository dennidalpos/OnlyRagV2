"""
sidecar/domain/slm_agent.py

Domain Layer — SLM Agent Studio Core

Responsibilities:
  - CoT / thinking-tag pre-stripping
  - Defensive multi-stage regex-fallback JSON parsing
  - Tool schema validation with missing-parameter auto-fill
  - Context window budgeting (context stripping)
  - SLM-optimized System Prompt construction

Compatible models: Qwen-2.5-7B, Llama-3-8B, Phi-3, Mistral-7B and
any vanilla Ollama model that does NOT expose native function-calling APIs.
"""

from __future__ import annotations

import json
import re
import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("PythonSidecar")

# ---------------------------------------------------------------------------
# Data Contracts (pure domain types — no FastAPI / Pydantic deps)
# ---------------------------------------------------------------------------

@dataclass
class ToolDefinition:
    """Describes a tool available to the SLM agent."""
    name: str
    description: str
    parameters: dict[str, Any]    # JSON-Schema-like object
    required: list[str] = field(default_factory=list)
    defaults: dict[str, Any] = field(default_factory=dict)


@dataclass
class ParsedToolCall:
    """Result of a successful tool extraction from SLM output."""
    tool_name: str
    arguments: dict[str, Any]
    raw_fragment: str             # the raw string slice that was parsed


@dataclass
class ParseFailure:
    """Structured failure with reason code for retry escalation logic."""
    reason: str
    raw_output: str
    detail: str = ""


@dataclass
class ContextMessage:
    role: str   # "system" | "user" | "assistant"
    content: str


# ---------------------------------------------------------------------------
# 1. CoT / Thinking-Tag Pre-stripper
# ---------------------------------------------------------------------------

# Matches <think>...</think>, <thought>...</thought>, <reasoning>...</reasoning>
# Handles multi-line, greedy-off. Also handles unclosed tags.
_COT_TAG_RE = re.compile(
    r"<(think|thought|reasoning|scratchpad)>.*?</\1>|<(think|thought|reasoning|scratchpad)>[^<]*",
    re.DOTALL | re.IGNORECASE,
)

# Unclosed fenced code blocks (``` with no closing ```)
_UNCLOSED_FENCE_RE = re.compile(r"```[^\n]*\n(.*?)(?:```|$)", re.DOTALL)


def strip_cot_tags(text: str) -> str:
    """
    Remove Chain-of-Thought reasoning blocks that SLMs may emit before
    the actual JSON tool call. Also removes unclosed markdown fences.
    """
    text = _COT_TAG_RE.sub("", text)
    # Replace fenced blocks with just their inner content (safe to keep)
    text = _UNCLOSED_FENCE_RE.sub(r"\1", text)
    return text.strip()


# ---------------------------------------------------------------------------
# 2. Defensive Regex-Fallback JSON Parser (Multi-Stage)
# ---------------------------------------------------------------------------

# Stage 1: strict JSON object
_JSON_OBJECT_RE = re.compile(r"\{.*?\}", re.DOTALL)
# Stage 2: lenient — captures outermost braces even with nested structure
_JSON_OUTER_RE = re.compile(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)?\}", re.DOTALL)
# Stage 3: tool_name + arguments individually
_TOOL_NAME_RE = re.compile(
    r'"tool(?:_name|_call|Name)"?\s*[=:]\s*"([A-Za-z_][A-Za-z0-9_]*)"',
    re.IGNORECASE,
)
_ARGUMENTS_RE = re.compile(r'"arguments?"\s*:\s*(\{[^}]*\})', re.DOTALL)
# Stage 4: key=value free text fallback
_KV_PAIR_RE = re.compile(r'([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*"([^"]*)"')


def _attempt_json_parse(candidate: str) -> dict[str, Any] | None:
    """Try to parse a candidate string as JSON; return None on failure."""
    # Fix common SLM JSON malformations:
    # 1. Trailing commas before } or ]
    candidate = re.sub(r",\s*([}\]])", r"\1", candidate)
    # 2. Single-quoted strings → double-quoted
    candidate = re.sub(r"(?<=[{,\[:\s])'([^']*?)'", r'"\1"', candidate)
    # 3. Unescaped newlines inside string values
    candidate = re.sub(r'(?<=": ")(.*?)(?=")', lambda m: m.group(0).replace("\n", "\\n"), candidate)
    try:
        return json.loads(candidate)
    except (json.JSONDecodeError, ValueError):
        return None


def parse_tool_call(raw_output: str) -> ParsedToolCall | ParseFailure:
    """
    Multi-stage defensive parser. Extracts tool name and arguments from
    arbitrary SLM output including free text, markdown, or truncated JSON.

    Stages (in order):
      S1  Strip CoT tags → standard JSON load
      S2  All JSON objects in text → validate schema
      S3  Regex extract tool_name + arguments
      S4  Key-value free text extraction
    """
    stripped = strip_cot_tags(raw_output)

    # Stage 1 — direct parse of the stripped output
    parsed = _attempt_json_parse(stripped)
    if parsed and "tool_name" in parsed:
        return ParsedToolCall(
            tool_name=parsed["tool_name"],
            arguments=parsed.get("arguments", {}),
            raw_fragment=stripped,
        )

    # Stage 2 — scan for all JSON objects embedded in text
    for match in _JSON_OBJECT_RE.finditer(stripped):
        candidate = match.group(0)
        parsed = _attempt_json_parse(candidate)
        if parsed and "tool_name" in parsed:
            return ParsedToolCall(
                tool_name=parsed["tool_name"],
                arguments=parsed.get("arguments", {}),
                raw_fragment=candidate,
            )
    # Try lenient outer-brace pattern
    for match in _JSON_OUTER_RE.finditer(stripped):
        candidate = match.group(0)
        parsed = _attempt_json_parse(candidate)
        if parsed and "tool_name" in parsed:
            return ParsedToolCall(
                tool_name=parsed["tool_name"],
                arguments=parsed.get("arguments", {}),
                raw_fragment=candidate,
            )

    # Stage 3 — extract tool_name and arguments separately via regex
    tool_match = _TOOL_NAME_RE.search(stripped)
    args_match = _ARGUMENTS_RE.search(stripped)
    if tool_match:
        tool_name = tool_match.group(1)
        arguments: dict[str, Any] = {}
        if args_match:
            args_parsed = _attempt_json_parse(args_match.group(1))
            arguments = args_parsed if isinstance(args_parsed, dict) else {}
        logger.warning("SLM parser: Stage-3 regex extraction used for tool '%s'.", tool_name)
        return ParsedToolCall(
            tool_name=tool_name,
            arguments=arguments,
            raw_fragment=stripped,
        )

    # Stage 4 — last-resort: key=value extraction from free text
    kv_pairs = dict(_KV_PAIR_RE.findall(stripped))
    if "tool_name" in kv_pairs:
        logger.warning("SLM parser: Stage-4 KV fallback extraction used.")
        return ParsedToolCall(
            tool_name=kv_pairs.pop("tool_name"),
            arguments=kv_pairs,
            raw_fragment=stripped,
        )

    return ParseFailure(
        reason="NO_TOOL_FOUND",
        raw_output=raw_output,
        detail="All 4 parsing stages failed. No tool_name detected in SLM output.",
    )


# ---------------------------------------------------------------------------
# 3. Tool Validator — auto-fill defaults, hallucination detection
# ---------------------------------------------------------------------------

class ToolValidator:
    """
    Validates a ParsedToolCall against registered ToolDefinitions.
    Handles:
      - Unknown / hallucinated tools
      - Missing required parameters (returns structured error)
      - Missing optional parameters (auto-filled from defaults)
    """

    def __init__(self, tools: list[ToolDefinition]) -> None:
        self._registry: dict[str, ToolDefinition] = {t.name: t for t in tools}

    def validate(self, call: ParsedToolCall) -> ParsedToolCall | ParseFailure:
        tool_def = self._registry.get(call.tool_name)
        if tool_def is None:
            known = ", ".join(self._registry.keys())
            return ParseFailure(
                reason="UNKNOWN_TOOL",
                raw_output=call.raw_fragment,
                detail=(
                    f"Model requested tool '{call.tool_name}' which does not exist. "
                    f"Available tools: [{known}]."
                ),
            )

        args = dict(call.arguments)

        # Auto-fill optional parameters from defaults
        for param_name, default_value in tool_def.defaults.items():
            if param_name not in args:
                args[param_name] = default_value
                logger.debug("SLM validator: auto-filled '%s'='%s' for tool '%s'.",
                             param_name, default_value, call.tool_name)

        # Check required parameters remain missing
        missing = [p for p in tool_def.required if p not in args]
        if missing:
            return ParseFailure(
                reason="MISSING_REQUIRED_PARAMS",
                raw_output=call.raw_fragment,
                detail=(
                    f"Tool '{call.tool_name}' missing required params: {missing}. "
                    f"Provided: {list(args.keys())}."
                ),
            )

        return ParsedToolCall(
            tool_name=call.tool_name,
            arguments=args,
            raw_fragment=call.raw_fragment,
        )


# ---------------------------------------------------------------------------
# 4. Context Window Budgeter (Context Stripper)
# ---------------------------------------------------------------------------

# Approximate chars-per-token ratio for SLMs (conservative estimate)
_CHARS_PER_TOKEN: float = 3.8


def _estimate_tokens(text: str) -> int:
    return max(1, int(len(text) / _CHARS_PER_TOKEN))


def _estimate_message_tokens(msg: ContextMessage) -> int:
    return _estimate_tokens(msg.role) + _estimate_tokens(msg.content) + 4  # role overhead


class ContextBudgeter:
    """
    Strips older conversation turns to fit within the model's context window.

    Budget allocation (matching SKILL.md P1-P4 tiers):
      P1  system_prompt                     — never stripped  (25%)
      P2  tool_definitions                  — never stripped  (25%)
      P3  active_rag_docs                   — stripped last   (25%)
      P4  conversation history              — stripped first  (25%)

    Hard maximum kept history turns: 8 (per SKILL.md spec).
    """

    MAX_HISTORY_TURNS: int = 8

    def __init__(self, max_context_tokens: int = 4096) -> None:
        self.max_context_tokens = max_context_tokens
        # Reserve 40% for P1+P2 (system + tool defs) and 10% for response headroom
        self._history_budget = int(max_context_tokens * 0.50)
        self._rag_budget = int(max_context_tokens * 0.25)

    def budget_messages(
        self,
        system_msg: ContextMessage,
        tool_defs_msg: ContextMessage,
        rag_ctx_msg: ContextMessage | None,
        history: list[ContextMessage],
    ) -> list[ContextMessage]:
        """
        Returns ordered message list that fits within context budget.
        Strips history oldest-first; then trims RAG context if still over budget.
        """
        # P1 + P2 always included
        output: list[ContextMessage] = [system_msg, tool_defs_msg]

        # P4 — cap history turns and trim oldest first until within budget
        capped_history = history[-self.MAX_HISTORY_TURNS:]
        while capped_history:
            hist_tokens = sum(_estimate_message_tokens(m) for m in capped_history)
            if hist_tokens <= self._history_budget:
                break
            capped_history = capped_history[1:]  # drop oldest
            logger.debug("ContextBudgeter: dropped oldest history turn.")

        # P3 — include RAG context if budget allows after history
        if rag_ctx_msg:
            rag_tokens = _estimate_message_tokens(rag_ctx_msg)
            if rag_tokens <= self._rag_budget:
                output.append(rag_ctx_msg)
            else:
                # Trim RAG content to fit
                max_rag_chars = int(self._rag_budget * _CHARS_PER_TOKEN)
                trimmed = rag_ctx_msg.content[:max_rag_chars] + "\n...[RAG context trimmed]"
                output.append(ContextMessage(role=rag_ctx_msg.role, content=trimmed))
                logger.warning("ContextBudgeter: RAG context trimmed to %d chars.", max_rag_chars)

        output.extend(capped_history)
        return output


# ---------------------------------------------------------------------------
# 5. SLM-Optimized System Prompt Builder
# ---------------------------------------------------------------------------

_TOOL_SCHEMA_TEMPLATE = """\
TOOL: {name}
DESC: {description}
PARAMS (JSON): {params_json}
REQUIRED: {required}\
"""

_SYSTEM_PROMPT_TEMPLATE = """\
You are a local AI coding agent. Respond ONLY with a valid JSON object. No prose.

FORMAT:
{{"tool_name": "<tool>", "arguments": {{<params>}}}}

RULES:
1. Use ONLY tools listed below. Never invent tools.
2. All required params must be present. Never omit them.
3. Output a single JSON object. No markdown. No explanation.
4. If no tool is needed, output: {{"tool_name": "finish", "arguments": {{"result": "<answer>"}}}}

TOOLS:
{tools_block}\
"""

_FEW_SHOT_EXAMPLE_TEMPLATE = """\
EXAMPLE for tool '{tool_name}':
INPUT: {input_description}
OUTPUT:
{{"tool_name": "{tool_name}", "arguments": {example_args_json}}}\
"""


def build_system_prompt(tools: list[ToolDefinition]) -> str:
    """
    Builds a hyper-concise, imperative system prompt for SLMs (<7B).
    Strips all hedging language, avoids markdown headers, uses short
    numbered rules to maximize instruction-following on small models.
    """
    tool_lines = []
    for t in tools:
        tool_lines.append(
            _TOOL_SCHEMA_TEMPLATE.format(
                name=t.name,
                description=t.description,
                params_json=json.dumps(t.parameters, separators=(",", ":")),
                required=json.dumps(t.required),
            )
        )
    return _SYSTEM_PROMPT_TEMPLATE.format(tools_block="\n\n".join(tool_lines))


def build_few_shot_corrective_prompt(
    tool_def: ToolDefinition,
    failure: ParseFailure,
    input_description: str,
    example_args: dict[str, Any],
) -> str:
    """
    Builds a Level-2 escalation Few-Shot corrective prompt injected into
    the conversation when Level-1 self-correction fails.
    """
    example_block = _FEW_SHOT_EXAMPLE_TEMPLATE.format(
        tool_name=tool_def.name,
        input_description=input_description,
        example_args_json=json.dumps(example_args, separators=(",", ":")),
    )
    return (
        f"Your previous response was invalid.\n"
        f"ERROR: {failure.detail}\n\n"
        f"{example_block}\n\n"
        f"Now repeat EXACTLY the same format for the current task."
    )
