"""
sidecar/tests/test_agent_slm.py

Unit tests for the SLM Agent Studio Orchestrator modules:
  - CoT tag stripping
  - Defensive regex-fallback JSON parsing (all 4 stages)
  - Tool validation: auto-fill, missing required, hallucinated tool
  - Context window budgeter
  - Log analyzer anomaly detectors
  - 3-Level retry escalation state machine (Level 1, 2, 3)
"""

from __future__ import annotations

import os
import sys
import tempfile
import json
from unittest.mock import MagicMock, patch

import pytest

# Ensure root workspace is resolvable
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from sidecar.domain.slm_agent import (
    ContextBudgeter,
    ContextMessage,
    ParsedToolCall,
    ParseFailure,
    ToolDefinition,
    ToolValidator,
    build_system_prompt,
    parse_tool_call,
    strip_cot_tags,
)
from sidecar.domain.log_analyzer import (
    LogAnalyzer,
    _detect_tool_loops,
    _detect_truncated_json,
    _detect_vram_thrashing,
)
from sidecar.domain.slm_tool_registry import (
    get_all_tool_definitions,
    get_few_shot_examples,
    get_tool_by_name,
    get_tool_input_descriptions,
)
from sidecar.services.agent_orchestration_service import (
    AgentOrchestrationService,
    OllamaAdapter,
    OrchestrationRequest,
)
from fastapi.testclient import TestClient
from sidecar.main import app as fastapi_app


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_tool(
    name: str = "read_file",
    required: list[str] | None = None,
    defaults: dict | None = None,
) -> ToolDefinition:
    return ToolDefinition(
        name=name,
        description=f"Execute {name}.",
        parameters={"path": {"type": "string"}, "encoding": {"type": "string"}},
        required=required if required is not None else ["path"],
        defaults=defaults if defaults is not None else {"encoding": "utf-8"},
    )


# ---------------------------------------------------------------------------
# 1. CoT Tag Stripping
# ---------------------------------------------------------------------------

class TestCotTagStripping:
    def test_strips_think_tags(self):
        raw = "<think>Let me reason step by step...</think>\n{\"tool_name\": \"read_file\", \"arguments\": {\"path\": \"/a.py\"}}"
        result = strip_cot_tags(raw)
        assert "<think>" not in result
        assert "read_file" in result

    def test_strips_reasoning_tags(self):
        raw = "<reasoning>Complex analysis...</reasoning>\n{\"tool_name\": \"finish\"}"
        result = strip_cot_tags(raw)
        assert "<reasoning>" not in result
        assert "finish" in result

    def test_strips_unclosed_think_tag(self):
        raw = "<think>I should call write_file here... {\"tool_name\": \"write_file\", \"arguments\": {}}"
        result = strip_cot_tags(raw)
        assert "<think>" not in result

    def test_no_cot_tags_unchanged_content(self):
        raw = "{\"tool_name\": \"grep_search\", \"arguments\": {\"query\": \"hello\"}}"
        result = strip_cot_tags(raw)
        assert "grep_search" in result

    def test_strips_scratchpad_tags(self):
        raw = "<scratchpad>Working through the problem.</scratchpad>{\"tool_name\": \"list_dir\", \"arguments\": {}}"
        result = strip_cot_tags(raw)
        assert "<scratchpad>" not in result
        assert "list_dir" in result


# ---------------------------------------------------------------------------
# 2. Defensive Regex-Fallback Parser
# ---------------------------------------------------------------------------

class TestToolParser:
    def test_stage1_clean_json(self):
        raw = "{\"tool_name\": \"read_file\", \"arguments\": {\"path\": \"/app.py\"}}"
        result = parse_tool_call(raw)
        assert isinstance(result, ParsedToolCall)
        assert result.tool_name == "read_file"
        assert result.arguments["path"] == "/app.py"

    def test_stage1_cot_prefix_stripped(self):
        raw = "<think>I need to read the file</think>{\"tool_name\": \"read_file\", \"arguments\": {\"path\": \"/x.py\"}}"
        result = parse_tool_call(raw)
        assert isinstance(result, ParsedToolCall)
        assert result.tool_name == "read_file"

    def test_stage2_json_embedded_in_prose(self):
        raw = "Sure! I'll do that. Here is my tool call: {\"tool_name\": \"list_dir\", \"arguments\": {\"path\": \"/src\"}} That's it!"
        result = parse_tool_call(raw)
        assert isinstance(result, ParsedToolCall)
        assert result.tool_name == "list_dir"

    def test_stage1_trailing_comma_fixed(self):
        raw = "{\"tool_name\": \"write_file\", \"arguments\": {\"path\": \"/out.txt\", \"content\": \"hello\",}}"
        result = parse_tool_call(raw)
        assert isinstance(result, ParsedToolCall)
        assert result.tool_name == "write_file"

    def test_stage3_regex_tool_name_only(self):
        raw = 'I want to call "tool_name": "grep_search" with some args "arguments": {"query": "main"}'
        result = parse_tool_call(raw)
        assert isinstance(result, ParsedToolCall)
        assert result.tool_name == "grep_search"

    def test_all_stages_fail_returns_failure(self):
        raw = "I have no idea what to do here. Let me think more."
        result = parse_tool_call(raw)
        assert isinstance(result, ParseFailure)
        assert result.reason == "NO_TOOL_FOUND"

    def test_single_quote_json_fixed(self):
        raw = "{'tool_name': 'read_file', 'arguments': {'path': '/x.py'}}"
        result = parse_tool_call(raw)
        assert isinstance(result, ParsedToolCall)
        assert result.tool_name == "read_file"


