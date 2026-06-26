# MCP GitHub Issues Server — Architecture

This document describes the structural design, type contracts, error model, and tool-by-tool specifications. It is the source of truth for architectural decisions and is consumed by AI coding agents across sessions.

---

## 1. File Layout

```
mcp-server-github-issues/
  src/
    index.ts              — MCP server setup, tool registration only (<60 lines)
    github-client.ts      — Shared HTTP client, error classification, type contracts
    tools/
      list-open-issues.ts — Tool 1: GET /repos/{owner}/{repo}/issues
      read-repo-file.ts   — Tool 2: GET /repos/{owner}/{repo}/contents/{path}
      create-issue.ts     — Tool 3: POST /repos/{owner}/{repo}/issues
      post-comment.ts     — Tool 4: POST /repos/{owner}/{repo}/issues/{n}/comments
      __tests__/
        github-client.test.ts
        list-open-issues.test.ts
        read-repo-file.test.ts
        create-issue.test.ts
        post-comment.test.ts
  AGENTS.md               — Rules for AI agents (injected every session)
  ARCHITECTURE.md          — This file
  README.md               — Human-facing docs
```

**Rule:** `index.ts` only imports and registers tools. It never contains tool logic. If a file grows past 80 lines, extract into a module.

---

## 2. Shared HTTP Client (`github-client.ts`)

Every tool hits the GitHub REST API v3. A shared client eliminates duplication of auth headers, URL construction, error parsing, and timeout logic.

### Type Contracts

```typescript
// Every GitHub API response is classified into one of these categories.
// Each tool maps categories to user-facing MCP content responses.
type GitHubErrorCategory =
  | "auth"          // 401 — token invalid, expired, missing
  | "not_found"     // 404 — repo, file, issue, or branch doesn't exist
  | "rate_limit"    // 403 + rate-limit body — secondary or primary limit hit
  | "forbidden"     // 403 — token lacks permission for this resource
  | "validation"    // 422 — input rejected by GitHub (bad title, labels, etc.)
  | "server_error"  // 5xx — GitHub is down
  | "network"       // DNS failure, connection refused, timeout (no HTTP status)
  | "unknown";      // Anything else

// Every API response returns one of these shapes.

// If `error` is present, `data` is null, and vice-versa.
interface GitHubResult<T> {
  data: T | null;
  error: {
    category: GitHubErrorCategory;
    status: number;
    userMessage: string;      // End-user facing, actionable
    technicalDetail: string;  // For logs / agent debugging
  } | null;
}

// The single function all tools call.
// Returns a classified result without throwing — tool handlers
// switch on the category to produce MCP content.
async function githubRequest<T>(
  method: "GET" | "POST",
  path: string,                    // e.g. "/repos/owner/repo/issues"
  options?: {
    body?: unknown;                // JSON-serializable for POST
    params?: Record<string, string // URL query parameters
    timeoutMs?: number;            // Default 30_000
  }
): Promise<GitHubResult<T>>;
```

### Retry Strategy

No retry logic in v1. GitHub rate-limit errors return the reset timestamp in the `X-RateLimit-Reset` header — that information bubbles up through `error.userMessage`, and the AI agent calling the tool decides whether to wait. Adding retry-with-backoff is a future optimization, not a v1 requirement.

### Timeout

Every fetch uses `AbortController` with a hard timeout. Default: 30 seconds. Rationale: GitHub API rarely takes longer than 10s. A hanging fetch blocks the MCP tool call and freezes the client (Claude Desktop / Claude Code) until it resolves.

---

## 3. Error Taxonomy

Every HTTP response status maps to one category. This table is the single source of truth for how errors are classified:

