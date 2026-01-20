import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  generateWindowName,
  getConfigPath,
  getRepoFromPath,
  loadRepoConfig,
  processBranchName,
  processRepoName,
} from "../src/window-naming";

describe("loadRepoConfig", () => {
  let tempDir: string;
  let originalXdgConfig: string | undefined;
  let originalHome: string | undefined;

  beforeEach(() => {
    // Save original env vars
    originalXdgConfig = process.env.XDG_CONFIG_HOME;
    originalHome = process.env.HOME;

    // Create temp directory for config
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-test-"));
    process.env.XDG_CONFIG_HOME = tempDir;
  });

  afterEach(() => {
    // Restore env vars
    if (originalXdgConfig !== undefined) {
      process.env.XDG_CONFIG_HOME = originalXdgConfig;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    }

    // Cleanup temp dir
    try {
      fs.rmSync(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("returns empty map when config file doesn't exist", () => {
    const config = loadRepoConfig();
    expect(config.size).toBe(0);
  });

  test("parses valid config file", () => {
    // Create config directory and file
    const configDir = path.join(tempDir, "cmux");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "repos"),
      "claude-cli-internal=cli\nsome-long-repo=short\n",
    );

    const config = loadRepoConfig();
    expect(config.get("claude-cli-internal")).toBe("cli");
    expect(config.get("some-long-repo")).toBe("short");
  });

  test("ignores comments and blank lines", () => {
    const configDir = path.join(tempDir, "cmux");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "repos"),
      "# This is a comment\n\nrepo1=alias1\n# Another comment\nrepo2=alias2\n\n",
    );

    const config = loadRepoConfig();
    expect(config.size).toBe(2);
    expect(config.get("repo1")).toBe("alias1");
    expect(config.get("repo2")).toBe("alias2");
  });

  test("handles whitespace around key=value", () => {
    const configDir = path.join(tempDir, "cmux");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "repos"),
      "  repo1  =  alias1  \nrepo2=alias2\n",
    );

    const config = loadRepoConfig();
    expect(config.get("repo1")).toBe("alias1");
    expect(config.get("repo2")).toBe("alias2");
  });

  test("ignores lines without equals sign", () => {
    const configDir = path.join(tempDir, "cmux");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "repos"),
      "invalid line\nrepo1=alias1\nalso invalid\n",
    );

    const config = loadRepoConfig();
    expect(config.size).toBe(1);
    expect(config.get("repo1")).toBe("alias1");
  });
});

describe("processRepoName", () => {
  test("returns config alias when available", () => {
    const config = new Map([["long-repo-name", "short"]]);
    expect(processRepoName("long-repo-name", config)).toBe("short");
  });

  test("returns repo name as-is regardless of length", () => {
    const config = new Map<string, string>();
    expect(processRepoName("myrepo", config)).toBe("myrepo");
    expect(processRepoName("1234567890", config)).toBe("1234567890");
    // No longer truncates - UI layer handles display truncation
    expect(processRepoName("12345678901", config)).toBe("12345678901");
    expect(processRepoName("claude-cli-internal", config)).toBe(
      "claude-cli-internal",
    );
  });

  test("config alias takes precedence", () => {
    const config = new Map([["very-long-repository-name", "vlrn"]]);
    expect(processRepoName("very-long-repository-name", config)).toBe("vlrn");
  });
});

describe("processBranchName", () => {
  test("returns null for main branch", () => {
    expect(processBranchName("main")).toBe(null);
  });

  test("returns null for master branch", () => {
    expect(processBranchName("master")).toBe(null);
  });

  test("returns null for empty branch", () => {
    expect(processBranchName("")).toBe(null);
  });

  test("strips prefix before last slash", () => {
    expect(processBranchName("fix/bug-123")).toBe("bug-123");
    expect(processBranchName("feature/new-feature")).toBe("new-feature");
    expect(processBranchName("user/alice/experiment")).toBe("experiment");
  });

  test("returns branch as-is when no slash", () => {
    expect(processBranchName("hotfix-123")).toBe("hotfix-123");
    expect(processBranchName("abc123")).toBe("abc123");
  });
});

describe("generateWindowName", () => {
  // Note: These tests mock getRepoFromPath behavior via testing with non-git paths

  test("uses basename for non-git directories", () => {
    // /tmp is unlikely to be a git repo
    const name = generateWindowName("/tmp", new Map());
    expect(name).toBe("tmp");
  });

  test("returns 'shell' for empty path", () => {
    const name = generateWindowName("", new Map());
    expect(name).toBe("shell");
  });

  test("returns full basename without truncation", () => {
    // No longer truncates - UI layer handles display truncation
    const longName = "/tmp/this-is-a-very-long-directory-name";
    const name = generateWindowName(longName, new Map());
    expect(name).toBe("this-is-a-very-long-directory-name");
  });

  test("returns full name for any path length", () => {
    // Names are no longer limited - UI layer handles truncation
    const paths = ["/tmp", "/usr/local/bin", "/home/user/very-long-path-name"];
    const expected = ["tmp", "bin", "very-long-path-name"];
    const config = new Map<string, string>();

    for (let i = 0; i < paths.length; i++) {
      const name = generateWindowName(paths[i], config);
      expect(name).toBe(expected[i]);
    }
  });
});

