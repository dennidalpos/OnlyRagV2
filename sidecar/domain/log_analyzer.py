"""
sidecar/domain/log_analyzer.py

Domain Layer — Log Diagnostics Engine

Scrapes log files under AppData and sidecar logging paths to detect:
  1. Truncated / malformed JSON in SLM responses
  2. VRAM Thrashing (empty responses, GPU OOM, HTTP 504 timeouts)
  3. Infinite Tool Calling Loops (identical call repetition)

Returns a structured LogDiagnosticReport. Zero FastAPI/Pydantic deps.
"""

from __future__ import annotations

import re
import os
import sys
import json
import datetime
import logging
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

logger = logging.getLogger("PythonSidecar")

# ---------------------------------------------------------------------------
# Data Contracts
# ---------------------------------------------------------------------------

@dataclass
class AnomalyRecord:
    anomaly_type: str       # "TRUNCATED_JSON" | "VRAM_THRASH" | "TOOL_LOOP" | "CIRCUIT_BREAKER" | "OLLAMA_TIMEOUT"
    severity: str           # "WARNING" | "ERROR" | "CRITICAL"
    log_file: str
    line_number: int
    snippet: str
    count: int = 1
    remediation: str = ""


@dataclass
class LogDiagnosticReport:
    scanned_files: list[str] = field(default_factory=list)
    total_lines_scanned: int = 0
    anomalies: list[AnomalyRecord] = field(default_factory=list)

    @property
    def has_critical(self) -> bool:
        return any(a.severity == "CRITICAL" for a in self.anomalies)

    @property
    def summary(self) -> str:
        if not self.anomalies:
            return "No anomalies detected."
        counts = Counter(a.anomaly_type for a in self.anomalies)
        parts = [f"{t}: {c}" for t, c in counts.items()]
        return "Anomalies found — " + ", ".join(parts)


# ---------------------------------------------------------------------------
# Regex patterns for anomaly detection
# ---------------------------------------------------------------------------

# 1. Truncated JSON: line contains an opening brace/bracket but no matching close
_TRUNCATED_JSON_RE = re.compile(r'(\{|\[)[^}\]]{80,}$')

# 2. VRAM Thrashing & Infrastructure Failure indicators
_VRAM_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r'CUDA out of memory|RuntimeError.*CUDA', re.IGNORECASE), "CUDA_OOM"),
    (re.compile(r'HTTP 504|Gateway Timeout|timed out', re.IGNORECASE), "GATEWAY_TIMEOUT"),
    (re.compile(r'"response"\s*:\s*""', re.IGNORECASE), "EMPTY_RESPONSE"),
    (re.compile(r'vram.{0,20}(exceeded|full)|out of vram|gpu.*memory.*full', re.IGNORECASE), "VRAM_EXCEEDED"),
    (re.compile(r'Ollama(?!_)\w*.*?(timed out|timeout(?!\s*:))|connect.*refused.*11434', re.IGNORECASE), "OLLAMA_TIMEOUT"),
    (re.compile(r'Circuit breaker tripped|Recursion limit reached|Infinite loop detected', re.IGNORECASE), "CIRCUIT_BREAKER"),
    (re.compile(r'EPERM: operation not permitted|EACCES: permission denied', re.IGNORECASE), "FS_PERMISSIONS"),
]

# 3. Tool calling loop: identical "tool_name": "X" appearing 3+ times in close proximity
_TOOL_NAME_EXTRACT_RE = re.compile(r'"tool_name"\s*:\s*"([^"]+)"')

# Window size (lines) for loop detection sweep
_LOOP_WINDOW: int = 30
_LOOP_THRESHOLD: int = 3


# ---------------------------------------------------------------------------
# Log Path Resolution
# ---------------------------------------------------------------------------

