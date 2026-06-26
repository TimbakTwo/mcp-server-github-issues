# MCP GitHub Issues Server — Agent Instructions

## Project Context

- This is a **stdio-based MCP server** using the official MCP TypeScript SDK (not Python FastMCP).
- Communication happens over stdin/stdout via JSON-RPC.
- The server runs as a subprocess of Claude Code or Claude Desktop.

## Critical Rules

- **Never use stdout for debugging** — it breaks the JSON-RPC protocol. Always use `console.error(...)`.
- **Never throw exceptions** inside tools. Always `return` an MCP `{ content: [...] }` response with an error string.
- **Test every tool with happy path, 404, 401, 403, and empty-result cases** before marking it complete.
- **GITHUB_TOKEN** is loaded from `.env` at startup. Never hardcode tokens. Never log or expose the token value.

## File Layout

```
src/
  index.ts              — Server setup + tool registration only
  github-client.ts      — Shared HTTP client for all GitHub API calls
  tools/
    list-open-issues.ts — Tool 1: GET /repos/{owner}/{repo}/issues
    read-repo-file.ts   — Tool 2: GET /repos/{owner}/{repo}/contents/{path}
    create-issue.ts     — Tool 3: POST /repos/{owner}/{repo}/issues
    post-comment.ts     — Tool 4: POST /repos/{owner}/{repo}/issues/{n}/comments
    __tests__/          — Vitest tests, one file per tool
```

## Architecture Reference

Full design decisions, type contracts, error taxonomy, and tool specs are in **ARCHITECTURE.md**.
Read it once at the start of any implementation session before making changes.

## Key Dependencies

- `@modelcontextprotocol/sdk` — MCP server framework
- `zod` — Runtime parameter validation
- `dotenv` — `.env` file loading
- `vitest` — Test framework (dev dependency)

## Running

```bash
npm install              # Install dependencies
npm run dev              # Start the MCP server (stdin/stdout)
npm run build            # Compile TypeScript
npm test                 # Run Vitest tests
```

## Claude MCP Registration

```bash
claude mcp add github-issues -- npx tsx src/index.ts
```