| HTTP Status   | Category       | Condition                                 | User-Facing Message Template                               |
| ------------- | -------------- | ----------------------------------------- | ---------------------------------------------------------- |
| 200           | (success)      | `data` populated                          | —                                                          |
| 204           | (success)      | `data` = null (POST returns 201, not 204) | —                                                          |
| 301           | `not_found`    | Repo renamed/moved                        | `{resource} has been moved — check the owner/repo name`    |
| 304           | `not_modified` | Conditional request (not used)            | —                                                          |
| 401           | `auth`         | Token invalid/expired/missing             | `Authentication failed — check GITHUB_TOKEN in .env`       |
| 403           | `rate_limit`   | Body contains "rate limit"                | `Rate limit exceeded — wait {X-RateLimit-Reset} seconds`   |
| 403           | `forbidden`    | No "rate limit" in body                   | `Access denied — token lacks permission for this resource` |
| 404           | `not_found`    | —                                         | `{resource} not found in {owner}/{repo}`                   |
| 410           | `not_found`    | Issue deleted, repo removed               | `{resource} was deleted or is no longer available`         |
| 422           | `validation`   | —                                         | `Validation failed — {error details from body.errors}`     |
| 429           | `rate_limit`   | Secondary rate limit                      | `Secondary rate limit hit — slow down requests`            |
| 5xx           | `server_error` | —                                         | `GitHub API error ({status}) — try again later`            |
| Network error | `network`      | Fetch throws                              | `Network error — check your internet connection`           |

**Rule for tool handlers:** Do not re-classify errors inline. Every tool calls `githubRequest()`, switches on the `error.category`, and produces a content response. No tool does its own `if (response.status === 404)`.

---

## 4. Tool Specifications

### Tool 1: `list_open_issues`

| Property         | Value                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint         | `GET /repos/{owner}/{repo}/issues`                                                                                                              |
| Parameters       | `owner` (string, required), `repo` (string, required), `per_page` (number, optional, default 30, max 100), `page` (number, optional, default 1) |
| Default behavior | Returns open issues that are NOT pull requests (filtered by absence of `pull_request` key)                                                      |

**Edge cases:**

- Repo has 0 issues → "No open issues found"
- Repo has >100 issues → paginate with `page` parameter; current response indicates the page and (if available) link headers
- Repo is private + token lacks access → 404 (GitHub returns 404 for private repos, not 403 — this is intentional)
- Token is invalid → 401
- Issues endpoint includes PRs by default → tool filters out items with `pull_request` key; tag remaining PRs with `[PR]` as a courtesy
- Repo doesn't exist → 404
- Rate limited → 403 rate limit

**Tool description (this exact text goes in `server.tool()`):**

```
List open issues (not pull requests) in a GitHub repository.
Use when asked to check issues, bugs, or open items for a repo.
Returns issue number, title, and URL for each issue.
Supports pagination with optional per_page and page parameters.
```

### Tool 2: `read_repo_file`

| Property   | Value                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint   | `GET /repos/{owner}/{repo}/contents/{path}`                                                                                             |
| Parameters | `owner` (string, required), `repo` (string, required), `path` (string, required), `ref` (string, optional — branch, tag, or commit SHA) |
| Behavior   | Fetches file from GitHub Contents API, base64-decodes `content`, returns UTF-8 text                                                     |

**Edge cases:**

- File not found → 404
- Repo not found → 404
- Path is a directory → API returns a JSON array — detect and return "Path is a directory, not a file"
- File is a symlink → API returns `type: "symlink"` and `target` field — decode the target and return the link, not the content
- File is a submodule → API returns `type: "submodule"` — return the submodule URL and commit SHA
- File >1MB → API returns `content: null` with `size` set — return "File exceeds 1MB (size: X bytes), not supported by the Contents API"
- File is binary → Contents API returns base64 regardless; check file extension against known binary types (`.png`, `.jpg`, `.pdf`, `.zip`, etc.) — return "File appears to be binary (X bytes), cannot display as text"
- Branch doesn't exist → 404 with body containing "Not Found" — distinguish from file-not-found by checking the response; return "Branch '{ref}' not found"
- Empty file → `content` is `""`, decode yields `""` — return empty content, not an error
- No file extension → treat as text; let the decode speak for itself

**Tool description:**

```
Read a single file from a GitHub repository.
Use when asked to inspect a file's contents, check configuration, or review source code.
The file must be under 1MB (hard GitHub API limit for the Contents endpoint).
Optionally specify a branch, tag, or commit SHA via the ref parameter.
Returns the decoded UTF-8 text content.
```

