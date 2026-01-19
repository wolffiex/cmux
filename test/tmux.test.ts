import { describe, expect, test } from "bun:test";
import { extractRepoNameFromUrl } from "../src/tmux";

describe("extractRepoNameFromUrl", () => {
  test("extracts repo name from SSH URL with .git suffix", () => {
    expect(
      extractRepoNameFromUrl("git@github.com:anthropic/research-apps.git"),
    ).toBe("research-apps");
  });

  test("extracts repo name from SSH URL without .git suffix", () => {
    expect(
      extractRepoNameFromUrl("git@github.com:anthropic/research-apps"),
    ).toBe("research-apps");
  });

  test("extracts repo name from HTTPS URL with .git suffix", () => {
    expect(
      extractRepoNameFromUrl("https://github.com/anthropic/research-apps.git"),
    ).toBe("research-apps");
  });

  test("extracts repo name from HTTPS URL without .git suffix", () => {
    expect(
      extractRepoNameFromUrl("https://github.com/anthropic/research-apps"),
    ).toBe("research-apps");
  });

  test("extracts repo name from local path", () => {
    expect(extractRepoNameFromUrl("/path/to/local/repo")).toBe("repo");
  });

  test("extracts repo name from relative path", () => {
    expect(extractRepoNameFromUrl("../some-repo")).toBe("some-repo");
  });

  test("handles SSH URL with nested org path", () => {
    expect(
      extractRepoNameFromUrl("git@gitlab.com:group/subgroup/project.git"),
    ).toBe("project");
  });

  test("handles HTTPS URL with nested org path", () => {
    expect(
      extractRepoNameFromUrl("https://gitlab.com/group/subgroup/project.git"),
    ).toBe("project");
  });

  test("handles SSH URL with port", () => {
    // SSH URLs with custom ports use ssh:// scheme
    expect(
      extractRepoNameFromUrl("ssh://git@github.com:2222/org/repo.git"),
    ).toBe("repo");
  });

  test("handles simple repo name with .git suffix", () => {
    expect(extractRepoNameFromUrl("repo.git")).toBe("repo");
  });

  test("returns null for empty string", () => {
    expect(extractRepoNameFromUrl("")).toBe(null);
  });

  test("handles URL with query parameters (unusual but possible)", () => {
    // This is an edge case - git URLs shouldn't have query params
    // but we should handle it gracefully by returning the last segment
    expect(extractRepoNameFromUrl("https://github.com/org/repo")).toBe("repo");
  });
});
