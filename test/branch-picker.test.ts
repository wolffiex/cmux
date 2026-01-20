import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { deleteWorktree } from "../src/worktree-utils";

describe("worktree deletion", () => {
  let tempDir: string;
  let mainRepoPath: string;

  beforeEach(() => {
    // Create temp directory structure
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-branch-test-"));
    mainRepoPath = path.join(tempDir, "test-repo");

    // Create main git repo
    fs.mkdirSync(mainRepoPath, { recursive: true });
    execFileSync("git", ["init", "-b", "main"], { cwd: mainRepoPath });
    execFileSync("git", ["config", "user.email", "test@test.com"], {
      cwd: mainRepoPath,
    });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: mainRepoPath });
    fs.writeFileSync(path.join(mainRepoPath, "README.md"), "# Test");
    execFileSync("git", ["add", "."], { cwd: mainRepoPath });
    execFileSync("git", ["commit", "-m", "Initial commit"], {
      cwd: mainRepoPath,
    });
  });

  afterEach(() => {
    // Cleanup temp dir
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("deleting worktree also deletes branch with same name", () => {
    const branchName = "feature-xyz";
    const worktreePath = path.join(tempDir, branchName);

    // Create worktree with branch of same name as directory
    execFileSync("git", ["worktree", "add", worktreePath, "-b", branchName], {
      cwd: mainRepoPath,
    });

    // Verify worktree and branch exist
    const worktreesBefore = execFileSync("git", ["worktree", "list"], {
      cwd: mainRepoPath,
      encoding: "utf-8",
    });
    expect(worktreesBefore).toContain(branchName);

    const branchesBefore = execFileSync("git", ["branch"], {
      cwd: mainRepoPath,
      encoding: "utf-8",
    });
    expect(branchesBefore).toContain(branchName);

    // Delete worktree - should also delete the branch
    deleteWorktree(mainRepoPath, worktreePath);

    // Verify worktree is gone
    const worktreesAfter = execFileSync("git", ["worktree", "list"], {
      cwd: mainRepoPath,
      encoding: "utf-8",
    });
    expect(worktreesAfter).not.toContain(branchName);

    // Verify branch is also gone - THIS SHOULD FAIL until we implement the feature
    const branchesAfter = execFileSync("git", ["branch"], {
      cwd: mainRepoPath,
      encoding: "utf-8",
    });
    expect(branchesAfter).not.toContain(branchName);
  });
});
