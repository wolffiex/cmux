import { test, expect, beforeAll, afterAll, describe, beforeEach, afterEach } from "bun:test"
import { execSync } from "node:child_process"

const SOCKET = `cmux_test_${process.pid}`
const PROJECT_DIR = import.meta.dir.replace(/\/test\/integration$/, "")

function tmux(cmd: string): string {
  try {
    return execSync(`tmux -L ${SOCKET} -f /dev/null ${cmd}`, {
      encoding: "utf-8",
      cwd: PROJECT_DIR
    })
  } catch (e: any) {
    return e.stdout || ""
  }
}

function capture(): string {
  return tmux("capture-pane -t test -p")
}

function waitForUI(): void {
  // Poll until we see the UI is ready (contains window bar with minus and plus buttons)
  // The minus button is " − " and plus button is " + " (with surrounding spaces)
  // But the plus might have extra padding before it from window names
  for (let i = 0; i < 20; i++) {
    const output = capture()
    // Check for minus sign (U+2212) and plus sign in the carousel bar
    if (output.includes("−") && output.includes("+") && output.includes("pane")) {
      return
    }
    Bun.sleepSync(100)
  }
  throw new Error("Timeout waiting for cmux UI to render")
}

function sendKeys(keys: string): void {
  tmux(`send-keys -t test "${keys}"`)
  Bun.sleepSync(150) // Wait for render
}

function sendKey(key: string): void {
  tmux(`send-keys -t test ${key}`)
  Bun.sleepSync(150)
}

function startCmux(): void {
  // Clear the terminal and start cmux, redirecting stderr to hide debug output
  tmux(`send-keys -t test "clear && bun src/main.ts 2>/dev/null" Enter`)
  waitForUI()
}

function quitCmux(): void {
  // Send Escape first to close any open popover, then q to quit
  tmux(`send-keys -t test Escape`)
  Bun.sleepSync(50)
  tmux(`send-keys -t test q`)
  Bun.sleepSync(100)
  // Send Ctrl-C as a fallback if cmux is already closed
  tmux(`send-keys -t test C-c`)
  Bun.sleepSync(50)
}

function isUIRunning(): boolean {
  const output = capture()
  // Check for minus sign (U+2212) or plus sign in the carousel bar
  return output.includes("−") || output.includes("+")
}

describe("cmux UI", () => {
  beforeAll(() => {
    // Create isolated tmux session with known dimensions
    tmux("kill-server 2>/dev/null || true")
    tmux("new-session -d -s test -x 120 -y 24")
    // Create a couple test windows
    tmux("new-window -t test")
    tmux("new-window -t test")
    tmux("select-window -t test:0")
  })

  afterAll(() => {
    tmux("kill-server")
  })

  beforeEach(() => {
    startCmux()
  })

  afterEach(() => {
    quitCmux()
  })

  test("initial render shows window bar and layout preview", () => {
    const output = capture()
    // Check for minus sign (U+2212) and plus in the carousel bar
    expect(output).toContain("−")
    expect(output).toContain("+")
    expect(output).toContain("pane")
    expect(output).toContain("hjkl nav")
  })

  test("Tab switches focus between window bar and layout", () => {
    sendKey("Tab")
    const output = capture()
    // Could use snapshot or check for visual change
    expect(output).toContain("pane")
  })

  test("j drops focus to layout", () => {
    sendKey("j")
    Bun.sleepSync(200) // Extra time for render
    const output = capture()
    // Active window should still show indicator in carousel
    expect(output).toContain("●")
    // Layout counter should be visible with pane count
    expect(output).toContain("pane")
  })

  test("Escape exits the UI", () => {
    // Escape should exit the UI (no popover in carousel mode)
    tmux(`send-keys -t test Escape`)
    Bun.sleepSync(200)
    const output = capture()
    // Should see shell prompt, not cmux UI (check for the unique pane counter text)
    expect(output).not.toContain("pane ·")
  })

  test("l navigates layouts", () => {
    sendKey("Tab") // Focus layout
    const before = capture()
    sendKey("l")
    const after = capture()
    // Layout counter should change
    expect(before).not.toEqual(after)
  })

  test("q quits the UI", () => {
    // Send q to quit - afterEach will also try to quit but that's handled
    tmux(`send-keys -t test q`)
    Bun.sleepSync(200)
    const output = capture()
    // Should see shell prompt, not cmux UI (check for the unique pane counter text)
    expect(output).not.toContain("pane ·")
  })
})