def resolve_log_paths() -> list[Path]:
    """
    Returns candidate log file paths for the OnlyRag V2 ecosystem:
      - Windows AppData\\Roaming\\onlyrag-v2\\logs\\
      - Windows LocalAppData\\OnlyRagV2\\data\\ (sidecar logs)
      - Fallback: ~/.onlyragv2/ for non-Windows
    """
    candidates: list[Path] = []

    if sys.platform == "win32":
        roaming = os.environ.get("APPDATA", "")
        local = os.environ.get("LOCALAPPDATA", "")
        if roaming:
            candidates.append(Path(roaming) / "onlyrag-v2" / "logs")
            candidates.append(Path(roaming) / "OnlyRagV2" / "logs")
        if local:
            candidates.append(Path(local) / "OnlyRagV2" / "data")
            candidates.append(Path(local) / "OnlyRagV2" / "logs")
            candidates.append(Path(local) / "onlyrag-v2" / "logs")
    else:
        candidates.append(Path.home() / ".onlyragv2" / "logs")
        candidates.append(Path.home() / ".onlyragv2" / "data")

    # Always include the sidecar's working directory adjacent logs/
    sidecar_root = Path(__file__).parent.parent.parent
    candidates.append(sidecar_root / "logs")

    return [p for p in candidates if p.exists()]


def _collect_log_files(paths: Iterable[Path]) -> list[Path]:
    """Recursively collect .log and .txt files from given directories."""
    found: list[Path] = []
    for base in paths:
        if base.is_file():
            found.append(base)
        elif base.is_dir():
            for ext in ("*.log", "*.txt"):
                found.extend(base.rglob(ext))
    return found


# ---------------------------------------------------------------------------
# Anomaly Detectors & Remediation Helpers
# ---------------------------------------------------------------------------

def _get_remediation(anomaly_type: str) -> str:
    if "CUDA_OOM" in anomaly_type or "VRAM_EXCEEDED" in anomaly_type:
        return "Memoria VRAM GPU esaurita. Riduci il context window (num_ctx: 8192/4096) o seleziona un modello con quantizzazione più compatta (es. q4_k_m)."
    if "TRUNCATED_JSON" in anomaly_type:
        return "Risposta JSON del modello troncata o non valida. Aumenta num_ctx o passa a un modello coding dedicato (es. qwen2.5-coder:7b)."
    if "TOOL_LOOP" in anomaly_type:
        return "Loop di chiamate identiche rilevato. Riformula il prompt o interrompi l'agente per evitare consumo inutile di token."
    if "GATEWAY_TIMEOUT" in anomaly_type or "OLLAMA_TIMEOUT" in anomaly_type:
        return "Connessione a Ollama o Sidecar scaduta o rifiutata. Verifica che il demone Ollama sia attivo sulla porta 11434."
    if "CIRCUIT_BREAKER" in anomaly_type:
        return "Intervento del Circuit Breaker di sicurezza: l'esecuzione è stata arrestata per prevenire loop infiniti."
    if "FS_PERMISSIONS" in anomaly_type:
        return "Errore di permessi nel filesystem (EPERM/EACCES). Assicurati che OnlyRag abbia i permessi di scrittura nella cartella del workspace."
    return "Controlla i log completi e verifica la corretta configurazione dell'ambiente di esecuzione."


def _detect_truncated_json(
    lines: list[str],
    file_path: str,
) -> list[AnomalyRecord]:
    records: list[AnomalyRecord] = []
    for i, line in enumerate(lines, start=1):
        if _TRUNCATED_JSON_RE.search(line):
            records.append(AnomalyRecord(
                anomaly_type="TRUNCATED_JSON",
                severity="ERROR",
                log_file=file_path,
                line_number=i,
                snippet=line.strip()[:120],
                remediation=_get_remediation("TRUNCATED_JSON"),
            ))
    return records


def _detect_vram_thrashing(
    lines: list[str],
    file_path: str,
) -> list[AnomalyRecord]:
    records: list[AnomalyRecord] = []
    for i, line in enumerate(lines, start=1):
        for pattern, sub_type in _VRAM_PATTERNS:
            if pattern.search(line):
                full_type = f"VRAM_THRASH:{sub_type}"
                records.append(AnomalyRecord(
                    anomaly_type=full_type,
                    severity="CRITICAL" if sub_type in ("CUDA_OOM", "VRAM_EXCEEDED", "CIRCUIT_BREAKER") else "ERROR",
                    log_file=file_path,
                    line_number=i,
                    snippet=line.strip()[:120],
                    remediation=_get_remediation(full_type),
                ))
                break  # one match per line
    return records