describe("getConfigPath", () => {
  let originalXdgConfig: string | undefined;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalXdgConfig = process.env.XDG_CONFIG_HOME;
    originalHome = process.env.HOME;
  });

  afterEach(() => {
    if (originalXdgConfig !== undefined) {
      process.env.XDG_CONFIG_HOME = originalXdgConfig;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    }
  });

  test("uses XDG_CONFIG_HOME when set", () => {
    process.env.XDG_CONFIG_HOME = "/custom/config";
    expect(getConfigPath()).toBe("/custom/config/cmux/repos");
  });

  test("falls back to ~/.config when XDG_CONFIG_HOME not set", () => {
    delete process.env.XDG_CONFIG_HOME;
    process.env.HOME = "/home/testuser";
    expect(getConfigPath()).toBe("/home/testuser/.config/cmux/repos");
  });
});

describe("getRepoFromPath with worktrees", () => {
  let tempDir: string;
  let mainRepoPath: string;
  let worktreePath: string;
  const branchName = "feature-xyz";

  beforeEach(() => {
    // Create temp directory structure
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-worktree-test-"));
    mainRepoPath = path.join(tempDir, "main-repo");
    worktreePath = path.join(tempDir, branchName); // Worktree named same as branch

    // Create main git repo
    fs.mkdirSync(mainRepoPath, { recursive: true });
    execFileSync("git", ["init", "-b", "main"], { cwd: mainRepoPath });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: mainRepoPath });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: mainRepoPath });
    fs.writeFileSync(path.join(mainRepoPath, "README.md"), "# Test");
    execFileSync("git", ["add", "."], { cwd: mainRepoPath });
    execFileSync("git", ["commit", "-m", "Initial commit"], { cwd: mainRepoPath });

    // Create worktree with branch name matching directory name
    execFileSync("git", ["worktree", "add", worktreePath, "-b", branchName], {
      cwd: mainRepoPath,
    });
  });

  afterEach(() => {
    // Clean up worktree first (required before deleting repo)
    try {
      execFileSync("git", ["worktree", "remove", worktreePath, "--force"], {
        cwd: mainRepoPath,
      });
    } catch {
      // Ignore if already removed
    }

    // Cleanup temp dir
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("returns main repo name when worktree is exactly {repo}-{branch}", () => {
    // Create worktree with pattern "main-repo-branchname"
    const testBranch = "my-feature";
    const patternWorktreePath = path.join(tempDir, `main-repo-${testBranch}`);
    execFileSync("git", ["worktree", "add", patternWorktreePath, "-b", testBranch], {
      cwd: mainRepoPath,
    });

    try {
      const result = getRepoFromPath(patternWorktreePath);
      expect(result).not.toBeNull();
      expect(result!.branch).toBe(testBranch);
      // Worktree "main-repo-my-feature" with branch "my-feature" -> repo "main-repo"
      expect(result!.repo).toBe("main-repo");
    } finally {
      execFileSync("git", ["worktree", "remove", patternWorktreePath, "--force"], {
        cwd: mainRepoPath,
      });
    }
  });

  test("returns worktree name when worktree does not match {repo}-{branch} pattern", () => {
    // Worktree named just "feature-xyz" (same as branch) doesn't match "main-repo-feature-xyz"
    const result = getRepoFromPath(worktreePath);
    expect(result).not.toBeNull();
    expect(result!.branch).toBe(branchName);
    // Worktree "feature-xyz" != "main-repo-feature-xyz", so return worktree name
    expect(result!.repo).toBe(branchName);
  });

  test("returns worktree name when worktree has different prefix than repo", () => {
    // Create worktree with a different prefix
    const otherWorktreePath = path.join(tempDir, "other-prefix-some-branch");
    execFileSync("git", ["worktree", "add", otherWorktreePath, "-b", "some-branch"], {
      cwd: mainRepoPath,
    });

    try {
      const result = getRepoFromPath(otherWorktreePath);
      expect(result).not.toBeNull();
      expect(result!.branch).toBe("some-branch");
      // "other-prefix-some-branch" != "main-repo-some-branch", so return worktree name
      expect(result!.repo).toBe("other-prefix-some-branch");
    } finally {
      execFileSync("git", ["worktree", "remove", otherWorktreePath, "--force"], {
        cwd: mainRepoPath,
      });
    }
  });

  test("returns directory name for regular repos even when branch matches", () => {
    // For the main repo on main branch, branch might match directory name
    // This tests that we don't incorrectly apply the worktree logic
    const result = getRepoFromPath(mainRepoPath);
    expect(result).not.toBeNull();
    // Main repo should return its directory name
    expect(result!.repo).toBe("main-repo");
  });
});