# ---------------------------------------------------------------------------
# 3. Tool Validator
# ---------------------------------------------------------------------------

class TestToolValidator:
    def setup_method(self):
        self.tool = _make_tool("read_file", required=["path"], defaults={"encoding": "utf-8"})
        self.validator = ToolValidator([self.tool])

    def test_valid_call_passes(self):
        call = ParsedToolCall("read_file", {"path": "/app.py"}, "")
        result = self.validator.validate(call)
        assert isinstance(result, ParsedToolCall)
        assert result.arguments["encoding"] == "utf-8"   # default auto-filled

    def test_autofill_optional_default(self):
        call = ParsedToolCall("read_file", {"path": "/main.py"}, "")
        result = self.validator.validate(call)
        assert isinstance(result, ParsedToolCall)
        assert result.arguments.get("encoding") == "utf-8"

    def test_missing_required_param_returns_failure(self):
        call = ParsedToolCall("read_file", {}, "")
        result = self.validator.validate(call)
        assert isinstance(result, ParseFailure)
        assert result.reason == "MISSING_REQUIRED_PARAMS"
        assert "path" in result.detail

    def test_hallucinated_tool_returns_failure(self):
        call = ParsedToolCall("nonexistent_tool", {"x": 1}, "")
        result = self.validator.validate(call)
        assert isinstance(result, ParseFailure)
        assert result.reason == "UNKNOWN_TOOL"
        assert "read_file" in result.detail  # known tools listed in error


# ---------------------------------------------------------------------------
# 4. Context Window Budgeter
# ---------------------------------------------------------------------------

class TestContextBudgeter:
    def _make_msg(self, role: str, content: str) -> ContextMessage:
        return ContextMessage(role=role, content=content)

    def test_history_capped_at_8_turns(self):
        budgeter = ContextBudgeter(max_context_tokens=32000)
        system = self._make_msg("system", "You are an agent.")
        tools = self._make_msg("system", "")
        history = [self._make_msg("user", f"msg {i}") for i in range(20)]
        result = budgeter.budget_messages(system, tools, None, history)
        # Count only user/assistant history msgs (not system)
        hist_msgs = [m for m in result if m.role != "system"]
        assert len(hist_msgs) <= 8

    def test_empty_history_passes_through(self):
        budgeter = ContextBudgeter()
        system = self._make_msg("system", "SYS")
        tools = self._make_msg("system", "")
        result = budgeter.budget_messages(system, tools, None, [])
        roles = [m.role for m in result]
        assert "system" in roles

    def test_rag_context_included_when_within_budget(self):
        budgeter = ContextBudgeter(max_context_tokens=8192)
        system = self._make_msg("system", "SYS")
        tools = self._make_msg("system", "")
        rag = self._make_msg("user", "Short RAG context.")
        result = budgeter.budget_messages(system, tools, rag, [])
        contents = [m.content for m in result]
        assert any("RAG" in c for c in contents)

    def test_oversized_rag_context_is_trimmed(self):
        budgeter = ContextBudgeter(max_context_tokens=512)
        system = self._make_msg("system", "SYS")
        tools = self._make_msg("system", "")
        big_rag = self._make_msg("user", "X" * 5000)
        result = budgeter.budget_messages(system, tools, big_rag, [])
        rag_msgs = [m for m in result if "RAG context trimmed" in m.content]
        assert rag_msgs, "Expected trimmed RAG context message"


# ---------------------------------------------------------------------------
# 5. Log Analyzer Anomaly Detectors
# ---------------------------------------------------------------------------

