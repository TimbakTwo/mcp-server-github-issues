import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import "dotenv/config";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
  console.error("ERROR: GITHUB_TOKEN not found in .env file!");
  process.exit(1);
}

const server = new McpServer({
  name: "github-issues-server",
  version: "1.0.0",
});

server.tool(
  "list_open_issues",
  {
    owner: z.string().describe("Repository owner (username or organization)"),
    repo: z.string().describe("Repository name"),
    per_page: z
      .number()
      .optional()
      .default(30)
      .describe("Number of issues per page (max 100)"),
  },
  async ({ owner, repo, per_page }) => {
    try {
      console.error(`[DEBUG] Fetching issues for ${owner}/${repo}`);

      const url = `https://api.github.com/repos/${owner}/${repo}/issues`;
      const params = new URLSearchParams({
        state: "open",
        per_page: String(Math.min(per_page, 100)),
        page: "1",
      });

      const response = await fetch(`${url}?${params}`, {
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      console.error(`[DEBUG] GitHub responded with status: ${response.status}`);

      if (response.status === 404) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Repository '${owner}/${repo}' not found or you don't have access. Please check the name and your token permissions.`,
            },
          ],
        };
      }

      if (response.status === 401) {
        return {
          content: [
            {
              type: "text" as const,
              text: "GitHub authentication failed. Your Personal Access Token (PAT) is invalid, expired, or incorrectly formatted. Please check your .env file and regenerate the token if needed.",
            },
          ],
        };
      }

      if (response.status === 403) {
        const text = await response.text();
        if (text.toLowerCase().includes("rate limit")) {
          return {
            content: [
              {
                type: "text" as const,
                text: "GitHub API rate limit exceeded. Please wait a few minutes and try again.",
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Access denied to '${owner}/${repo}'. Your token may lack 'Issues: read' permission.`,
            },
          ],
        };
      }

      if (!response.ok) {
        const text = await response.text();
        return {
          content: [
            {
              type: "text" as const,
              text: `GitHub API error: ${response.status} - ${text.slice(0, 200)}`,
            },
          ],
        };
      }

      const issues = (await response.json()) as any[];

      if (!issues || issues.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No open issues found in '${owner}/${repo}'.`,
            },
          ],
        };
      }

      // Format the results
      let result = `Open issues in ${owner}/${repo}:\n\n`;
      for (const issue of issues) {
        const prTag = issue.pull_request ? " [PR]" : "";
        result += `#${issue.number}${prTag}: ${issue.title}\n`;
        result += `  ${issue.html_url}\n\n`;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: result.trim(),
          },
        ],
      };
    } catch (error) {
      // Log the FULL error to stderr for debugging
      console.error(`UNEXPECTED ERROR: ${error}`, file);

      if (error instanceof Error && error.name === "TimeoutError") {
        return {
          content: [
            {
              type: "text" as const,
              text: "Request timed out. GitHub may be slow or the repository may be very large.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `An unexpected error occurred: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
);

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("MCP server running on stdio");