### Tool 3: `create_issue`

| Property         | Value                                                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint         | `POST /repos/{owner}/{repo}/issues`                                                                                                                                                                        |
| Parameters       | `owner` (string, required), `repo` (string, required), `title` (string, required, 1-256 chars), `body` (string, optional), `labels` (array of strings, optional), `assignees` (array of strings, optional) |
| Behavior         | Creates a new issue; returns the issue number, title, URL                                                                                                                                                  |
| Write operation? | Yes                                                                                                                                                                                                        |

**Tool description — THIS IS THE CRITICAL ONE:**

```
Create a new GitHub issue in a repository.
ONLY use this tool when the user EXPLICITLY asks to create an issue, file a bug report, or open a new issue.
DO NOT create issues for the user without their explicit request.
Title is required. Body, labels, and assignees are optional.
Rate limit: approximately 90 issue creations per hour for personal accounts.
Returns the created issue's number, title, and URL.
```

The description must be a hard gate. If it's too vague ("Creates a GitHub issue"), the AI agent will call it during code review whenever it finds a bug — which is almost never the desired behavior.

**Edge cases:**

- Empty title → Zod `min(1)` catches; return validation error
- Title >256 chars → Zod max or GitHub 422
- Invalid label → GitHub returns 422 with error details in body
- Labels don't exist in repo → GitHub returns 422
- Assignee not a collaborator → GitHub returns 422
- Issues disabled for repo → GitHub returns 410 or 403
- Rate limited → 403 rate limit with `X-RateLimit-Reset` header — include wait time in user message
- Token lacks write permission → 403 forbidden
- Private repo + no access → 404

### Tool 4: `post_comment`

| Property         | Value                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Endpoint         | `POST /repos/{owner}/{repo}/issues/{issue_number}/comments`                                                                          |
| Parameters       | `owner` (string, required), `repo` (string, required), `issue_number` (number, required, >= 1), `body` (string, required, non-empty) |
| Behavior         | Posts a comment on an existing issue; returns comment ID and URL                                                                     |
| Write operation? | Yes                                                                                                                                  |

**Edge cases:**

- Issue doesn't exist → 404 — check that issue_number is a positive integer and return "Issue #{n} not found in {owner}/{repo}"
- Issue is locked (no new comments) → 403 with "Issue is locked"
- Issue was deleted → 410
- Invalid issue_number (0, negative, decimal) → Zod `.int().min(1)` catches
- Empty body → reject as a likely mistake; require non-empty string
- Token lacks write permission → 403 forbidden
- Repo not found → 404

**Tool description:**

```
Post a comment on a specific GitHub issue.
ONLY use this tool when the user EXPLICITLY asks to comment on an issue, add a note, or reply.
Requires the exact issue number. Body text is required and must not be empty.
Returns the comment ID and URL.
```

---

## 5. Tool Descriptions as Decision Gates

Tool descriptions are not documentation — they are the AI agent's decision boundary. The agent reads the description to decide whether the current user request matches this tool. If the description is vague, the agent will:

- Call `create_issue` during code review when it finds a bug (bad)
- Call `post_comment` when summarizing findings (bad)
- Call `list_open_issues` when asked about repo health (good — this is the right call)

The Tool 3 and Tool 4 descriptions include "ONLY use this tool when the user EXPLICITLY asks..." to create a deliberate friction gate.

---

## 6. Design Decisions

### Why a shared HTTP client instead of inline fetch()

Each tool currently duplicates auth headers, URL construction, error parsing, and timeout logic. For 1 tool, inline is fine. For 4 tools, the shared client eliminates ~30 lines of duplication per tool and ensures consistent error classification. Testing also gets a single mock surface.

### Why not msw / nock for tests

`vitest` + `vi.fn(globalThis.fetch)` is sufficient for 4 tools that each make 1 HTTP call. Mocking fetch at the language level avoids adding a dependency. If the project grows to 10+ tools with complex interaction patterns, migrate to MSW.

### Why Vitest over Jest or Mocha