class TestLogAnalyzerDetectors:
    def test_detects_truncated_json(self):
        lines = ['{"tool_name": "read_file", "arguments": {"path": "/very/long/path/that/continues' + "x" * 60]
        records = _detect_truncated_json(lines, "test.log")
        assert any(r.anomaly_type == "TRUNCATED_JSON" for r in records)

    def test_no_truncated_json_on_valid_line(self):
        lines = ['{"tool_name": "finish", "arguments": {"result": "done"}}']
        records = _detect_truncated_json(lines, "test.log")
        assert len(records) == 0

    def test_detects_cuda_oom_vram_thrash(self):
        lines = ["[ERROR] CUDA out of memory. Tried to allocate 2.00 GiB"]
        records = _detect_vram_thrashing(lines, "test.log")
        assert any("CUDA_OOM" in r.anomaly_type for r in records)
        assert any(r.severity == "CRITICAL" for r in records)

    def test_detects_empty_response_vram_thrash(self):
        lines = ['{"model": "qwen2.5:7b", "response": "", "done": true}']
        records = _detect_vram_thrashing(lines, "test.log")
        assert any("EMPTY_RESPONSE" in r.anomaly_type for r in records)

    def test_detects_gateway_timeout(self):
        lines = ["[WARN] HTTP 504 Gateway Timeout calling Ollama API"]
        records = _detect_vram_thrashing(lines, "test.log")
        assert any("GATEWAY_TIMEOUT" in r.anomaly_type for r in records)

    def test_detects_tool_calling_loop(self):
        # Repeat the same tool call 4 times in a 30-line window
        lines = [f'Step {i}: {{"tool_name": "list_dir", "arguments": {{}}}}' for i in range(4)]
        lines += ["other log line"] * 26
        records = _detect_tool_loops(lines, "test.log")
        assert any(r.anomaly_type == "TOOL_LOOP" for r in records)
        assert any(r.severity == "CRITICAL" for r in records)

    def test_no_loop_on_distinct_tools(self):
        tools = ["read_file", "write_file", "grep_search", "list_dir"]
        lines = [f'{{"tool_name": "{t}", "arguments": {{}}}}' for t in tools]
        records = _detect_tool_loops(lines, "test.log")
        assert len(records) == 0

    def test_full_analyzer_with_temp_log_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = os.path.join(tmpdir, "sidecar.log")
            log_content = (
                "[ERROR] CUDA out of memory. Tried to allocate 4.00 GiB\n"
                '{"tool_name": "list_dir", "arguments": {}}\n' * 4
            )
            with open(log_path, "w") as f:
                f.write(log_content)

            analyzer = LogAnalyzer(extra_paths=[tmpdir])
            report = analyzer.analyze()

            assert log_path in report.scanned_files
            assert report.total_lines_scanned > 0
            assert len(report.anomalies) > 0
            assert report.has_critical


# ---------------------------------------------------------------------------
# 6. Orchestration Service — 3-Level State Machine (mocked Ollama)
# ---------------------------------------------------------------------------

def _make_orchestration_request(
    tool_name: str = "read_file",
    mock_response: str | None = None,
) -> tuple[OrchestrationRequest, MagicMock]:
    tools = [_make_tool(tool_name)]
    mock_ollama = MagicMock(spec=OllamaAdapter)
    if mock_response is not None:
        mock_ollama.chat.return_value = mock_response

    req = OrchestrationRequest(
        model="qwen2.5:7b",
        user_message="Read /app.py and summarize it.",
        tools=tools,
        few_shot_examples={
            tool_name: {"path": "/example.py", "encoding": "utf-8"}
        },
    )
    return req, mock_ollama


