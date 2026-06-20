# MCP GitHub Issues Server

An MCP (Model Context Protocol) server for listing GitHub issues, built with FastMCP.

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Create .env file with your GitHub token
echo "GITHUB_TOKEN=github_pat_..." > .env

# Test the server
python test_tool.py

# Register with Claude Code
claude mcp add github-issues -- python server.py

## Authentication

This MCP server uses a fine‑grained Personal Access Token (PAT) for authentication.

### Setup

1. Create a fine‑grained PAT at [GitHub Developer Settings](https://github.com/settings/tokens?type=beta).
2. Scope it to **only the repositories you intend to use**.
3. Grant only the permissions required (e.g., Issues: Read & Write, Contents: Read).
4. Store the token in a `.env` file as `GITHUB_TOKEN`, or pass it via the MCP config’s `env` field.

### Why a PAT and not OAuth?

A PAT is suitable for a single‑user development tool. In a production multi‑user environment, I would implement an OAuth flow using a GitHub App. That would allow each user to authorise the app on their own repositories, with per‑user permission scopes, short‑lived refreshable tokens, and webhook support. This project intentionally uses a PAT to keep the focus on the MCP server logic and tool design.

### Security principles applied

- **Least privilege**: The token is scoped to the minimum repositories and permissions needed.
- **Secret storage**: The token is never hardcoded and is kept out of version control via `.gitignore`.
```