The project is already ESM (`"type": "module"` in package.json). Vitest has native ESM support with zero config for this setup. Jest requires additional configuration for ESM transform. Mocha needs a reporter and assertion library.

### Why no retry logic in v1

Rate-limit errors carry a `retry-after` header. An automated retry that fires immediately would waste a request. The error message tells the AI agent how long to wait — the agent can decide whether to retry. Adding retry-with-backoff later is straightforward: add a `maxRetries` option to `githubRequest()` and check the `retry-after` header.

### Why filter PRs from list_open_issues

The GitHub Issues endpoint includes pull requests by design (they share the number space). A user asking for "open issues" means actual issues, not PRs. PRs are tagged with `[PR]` in the response as a courtesy, but the default excludes them. Advanced usage can add an `include_prs: boolean` parameter later.

### Why require non-empty body for post_comment

Empty comments are technically valid but almost always a mistake in an agent interaction. The agent may have a hallucinated empty response. Requiring non-empty body catches this at the validation layer.

---

## 7. Testing Strategy

| Test                       | What it covers                                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github-client.test.ts`    | URL construction, auth header, error classification for every HTTP status, timeout behavior, network error handling, valid response parsing         |
| `list-open-issues.test.ts` | Happy path (issues returned), empty repo, 401, 403 rate limit, 403 forbidden, 404, PR filtering, pagination parameters                              |
| `read-repo-file.test.ts`   | Happy path (file decoded), file not found, repo not found, directory path, binary file, file >1MB, empty file, symlink, submodule, branch not found |
| `create-issue.test.ts`     | Happy path (issue created), empty title, title too long, 401, 403 rate limit, 403 forbidden, 404, 422 invalid labels, issues disabled               |
| `post-comment.test.ts`     | Happy path (comment created), issue not found, locked issue, deleted issue, invalid issue number, empty body, 403 forbidden                         |

Test structure: Vitest describe/it blocks, mock `globalThis.fetch` for each case, assert both the MCP content response and the error category.

---

## 8. Out of Scope (v1)

These are explicitly NOT part of this project's current scope. Writing code for any of these without being asked is scope creep.

- OAuth / GitHub App authentication (PAT only)
- Issue updates (PATCH /issues/{n})
- Issue close/reopen
- Search issues (GET /search/issues)
- GraphQL API
- Response caching
- Retry with exponential backoff
- Webhook support
- Markdown rendering of issue bodies
- Multi-file read operations
- Repository metadata (stars, forks, description)

If the user asks for any of these, acknowledge it's out of v1 scope and discuss before implementing.

---

## 9. Session Handoff Conventions

When ending a session mid-work, leave the workspace in a state that the next session can continue without reading the conversation history:

1. **Write a handoff summary** at the top of ARCHITECTURE.md under a `## Session State` heading with: completed tools, in-progress tool, known issues, next action
2. **Leave tests passing** — if tests were passing before your changes, they should still pass. If you broke tests, note why
3. **Don't leave partial imports** — if a file imports from a module that doesn't exist yet, that's a compile error. Comment it out with a `// TODO: uncomment when module exists` marker
4. **Update the checklist** — if you're tracking with a checklist, commit the final state
5. **Commit to git** — `git add -A && git commit -m "session: <summary>"` so the next session can start from a clean `HEAD`

---

## 10. State (Updated Each Session)

<!-- This section is overwritten at the end of each session with the current rollout status. -->

Current as of session start: **No tools implemented yet except list_open_issues.**

| Tool               | Status                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `list_open_issues` | Implemented in `src/index.ts` — needs extraction to `src/tools/list-open-issues.ts` and migration to shared client |
| `read_repo_file`   | Not implemented                                                                                                    |
| `create_issue`     | Not implemented                                                                                                    |
| `post_comment`     | Not implemented                                                                                                    |
| `github-client.ts` | Not created                                                                                                        |
| `README.md`        | Stale — references Python                                                                                          |
| `AGENTS.md`        | Stale — references Python, missing file layout                                                                     |
| Tests              | Not created                                                                                                        |
