"""
sidecar/domain/slm_tool_registry.py

Domain Layer — SLM 19-Tool Few-Shot Registry

Provides:
  - ToolDefinition objects for all 19 Agent Studio tools
  - Canonical few-shot input/output examples per tool
  - Factory to build the complete registry for AgentOrchestrationService

Used by AgentOrchestrationService.run() to populate:
  - OrchestrationRequest.tools
  - OrchestrationRequest.few_shot_examples

Matches tool set defined in SKILL.md §4 and AgentToolCall union in src/types/index.ts.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sidecar.domain.slm_agent import ToolDefinition


# ---------------------------------------------------------------------------
# Few-Shot Example Contract
# ---------------------------------------------------------------------------

@dataclass
class ToolFewShotExample:
    """Static input/output example for Level-2 escalation prompt injection."""
    input_description: str
    example_arguments: dict[str, Any]


# ---------------------------------------------------------------------------
# 19-Tool Registry
# ---------------------------------------------------------------------------

_TOOL_REGISTRY: list[tuple[ToolDefinition, ToolFewShotExample]] = [

    # 1. read_file -------------------------------------------------------
    (
        ToolDefinition(
            name="read_file",
            description="Read the content of a file. Use line slicing to limit output.",
            parameters={
                "filePath": {"type": "string", "description": "Absolute or workspace-relative file path."},
                "startLine": {"type": "integer", "description": "First line to read (1-indexed)."},
                "endLine": {"type": "integer", "description": "Last line to read (1-indexed, inclusive)."},
            },
            required=["filePath"],
            defaults={"startLine": 1, "endLine": 100},
        ),
        ToolFewShotExample(
            input_description="Read lines 1-50 of /src/main.py",
            example_arguments={"filePath": "/src/main.py", "startLine": 1, "endLine": 50},
        ),
    ),

    # 2. write_file -------------------------------------------------------
    (
        ToolDefinition(
            name="write_file",
            description="Create a new file or overwrite an existing file with the provided content.",
            parameters={
                "filePath": {"type": "string", "description": "Target file path."},
                "content": {"type": "string", "description": "Full content to write."},
            },
            required=["filePath", "content"],
            defaults={},
        ),
        ToolFewShotExample(
            input_description="Create /src/utils/helper.py with a placeholder function",
            example_arguments={"filePath": "/src/utils/helper.py", "content": "def hello():\n    pass\n"},
        ),
    ),

    # 3. replace_file_content --------------------------------------------
    (
        ToolDefinition(
            name="replace_file_content",
            description="Replace a single contiguous block of text in a file.",
            parameters={
                "filePath": {"type": "string", "description": "Target file path."},
                "targetContent": {"type": "string", "description": "Exact text to replace."},
                "replacementContent": {"type": "string", "description": "New text to insert."},
            },
            required=["filePath", "targetContent", "replacementContent"],
            defaults={},
        ),
        ToolFewShotExample(
            input_description="Replace 'def old_name' with 'def new_name' in /app/api.py",
            example_arguments={
                "filePath": "/app/api.py",
                "targetContent": "def old_name():",
                "replacementContent": "def new_name():",
            },
        ),
    ),

    # 4. multi_replace_file_content ---------------------------------------
    (
        ToolDefinition(
            name="multi_replace_file_content",
            description="Replace multiple non-contiguous text blocks in a file in one operation.",
            parameters={
                "filePath": {"type": "string", "description": "Target file path."},
                "replacements": {
                    "type": "array",
                    "description": "List of {targetContent, replacementContent} pairs.",
                },
            },
            required=["filePath", "replacements"],
            defaults={},
        ),
        ToolFewShotExample(
            input_description="Replace two separate strings in /config.ts",
            example_arguments={
                "filePath": "/config.ts",
                "replacements": [
                    {"targetContent": "port: 3000", "replacementContent": "port: 8080"},
                    {"targetContent": "debug: false", "replacementContent": "debug: true"},
                ],
            },
        ),
    ),

    # 5. delete_file ------------------------------------------------------
    (
        ToolDefinition(
            name="delete_file",
            description="Permanently delete a file from the workspace.",
            parameters={
                "filePath": {"type": "string", "description": "Absolute path of the file to delete."},
            },
            required=["filePath"],
            defaults={},
        ),
        ToolFewShotExample(
            input_description="Delete the legacy migration file /db/old_migration.sql",
            example_arguments={"filePath": "/db/old_migration.sql"},
        ),
    ),

    # 6. list_dir ---------------------------------------------------------
    (
        ToolDefinition(
            name="list_dir",
            description="List files and subdirectories in a directory (one level deep).",
            parameters={
                "dirPath": {"type": "string", "description": "Directory path to list."},
            },
            required=["dirPath"],
            defaults={},
        ),
        ToolFewShotExample(
            input_description="List contents of /src/components/",
            example_arguments={"dirPath": "/src/components/"},
        ),
    ),

    # 7. list_files_recursive ---------------------------------------------
    (
        ToolDefinition(
            name="list_files_recursive",
            description="Recursively list all files under a directory path.",
            parameters={
                "dirPath": {"type": "string", "description": "Root directory path."},
                "maxDepth": {"type": "integer", "description": "Maximum recursion depth."},
            },
            required=["dirPath"],
            defaults={"maxDepth": 5},
        ),
        ToolFewShotExample(
            input_description="List all Python files in /sidecar/",
            example_arguments={"dirPath": "/sidecar/", "maxDepth": 4},
        ),
    ),

    # 8. grep_search ------------------------------------------------------
    (
        ToolDefinition(
            name="grep_search",
            description="Search for a string or regex pattern across workspace files.",
            parameters={
                "dirPath": {"type": "string", "description": "Directory to search in."},
                "query": {"type": "string", "description": "Search string or regex."},
                "isRegex": {"type": "boolean", "description": "If true, treat query as regex."},
                "caseInsensitive": {"type": "boolean", "description": "Case-insensitive search."},
            },
            required=["dirPath", "query"],
            defaults={"isRegex": False, "caseInsensitive": False},
        ),
        ToolFewShotExample(
            input_description="Find all usages of 'parse_tool_call' in /electron/",
            example_arguments={"dirPath": "/electron/", "query": "parse_tool_call", "isRegex": False},
        ),
    ),

    # 9. extract_code_symbols ---------------------------------------------
    (
        ToolDefinition(
            name="extract_code_symbols",
            description="Extract function, class, and variable definitions from a source file using AST/Regex.",
            parameters={
                "filePath": {"type": "string", "description": "Source file to analyze."},
            },
            required=["filePath"],
            defaults={},
        ),
        ToolFewShotExample(
            input_description="Extract all symbols from /sidecar/domain/slm_agent.py",
            example_arguments={"filePath": "/sidecar/domain/slm_agent.py"},
        ),
    ),

    # 10. create_directory ------------------------------------------------
    (
        ToolDefinition(
            name="create_directory",
            description="Create a directory (and parent directories) at the specified path.",
            parameters={
                "dirPath": {"type": "string", "description": "Directory path to create."},
            },
            required=["dirPath"],
            defaults={},
        ),
        ToolFewShotExample(
            input_description="Create directory /src/components/agent/",
            example_arguments={"dirPath": "/src/components/agent/"},
        ),
    ),

    # 11. copy_file -------------------------------------------------------
    (
        ToolDefinition(
            name="copy_file",
            description="Copy a file from source path to destination path.",
            parameters={
                "sourcePath": {"type": "string", "description": "Source file path."},
                "destinationPath": {"type": "string", "description": "Destination file path."},
            },
            required=["sourcePath", "destinationPath"],
            defaults={},
        ),
        ToolFewShotExample(
            input_description="Copy /templates/base.html to /src/views/base.html",
            example_arguments={"sourcePath": "/templates/base.html", "destinationPath": "/src/views/base.html"},
        ),
    ),

    # 12. move_file -------------------------------------------------------
    (
        ToolDefinition(
            name="move_file",
            description="Move or rename a file.",
            parameters={
                "sourcePath": {"type": "string", "description": "Current file path."},
                "destinationPath": {"type": "string", "description": "New file path."},
            },
            required=["sourcePath", "destinationPath"],
            defaults={},
        ),
        ToolFewShotExample(
            input_description="Move /src/old_utils.ts to /src/utils/helpers.ts",
            example_arguments={"sourcePath": "/src/old_utils.ts", "destinationPath": "/src/utils/helpers.ts"},
        ),
    ),

    # 13. web_search ------------------------------------------------------
    (
        ToolDefinition(
            name="web_search",
            description="Search DuckDuckGo and return top web results for a query.",
            parameters={
                "query": {"type": "string", "description": "Search query string."},
                "maxResults": {"type": "integer", "description": "Maximum number of results to return."},
            },
            required=["query"],
            defaults={"maxResults": 5},
        ),
        ToolFewShotExample(
            input_description="Search for FastAPI streaming response examples",
            example_arguments={"query": "FastAPI StreamingResponse example Python", "maxResults": 5},
        ),
    ),

    # 14. fetch_web_content -----------------------------------------------
    (
        ToolDefinition(
            name="fetch_web_content",
            description="Fetch and convert a webpage to Markdown text.",
            parameters={
                "url": {"type": "string", "description": "Full HTTPS URL to fetch."},
                "maxChars": {"type": "integer", "description": "Maximum characters to return."},
            },
            required=["url"],
            defaults={"maxChars": 8000},
        ),
        ToolFewShotExample(
            input_description="Fetch the Ollama API documentation page",
            example_arguments={"url": "https://ollama.com/docs/api", "maxChars": 8000},
        ),
    ),

    # 15. download_file ---------------------------------------------------
    (
        ToolDefinition(
            name="download_file",
            description="Download a file from a URL and save it to the workspace.",
            parameters={
                "url": {"type": "string", "description": "Source URL to download from."},
                "targetFilePath": {"type": "string", "description": "Local destination path."},
            },
            required=["url", "targetFilePath"],
            defaults={},
        ),
        ToolFewShotExample(
            input_description="Download the Phi-3 GGUF model file to /models/",
            example_arguments={"url": "https://example.com/phi3.gguf", "targetFilePath": "/models/phi3.gguf"},
        ),
    ),

    # 16. run_command -----------------------------------------------------
    (
        ToolDefinition(
            name="run_command",
            description="Execute a PowerShell command in the workspace and return stdout/stderr.",
            parameters={
                "command": {"type": "string", "description": "PowerShell command string to execute."},
                "cwd": {"type": "string", "description": "Working directory for the command."},
                "timeoutMs": {"type": "integer", "description": "Timeout in milliseconds."},
            },
            required=["command"],
            defaults={"timeoutMs": 30000},
        ),
        ToolFewShotExample(
            input_description="Run the Pytest test suite",
            example_arguments={"command": ".venv\\Scripts\\python.exe -m pytest sidecar/tests/ -v", "timeoutMs": 60000},
        ),
    ),

    # 17. inspect_os_env --------------------------------------------------
    (
        ToolDefinition(
            name="inspect_os_env",
            description="Inspect the host OS environment: platform, CPU, RAM, installed tools.",
            parameters={},
            required=[],
            defaults={},
        ),
        ToolFewShotExample(
            input_description="Get OS environment information",
            example_arguments={},
        ),
    ),

    # 18. ask -------------------------------------------------------------
    (
        ToolDefinition(
            name="ask",
            description="Ask the user a clarification question. Use ONLY when essential information is truly missing.",
            parameters={
                "question": {"type": "string", "description": "Clear, specific question for the user."},
            },
            required=["question"],
            defaults={},
        ),
        ToolFewShotExample(
            input_description="Ask the user which database engine to use",
            example_arguments={"question": "Which database engine should I use: SQLite or PostgreSQL?"},
        ),
    ),

    # 19. finish ----------------------------------------------------------
    (
        ToolDefinition(
            name="finish",
            description="Signal task completion. Call when all objectives are fully achieved and verified.",
            parameters={
                "result": {"type": "string", "description": "Brief summary of what was accomplished."},
            },
            required=["result"],
            defaults={},
        ),
        ToolFewShotExample(
            input_description="Signal task completion after writing all files",
            example_arguments={"result": "All 3 files created and tests passing: 37/37 PASS."},
        ),
    ),
]


# ---------------------------------------------------------------------------
# Public Accessors
# ---------------------------------------------------------------------------

def get_all_tool_definitions() -> list[ToolDefinition]:
    """Returns the list of all 19 ToolDefinition objects for use in system prompts."""
    return [td for td, _ in _TOOL_REGISTRY]


def get_few_shot_examples() -> dict[str, dict[str, Any]]:
    """
    Returns a dict mapping tool_name → example_arguments for Level-2
    escalation prompt injection in AgentOrchestrationService.
    """
    return {
        td.name: ex.example_arguments
        for td, ex in _TOOL_REGISTRY
    }


def get_tool_input_descriptions() -> dict[str, str]:
    """Returns a dict mapping tool_name → input_description for few-shot prompts."""
    return {
        td.name: ex.input_description
        for td, ex in _TOOL_REGISTRY
    }


def get_tool_by_name(name: str) -> ToolDefinition | None:
    """Lookup a single ToolDefinition by name."""
    for td, _ in _TOOL_REGISTRY:
        if td.name == name:
            return td
    return None
