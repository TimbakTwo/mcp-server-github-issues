# test_tool.py
import asyncio
import os
from dotenv import load_dotenv

# Import your actual tool function
from server import list_open_issues

load_dotenv()

async def run_tests():
    print("=" * 50)
    print("TEST 1: Happy Path (Public repo with issues)")
    print("-" * 50)
    result = await list_open_issues("python", "cpython", per_page=5)
    print(result)
    print("\n")

    print("=" * 50)
    print("TEST 2: Repo does NOT exist (Expect 404 error message)")
    print("-" * 50)
    result = await list_open_issues("this-repo-does-not-exist-12345", "fake-repo")
    print(result)
    print("\n")

    print("=" * 50)
    print("TEST 3: Repo exists but has ZERO open issues")
    print("-" * 50)
    # Note: Replace 'your-username' and 'empty-repo' with a real repo you own that has 0 issues.
    # If you don't have one, just skip this test or create a dummy repo on GitHub.
    result = await list_open_issues("timbaktwo", "UniverseSocial")
    print(result)
    print("\n")

    print("=" * 50)
    print("TEST 4: Invalid Token Simulation")
    print("-" * 50)
    print("(Manually change your .env token to a wrong one to test this)")
    # If you want to test this, temporarily edit your .env file, save it, and run this script again.

if __name__ == "__main__":
    asyncio.run(run_tests())