class TestOrchestrationStateMachine:
    def test_success_on_first_attempt(self):
        good_response = '{"tool_name": "read_file", "arguments": {"path": "/app.py"}}'
        req, mock_ollama = _make_orchestration_request(mock_response=good_response)
        service = AgentOrchestrationService(ollama=mock_ollama)
        result = service.run(req)

        assert result.success is True
        assert result.tool_name == "read_file"
        assert result.arguments["path"] == "/app.py"
        assert result.escalation_level == "NONE"
        assert result.attempts == 1

    def test_level1_corrective_then_success(self):
        """First call returns garbage, second call (L1 corrective) returns valid JSON."""
        good_response = '{"tool_name": "read_file", "arguments": {"path": "/b.py"}}'
        req, mock_ollama = _make_orchestration_request()
        mock_ollama.chat.side_effect = [
            "I'm not sure what to do here...",   # garbage → parse failure → L1
            good_response,                        # L1 corrective → success
        ]
        service = AgentOrchestrationService(ollama=mock_ollama)
        result = service.run(req)

        assert result.success is True
        assert result.escalation_level == "L1"
        assert result.attempts == 2

    def test_level2_few_shot_then_success(self):
        """L1 corrective also fails; L2 few-shot injected; third call returns valid JSON."""
        good_response = '{"tool_name": "read_file", "arguments": {"path": "/c.py"}}'
        req, mock_ollama = _make_orchestration_request()
        mock_ollama.chat.side_effect = [
            "blah blah no JSON here",       # failure → L1
            "still no valid JSON output",   # failure → L2
            good_response,                  # L2 few-shot → success
        ]
        service = AgentOrchestrationService(ollama=mock_ollama)
        result = service.run(req)

        assert result.success is True
        assert result.escalation_level == "L2"

    def test_level3_graceful_degradation(self):
        """All retries exhausted → L3: returns plain text response, success=False."""
        req, mock_ollama = _make_orchestration_request()
        degraded_text = "Based on the context, the file contains a FastAPI app."
        mock_ollama.chat.side_effect = [
            "not json",   # attempt 1 → L1
            "still not",  # attempt 2 → L2
            "nope",        # attempt 3 → L3 trigger
            degraded_text,  # L3 linear RAG call
        ]
        service = AgentOrchestrationService(ollama=mock_ollama)
        result = service.run(req)

        assert result.success is False
        assert result.escalation_level == "L3_DEGRADED"
        assert result.text_response == degraded_text
        assert result.tool_name is None

    def test_ollama_http_error_triggers_l3(self):
        """Network error immediately triggers graceful L3 degradation."""
        import httpx
        req, mock_ollama = _make_orchestration_request()
        mock_ollama.chat.side_effect = [
            httpx.ConnectError("Connection refused"),
            "Fallback text answer.",
        ]
        service = AgentOrchestrationService(ollama=mock_ollama)
        result = service.run(req)

        assert result.success is False
        assert result.escalation_level == "L3_DEGRADED"

    def test_hallucinated_tool_escalates(self):
        """SLM returns valid JSON but tool does not exist → validator fails → escalation."""
        req, mock_ollama = _make_orchestration_request()
        good_response = '{"tool_name": "read_file", "arguments": {"path": "/app.py"}}'
        mock_ollama.chat.side_effect = [
            '{"tool_name": "fake_magic_tool", "arguments": {}}',  # hallucinated → UNKNOWN_TOOL → L1
            '{"tool_name": "fake_magic_tool", "arguments": {}}',  # L1 → still hallucinated → L2
            '{"tool_name": "fake_magic_tool", "arguments": {}}',  # L2 → L3
            "I cannot call that tool. Here is what I know.",       # L3 degraded
        ]
        service = AgentOrchestrationService(ollama=mock_ollama)
        result = service.run(req)

        assert result.success is False
        assert result.escalation_level == "L3_DEGRADED"


# ---------------------------------------------------------------------------
# 7. System Prompt Builder
# ---------------------------------------------------------------------------

class TestSystemPromptBuilder:
    def test_prompt_contains_tool_names(self):
        tools = [
            _make_tool("read_file"),
            _make_tool("write_file", required=["path", "content"]),
        ]
        prompt = build_system_prompt(tools)
        assert "read_file" in prompt
        assert "write_file" in prompt

    def test_prompt_is_not_empty(self):
        tools = [_make_tool("finish")]
        prompt = build_system_prompt(tools)
        assert len(prompt) > 50

    def test_prompt_no_markdown_headers(self):
        """SLM system prompts must avoid markdown # headers which confuse small models."""
        tools = [_make_tool("read_file")]
        prompt = build_system_prompt(tools)
        assert not any(line.startswith("# ") for line in prompt.splitlines())


# ---------------------------------------------------------------------------
# 8. SLM Tool Registry
# ---------------------------------------------------------------------------

EXPECTED_TOOLS = {
    "read_file", "write_file", "replace_file_content", "multi_replace_file_content",
    "delete_file", "list_dir", "list_files_recursive", "grep_search",
    "extract_code_symbols", "create_directory", "copy_file", "move_file",
    "web_search", "fetch_web_content", "download_file", "run_command",
    "inspect_os_env", "ask", "finish",
}


