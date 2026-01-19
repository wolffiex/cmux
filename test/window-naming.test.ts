import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  generateWindowName,
  getConfigPath,
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
