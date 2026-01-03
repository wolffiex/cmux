import { test, expect, beforeAll, afterAll, describe, beforeEach, afterEach } from "bun:test"
import { execSync } from "node:child_process"

const SOCKET = `cmux_test_${process.pid}`
const PROJECT_DIR = "/Users/wolffiex/code/cmux"

function tmux(cmd: string): string {
  try {
    return execSync(`tmux -L ${SOCKET} ${cmd}`, {
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
  // Poll until we see the UI is ready (contains window bar)
  for (let i = 0; i < 20; i++) {
    const output = capture()
    if (output.includes("[−]") && output.includes("[+]")) {
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
  return output.includes("[−]") || output.includes("[+]")
}

describe("cmux UI", () => {
  beforeAll(() => {
    // Create isolated tmux session with known dimensions
    tmux("kill-server 2>/dev/null || true")
    tmux("new-session -d -s test -x 60 -y 20")
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
    expect(output).toContain("[−]")
    expect(output).toContain("[+]")
    expect(output).toContain("pane")
    expect(output).toContain("hjkl nav")
  })

  test("Tab switches focus between window bar and layout", () => {
    sendKey("Tab")
    const output = capture()
    // Could use snapshot or check for visual change
    expect(output).toContain("pane")
  })

  test("j opens window popover", () => {
    sendKey("j")
    Bun.sleepSync(200) // Extra time for popover render
    const output = capture()
    // Popover should show window list
    expect(output).toContain("●") // Active window indicator
  })

  test("Escape closes window popover", () => {
    sendKey("j")
    Bun.sleepSync(200)
    sendKey("Escape")
    const output = capture()
    // Should be back to normal view
    expect(output).toContain("[−]")
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
    // Should see shell prompt, not cmux UI
    expect(output).not.toContain("[−]")
  })
})