def _detect_tool_loops(
    lines: list[str],
    file_path: str,
) -> list[AnomalyRecord]:
    """
    Sliding window detector: if the same tool_name appears >= LOOP_THRESHOLD
    times within LOOP_WINDOW consecutive lines, flag it as an infinite loop.
    """
    records: list[AnomalyRecord] = []
    n = len(lines)
    reported: set[tuple[int, str]] = set()

    for start in range(n):
        window = lines[start: start + _LOOP_WINDOW]
        tool_counts: Counter[str] = Counter()
        for wline in window:
            for match in _TOOL_NAME_EXTRACT_RE.finditer(wline):
                tool_counts[match.group(1)] += 1

        for tool_name, count in tool_counts.items():
            if count >= _LOOP_THRESHOLD:
                key = (start, tool_name)
                if key not in reported:
                    reported.add(key)
                    records.append(AnomalyRecord(
                        anomaly_type="TOOL_LOOP",
                        severity="CRITICAL",
                        log_file=file_path,
                        line_number=start + 1,
                        snippet=f"Tool '{tool_name}' called {count}x in {_LOOP_WINDOW}-line window.",
                        count=count,
                        remediation=_get_remediation("TOOL_LOOP"),
                    ))
    return records


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

class LogAnalyzer:
    """
    Scans all OnlyRag V2 log files and returns a consolidated
    LogDiagnosticReport identifying anomalies across all detectors.
    """

    def __init__(self, extra_paths: list[str] | None = None) -> None:
        resolved = resolve_log_paths()
        if extra_paths:
            resolved += [Path(p) for p in extra_paths if Path(p).exists()]
        self._log_files = _collect_log_files(resolved)

    def analyze(self) -> LogDiagnosticReport:
        report = LogDiagnosticReport()

        if not self._log_files:
            logger.warning("LogAnalyzer: no log files found in candidate paths.")
            return report

        for log_path in self._log_files:
            try:
                raw = log_path.read_text(encoding="utf-8", errors="replace")
            except OSError as e:
                logger.warning("LogAnalyzer: cannot read '%s': %s", log_path, e)
                continue

            lines = raw.splitlines()
            report.scanned_files.append(str(log_path))
            report.total_lines_scanned += len(lines)
            str_path = str(log_path)

            report.anomalies.extend(_detect_truncated_json(lines, str_path))
            report.anomalies.extend(_detect_vram_thrashing(lines, str_path))
            report.anomalies.extend(_detect_tool_loops(lines, str_path))

        logger.info(
            "LogAnalyzer: scanned %d files (%d lines) → %d anomalies found.",
            len(report.scanned_files),
            report.total_lines_scanned,
            len(report.anomalies),
        )
        return report

    def analyze_and_export(self, export_path: str | None = None) -> tuple[LogDiagnosticReport, str | None]:
        """
        Run analysis and persist results to a JSON report file for offline debug.

        If export_path is None, resolves automatically to:
          Windows: %LOCALAPPDATA%\\OnlyRagV2\\data\\diagnostics_report.json
          Other:   ~/.onlyragv2/data/diagnostics_report.json

        Returns (report, exported_file_path | None).
        """
        report = self.analyze()

        resolved_path = export_path or self._default_export_path()
        if not resolved_path:
            logger.warning("LogAnalyzer: no export path resolvable; skipping disk write.")
            return report, None

        try:
            export_dir = Path(resolved_path).parent
            export_dir.mkdir(parents=True, exist_ok=True)

            payload = {
                "generated_at": datetime.datetime.now().isoformat(),
                "scanned_files": report.scanned_files,
                "total_lines_scanned": report.total_lines_scanned,
                "has_critical": report.has_critical,
                "summary": report.summary,
                "anomalies": [
                    {
                        "anomaly_type": a.anomaly_type,
                        "severity": a.severity,
                        "log_file": a.log_file,
                        "line_number": a.line_number,
                        "snippet": a.snippet,
                        "count": a.count,
                        "remediation": a.remediation,
                    }
                    for a in report.anomalies
                ],
            }

            Path(resolved_path).write_text(
                json.dumps(payload, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            logger.info("LogAnalyzer: diagnostics report exported to '%s'.", resolved_path)
            return report, resolved_path

        except OSError as exc:
            logger.error("LogAnalyzer: failed to export report to '%s': %s", resolved_path, exc)
            return report, None

    @staticmethod
    def _default_export_path() -> str | None:
        """Resolves the canonical AppData export path for diagnostics_report.json."""
        if sys.platform == "win32":
            local = os.environ.get("LOCALAPPDATA", "")
            if local:
                return str(Path(local) / "OnlyRagV2" / "data" / "diagnostics_report.json")
        else:
            return str(Path.home() / ".onlyragv2" / "data" / "diagnostics_report.json")
        return None

