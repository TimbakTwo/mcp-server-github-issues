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
    return {
      content: [
        {
          type: "text",
          text: `Listing issues for ${owner}/${repo}...`,
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("MCP server running on stdio");
