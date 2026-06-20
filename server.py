import sys
import os
import httpx
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

load_dotenv()
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN")

if not GITHUB_TOKEN:
    print("ERROR: GITHUB_TOKEN not found in .env file!", file=sys.stderr)
    sys.exit(1)

mcp = FastMCP("github-issues-server")

@mcp.tool()
async def list_open_issues(
    owner: str,
    repo: str,
    per_page: int = 30
) -> str:
    """
    List all open issues in a GitHub repository.

    Returns the issue number, title, and URL for each open issue.
    Use this when a user asks to see open issues, bugs, or tasks in a repository.
    """
    # DEBUG LOGGING (this goes to stderr, safe for MCP)
    print(f"[DEBUG] Fetching issues for {owner}/{repo}", file=sys.stderr)

    url = f"https://api.github.com/repos/{owner}/{repo}/issues"
    
    headers = {
        "Authorization": f"token {GITHUB_TOKEN}",
        "Accept": "application/vnd.github.v3+json"
    }
    
    params = {
        "state": "open",
        "per_page": min(per_page, 100),
        "page": 1
    }
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=headers, params=params)
            
            # DEBUG: Log the status code
            print(f"[DEBUG] GitHub responded with status: {response.status_code}", file=sys.stderr)

            # --- ERROR HANDLING (All return strings, no crashes) ---
            if response.status_code == 404:
                return f"Repository '{owner}/{repo}' not found or you don't have access. Please check the name and your token permissions."
            
            if response.status_code == 401:
                return "GitHub authentication failed. Your Personal Access Token (PAT) is invalid, expired, or incorrectly formatted. Please check your .env file and regenerate the token if needed."
            
            if response.status_code == 403:
                if "rate limit" in response.text.lower():
                    return "GitHub API rate limit exceeded. Please wait a few minutes and try again."
                return f"Access denied to '{owner}/{repo}'. Your token may lack 'Issues: read' permission."
            
            if response.status_code != 200:
                return f"GitHub API error: {response.status_code} - {response.text[:200]}"
            
            issues = response.json()
            
            if not issues:
                return f"No open issues found in '{owner}/{repo}'."
            
            # Format the results
            result = f"Open issues in {owner}/{repo}:\n\n"
            for issue in issues:
                pr_tag = " [PR]" if issue.get("pull_request") else ""
                result += f"#{issue['number']}{pr_tag}: {issue['title']}\n"
                result += f"  {issue['html_url']}\n\n"
            
            return result.strip()
            
    except httpx.TimeoutException:
        return "Request timed out. GitHub may be slow or the repository may be very large."
    except Exception as e:
        # Log the FULL Python exception to stderr for you to read
        print(f"UNEXPECTED ERROR: {e}", file=sys.stderr)
        return f"An unexpected error occurred: {str(e)}"

if __name__ == "__main__":
    # This is what Claude Desktop will spawn
    mcp.run()