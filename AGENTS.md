# MCP GitHub Issues Server

## Project Context

- This is a **stdio-based MCP server** using FastMCP (not HTTP).
- Communication happens over stdin/stdout via JSON-RPC.
- The server runs as a subprocess of Claude Code (or Claude Desktop).

## Critical Rules for AI Agents Working on This Code

- **Never use stdout for debugging** — it breaks the JSON-RPC protocol. Always use `print(..., file=sys.stderr)`.
- **Never raise exceptions** inside tools. Always `return` error strings so the server stays alive.
- **Test every tool with happy path, 404, 401, 403, and empty-result cases** before marking it complete.
- Authentication uses a fine-grained PAT stored in `.env` (never hardcode).

## Current Tools

- `list_open_issues(owner, repo, per_page=30)` — returns issue number, title, URL.
- (More tools coming: read_repo_file, create_issue, post_comment)

## Running Tests

`python test_tool.py` — this calls the tools directly without Claude Code.