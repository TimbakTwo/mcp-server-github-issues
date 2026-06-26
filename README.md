# MCP GitHub Issues Server

An MCP (Model Context Protocol) server for listing, reading, creating, and commenting on GitHub issues — built with the official MCP TypeScript SDK.

## Tools

The server exposes 4 tools for Claude to use:

### 1. `list_open_issues`
List open issues in a repository. Filters out pull requests. Supports pagination.

- **Parameters:** `owner`, `repo`, `per_page` (optional, default 30), `page` (optional, default 1)
- **Returns:** Issue number, title, URL for each issue
- **Errors:** Repository not found, authentication failure, rate limited

### 2. `read_repo_file`
Read a single file from a repository and return its decoded text content.

- **Parameters:** `owner`, `repo`, `path`, `ref` (optional — branch, tag, or SHA)
- **Returns:** File contents decoded from base64
- **Errors:** File not found, binary file, path is a directory, file exceeds 1MB limit, branch not found

### 3. `create_issue`
Create a new issue in a repository.

- **Parameters:** `owner`, `repo`, `title` (required), `body` (optional), `labels` (optional), `assignees` (optional)
- **Returns:** Created issue number, title, URL
- **Errors:** Empty title, invalid labels, issues disabled, rate limited
- **Note:** Write operation — Claude only calls when you explicitly ask to create an issue.

### 4. `post_comment`
Post a comment on an existing issue.

- **Parameters:** `owner`, `repo`, `issue_number`, `body` (required)
- **Returns:** Comment ID and URL
- **Errors:** Issue not found, locked issue, empty body
- **Note:** Write operation — Claude only calls when you explicitly ask to comment.

## Quick Start

```bash
# Install dependencies
npm install

# Create .env file with your GitHub token
echo "GITHUB_TOKEN=github_pat_..." > .env

# Start the MCP server (stdio mode)
npm run dev

# Run tests
npm test

# Compile TypeScript
npm run build
```

## Register with Claude

```bash
claude mcp add github-issues -- npx tsx src/index.ts
```

## Authentication

This MCP server uses a fine-grained Personal Access Token (PAT) for authentication.

### Setup

1. Create a fine-grained PAT at [GitHub Developer Settings](https://github.com/settings/tokens?type=beta).
2. Scope it to **only the repositories you intend to use**.
3. Grant only the permissions required (e.g., Issues: Read & Write, Contents: Read).
4. Store the token in a `.env` file as `GITHUB_TOKEN`, or pass it via the MCP config's `env` field.

### Why a PAT and not OAuth?

A PAT is suitable for a single-user development tool. In a production multi-user environment, I would implement an OAuth flow using a GitHub App. That would allow each user to authorize the app on their own repositories, with per-user permission scopes, short-lived refreshable tokens, and webhook support. This project intentionally uses a PAT to keep the focus on the MCP server logic and tool design.

### Security principles applied

- **Least privilege:** The token is scoped to the minimum repositories and permissions needed.
- **Secret storage:** The token is never hardcoded and is kept out of version control via `.gitignore`.

## Input Validation

All tool parameters are validated at runtime with Zod — types, bounds, and required fields are checked before any API call is made. Invalid input returns a clear error message without hitting the GitHub API.

## Project Structure

```
src/
  index.ts              — Server setup and tool registration
  github-client.ts      — Shared HTTP client for GitHub API calls
  tools/
    list-open-issues.ts — Tool 1
    read-repo-file.ts   — Tool 2
    create-issue.ts     — Tool 3
    post-comment.ts     — Tool 4
```

See `ARCHITECTURE.md` for full design decisions, error taxonomy, and edge case handling.

## Tech Stack

- **Runtime:** Node.js (ESM)
- **Framework:** `@modelcontextprotocol/sdk`
- **Validation:** Zod
- **Authentication:** GitHub fine-grained PAT
- **Testing:** Vitest

## License

ISC