class TestSlmToolRegistry:
    def test_registry_returns_19_tools(self):
        tools = get_all_tool_definitions()
        assert len(tools) == 19

    def test_registry_covers_all_expected_tool_names(self):
        names = {t.name for t in get_all_tool_definitions()}
        assert names == EXPECTED_TOOLS

    def test_all_tools_have_non_empty_description(self):
        for tool in get_all_tool_definitions():
            assert tool.description.strip(), f"Tool '{tool.name}' has empty description"

    def test_few_shot_examples_cover_all_19_tools(self):
        examples = get_few_shot_examples()
        assert len(examples) == 19
        for name in EXPECTED_TOOLS:
            assert name in examples, f"Missing few-shot example for '{name}'"

    def test_few_shot_examples_are_dicts(self):
        examples = get_few_shot_examples()
        for name, args in examples.items():
            assert isinstance(args, dict), f"Few-shot args for '{name}' must be a dict"

    def test_get_tool_by_name_returns_correct_tool(self):
        tool = get_tool_by_name("run_command")
        assert tool is not None
        assert tool.name == "run_command"
        assert "command" in tool.required

    def test_get_tool_by_name_returns_none_for_unknown(self):
        assert get_tool_by_name("nonexistent_tool_xyz") is None

    def test_input_descriptions_cover_all_tools(self):
        descs = get_tool_input_descriptions()
        assert len(descs) == 19
        for name in EXPECTED_TOOLS:
            assert name in descs
            assert descs[name].strip()

    def test_finish_tool_has_result_as_required(self):
        tool = get_tool_by_name("finish")
        assert tool is not None
        assert "result" in tool.required

    def test_read_file_has_defaults_for_optional_params(self):
        tool = get_tool_by_name("read_file")
        assert tool is not None
        assert "startLine" in tool.defaults
        assert "endLine" in tool.defaults


# ---------------------------------------------------------------------------
# 9. Log Analyzer - analyze_and_export to disk
# ---------------------------------------------------------------------------

class TestLogAnalyzerExport:
    def test_analyze_and_export_writes_json_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = os.path.join(tmpdir, "test.log")
            with open(log_path, "w") as f:
                f.write("[ERROR] CUDA out of memory\n")

            export_path = os.path.join(tmpdir, "diagnostics_report.json")
            analyzer = LogAnalyzer(extra_paths=[tmpdir])
            report, written_path = analyzer.analyze_and_export(export_path=export_path)

            assert written_path == export_path
            assert os.path.isfile(export_path)

    def test_exported_json_has_correct_structure(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = os.path.join(tmpdir, "test.log")
            with open(log_path, "w") as f:
                f.write("[ERROR] CUDA out of memory\nsome line\n")

            export_path = os.path.join(tmpdir, "report.json")
            analyzer = LogAnalyzer(extra_paths=[tmpdir])
            _, written_path = analyzer.analyze_and_export(export_path=export_path)

            with open(written_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            assert "generated_at" in data
            assert "scanned_files" in data
            assert "total_lines_scanned" in data
            assert "anomalies" in data
            assert "has_critical" in data
            assert "summary" in data
            assert isinstance(data["anomalies"], list)

    def test_analyze_and_export_no_anomalies_clean_log(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = os.path.join(tmpdir, "clean.log")
            with open(log_path, "w") as f:
                f.write("[INFO] Sidecar started\n[INFO] LanceDB connected\n")

            export_path = os.path.join(tmpdir, "report_clean.json")
            analyzer = LogAnalyzer(extra_paths=[tmpdir])
            report, _ = analyzer.analyze_and_export(export_path=export_path)

            assert len(report.anomalies) == 0
            assert not report.has_critical
            assert "No anomalies" in report.summary


# ---------------------------------------------------------------------------
# 10. FastAPI Endpoint - use_default_registry integration
# ---------------------------------------------------------------------------

class TestEndpointUseDefaultRegistry:
    """Tests /agent/orchestrate endpoint use_default_registry routing."""

    def setup_method(self):
        self.client = TestClient(fastapi_app, raise_server_exceptions=False)

    def test_empty_tools_without_registry_flag_returns_422(self):
        payload = {
            "model": "qwen2.5:7b",
            "user_message": "List /src/",
            "tools": [],
            "use_default_registry": False,
        }
        resp = self.client.post("/agent/orchestrate", json=payload)
        assert resp.status_code == 422, (
            f"Expected 422 (validation), got {resp.status_code}"
        )

    def test_use_default_registry_true_bypasses_tool_validation(self):
        """With use_default_registry=True, empty tools passes schema validation
        (the registry is populated server-side). The response must NOT be 422.
        Whether it is 200 (mock Ollama) or 500 (no Ollama) is environment-dependent."""
        payload = {
            "model": "qwen2.5:7b",
            "user_message": "List /src/",
            "tools": [],
            "use_default_registry": True,
        }
        resp = self.client.post("/agent/orchestrate", json=payload)
        assert resp.status_code != 422, (
            "Got 422 (schema validation failure). "
            "use_default_registry=True should bypass the empty-tools guard."
        )

