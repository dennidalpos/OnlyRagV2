"""
sidecar/tests/test_log_analyzer.py

Unit tests for the Log Analyzer module:
  - Anomaly detectors (truncated JSON, VRAM thrashing, tool-calling loops)
  - analyze_and_export to disk
"""

from __future__ import annotations

import os
import sys
import tempfile
import json

# Ensure root workspace is resolvable
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from sidecar.domain.log_analyzer import (
    LogAnalyzer,
    _detect_tool_loops,
    _detect_truncated_json,
    _detect_vram_thrashing,
)


# ---------------------------------------------------------------------------
# 1. Log Analyzer Anomaly Detectors
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

    def test_no_false_positive_on_informational_vram_detection_line(self):
        # Routine GPU detection logging (diagnostics.ts) mentions "VRAM" but is not an anomaly.
        lines = ["[INFO] [GPU]: Detected GPU: NVIDIA GeForce RTX 2070 | VRAM: 7578/8192 MB | CUDA: 13.3"]
        records = _detect_vram_thrashing(lines, "test.log")
        assert len(records) == 0

    def test_detects_vram_exceeded_message(self):
        lines = ["[ERROR] VRAM budget exceeded while loading model"]
        records = _detect_vram_thrashing(lines, "test.log")
        assert any("VRAM_EXCEEDED" in r.anomaly_type for r in records)
        assert any(r.severity == "CRITICAL" for r in records)

    def test_no_false_positive_on_ollama_env_var_configuration_line(self):
        # Routine env-var configuration logging (TaskRunner) mentions "OLLAMA_" as an
        # identifier prefix and "[Timeout: Ns]" as the command's own timeout budget —
        # neither indicates an actual Ollama request timeout.
        lines = [
            "[INFO] [TaskRunner]: Executing PowerShell command: "
            "[System.Environment]::SetEnvironmentVariable('OLLAMA_FLASH_ATTENTION', '1', 'User'); "
            "[System.Environment]::SetEnvironmentVariable('OLLAMA_KV_CACHE_TYPE', 'q8_0', 'User') [Timeout: 300s]"
        ]
        records = _detect_vram_thrashing(lines, "test.log")
        assert len(records) == 0

    def test_detects_real_ollama_client_timeout(self):
        lines = ["[ERROR] [OllamaClient]: Timeout pulling model qwen2.5-coder:7b"]
        records = _detect_vram_thrashing(lines, "test.log")
        assert any("OLLAMA_TIMEOUT" in r.anomaly_type for r in records)

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
# 2. Log Analyzer - analyze_and_export to disk
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
