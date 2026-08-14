---
name: agent-security-and-tool-calling
description: Guidelines for agentic tool parsing, AppSec sandboxing, path traversal prevention, credential protection, prompt injection defense, and Ollama local runtime parameters in OnlyRag V2.
---

# Agent Security & Tool Calling Guidelines

## 1. Tool Call Parsing & Fault Tolerance
- **Multi-Format Parsing**: The tool parser (`toolParser.ts`) parses JSON blocks enclosed in `<tool_call>`, ````json ````, or raw JSON objects containing `"tool"` key.
- **Fault-Tolerant Sanitization**: Cleans up single quotes, unescaped newlines in JSON string literals, and trailing commas prior to `JSON.parse` to handle heavily quantized local LLMs (3B/7B/8B Q4_K_M).
- **Tool Parameter Validation**: Validates mandatory parameters (`filePath`, `command`, `query`, `targetContent`) before execution. Invalid tool calls are safely rejected with diagnostic log warnings.

## 2. AppSec Sandboxing & Path Traversal Prevention
- **Workspace Containment**: All file operations (`read_file`, `write_file`, `replace_file_content`, `list_dir`) MUST validate file paths against the active workspace root via `validatePathSafety(filePath, workspaceRoot)`. Paths outside the workspace root are blocked immediately.
- **Credential & Secret Protection**: Files matching `SECRET_FILENAMES` (`.env`, `.env.*`, `id_rsa`, `id_ed25519`, `credentials`, `service-account.json`) or `SECRET_EXTENSIONS` (`.pem`, `.key`, `.p12`, `.pfx`) are strictly blocked from scanning, reading, writing, or context inclusion.
- **Indirect Prompt Injection Defense**: Untrusted content read from project files is wrapped inside explicit boundary markers (`[UNTRUSTED FILE CONTENT: ...] ... [END UNTRUSTED CONTENT]`) to prevent embedded prompt injection attacks.

## 3. Shell Execution & PowerShell Compatibility
- **Windows / PowerShell Target**: Commands run via `spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ...])`. Unix shell commands are auto-translated (`rm -rf` $\rightarrow$ `Remove-Item -Recurse -Force`, `touch` $\rightarrow$ `New-Item -ItemType File`, `ls` $\rightarrow$ `Get-ChildItem`).
- **Destructive Command Guardrails**: Commands matching destructive patterns (`git reset --hard`, `git clean -fd`, `git push --force`, `rm -rf /`, broad recursive deletions) are blocked by `checkCommandSecurity`.

## 4. Web & Network Security Guidelines
- **SSRF Defense & URL Validation**: Web search and web fetching (`WebClient`) only permit `http:` and `https:` protocols. Requests targeting cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`) or local loopback scanning are blocked.
- **HTML Sanitization & Content Budgeting**: Web pages fetched via `fetch_web_content` are stripped of `<script>`, `<style>`, `<svg>`, `<nav>`, `<noscript>`, and advertising tags. The parsed Markdown is bounded to max 16,000 characters to prevent context window saturation.
- **Download Sandboxing**: File downloads via `download_file` enforce strict workspace containment (`validatePathSafety`), directory creation safety, and a 100MB file size ceiling.

## 5. Ollama Runtime Parameters & Fail-Fast Feedback
- **Deterministic Sampling**: Code generation calls pass `temperature: 0.1`, `top_p: 0.9`, `repeat_penalty: 1.1`, and `num_ctx: 16384`.
- **Retry Resilience**: Transient socket/network errors execute a 1-retry fallback (1s delay). Fatal errors (`ECONNREFUSED` / HTTP 404) immediately return clear actionable messages.
- **Auto-Healing Loop**: Terminal command errors (exit code != 0 or stack trace keywords) return a structured `[TERMINAL AUTO-HEALING DIAGNOSTICS LOG]` block to prompt LLM self-correction on the next step.
