import { test, expect, beforeAll, afterAll, describe } from "bun:test"
import { execSync } from "node:child_process"

const SOCKET = `cmux_layout_test_${process.pid}`
const PROJECT_DIR = import.meta.dir.replace(/\/test\/integration$/, "")

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

function getPaneIds(): string[] {
  const output = tmux("list-panes -t test:0 -F '#{pane_id}'")
  return output.trim().split("\n").filter(Boolean)
}

function getPaneInfo(): Array<{ id: string; x: number; y: number; w: number; h: number }> {
  const output = tmux("list-panes -t test:0 -F '#{pane_id}:#{pane_left}:#{pane_top}:#{pane_width}:#{pane_height}'")
  return output.trim().split("\n").filter(Boolean).map(line => {
    const [id, x, y, w, h] = line.split(":")
    return { id, x: Number(x), y: Number(y), w: Number(w), h: Number(h) }
  })
}

function sendKeys(keys: string): void {
  tmux(`send-keys -t test:0 "${keys}"`)
  Bun.sleepSync(150)
}

function sendKey(key: string): void {
  tmux(`send-keys -t test:0 ${key}`)
  Bun.sleepSync(150)
}

function waitForUI(): void {
  for (let i = 0; i < 20; i++) {
    const output = tmux("capture-pane -t test:0 -p")
    if (output.includes("pane") && output.includes("hjkl")) {
      return
    }
    Bun.sleepSync(100)
  }
  throw new Error("Timeout waiting for cmux UI to render")
}

function startCmux(): void {
  tmux(`send-keys -t test:0 "clear && bun src/main.ts 2>/dev/null" Enter`)
  waitForUI()
}

function quitCmux(): void {
  tmux(`send-keys -t test:0 Escape`)
  Bun.sleepSync(50)
  tmux(`send-keys -t test:0 q`)
  Bun.sleepSync(100)
  tmux(`send-keys -t test:0 C-c`)
  Bun.sleepSync(50)
}

describe("layout application with position-based matching", () => {
  beforeAll(() => {
    // Create isolated tmux session with known dimensions
    tmux("kill-server 2>/dev/null || true")
    tmux("new-session -d -s test -x 80 -y 24")
  })

  afterAll(() => {
    tmux("kill-server")
  })

  test("preserves pane IDs when changing layouts", () => {
    // Start with a single pane - record its ID
    const initialPanes = getPaneIds()
    expect(initialPanes.length).toBe(1)
    const originalPaneId = initialPanes[0]

    // Start cmux and apply a 2-pane layout
    startCmux()

    // Navigate to a 2-pane layout (press l to cycle to next)
    sendKey("Tab") // Focus layout
    sendKey("l")   // Next layout
    Bun.sleepSync(200)

    // Apply the layout
    sendKey("Enter")
    Bun.sleepSync(300)

    // Verify we now have 2 panes
    const afterFirstApply = getPaneIds()
    expect(afterFirstApply.length).toBe(2)

    // The original pane ID should still exist
    expect(afterFirstApply).toContain(originalPaneId)

    // Now apply a different 2-pane layout - pane IDs should be preserved
    startCmux()
    sendKey("Tab")
    sendKey("l")   // Cycle to another layout
    sendKey("l")
    sendKey("Enter")
    Bun.sleepSync(300)

    const afterSecondApply = getPaneIds()
    expect(afterSecondApply.length).toBe(2)

    // Both pane IDs should still exist (same panes, just repositioned)
    for (const id of afterFirstApply) {
      expect(afterSecondApply).toContain(id)
    }
  })

  test("position-based matching preserves pane in closest slot", () => {
    // Reset to single pane
    tmux("kill-pane -a -t test:0")
    Bun.sleepSync(100)

    // Create a 2-pane horizontal split manually
    tmux("split-window -h -t test:0")
    Bun.sleepSync(100)

    const beforeInfo = getPaneInfo()
    expect(beforeInfo.length).toBe(2)

    // Find the left pane (smaller x) and right pane (larger x)
    const sortedBefore = [...beforeInfo].sort((a, b) => a.x - b.x)
    const leftPaneId = sortedBefore[0].id
    const rightPaneId = sortedBefore[1].id

    // Apply a layout that should preserve positions
    startCmux()
    sendKey("Tab")
    // Find a 2-pane layout (cycle until we see "2 panes")
    for (let i = 0; i < 10; i++) {
      const output = tmux("capture-pane -t test:0 -p")
      if (output.includes("2 panes")) break
      sendKey("l")
      Bun.sleepSync(100)
    }
    sendKey("Enter")
    Bun.sleepSync(300)

    const afterInfo = getPaneInfo()
    expect(afterInfo.length).toBe(2)

    // Both original panes should still exist
    const afterIds = afterInfo.map(p => p.id)
    expect(afterIds).toContain(leftPaneId)
    expect(afterIds).toContain(rightPaneId)
  })

  test("adding panes creates new ones without churning existing", () => {
    // Reset to single pane
    tmux("kill-pane -a -t test:0")
    Bun.sleepSync(100)

    const initialPanes = getPaneIds()
    expect(initialPanes.length).toBe(1)
    const originalPaneId = initialPanes[0]

    // Apply a 3-pane layout
    startCmux()
    sendKey("Tab")
    // Cycle until we find a 3-pane layout
    for (let i = 0; i < 20; i++) {
      const output = tmux("capture-pane -t test:0 -p")
      if (output.includes("3 panes")) break
      sendKey("l")
      Bun.sleepSync(100)
    }
    sendKey("Enter")
    Bun.sleepSync(300)

    const afterPanes = getPaneIds()
    expect(afterPanes.length).toBe(3)

    // The original pane should still exist
    expect(afterPanes).toContain(originalPaneId)
  })

  test("reducing panes kills extras without churning retained ones", () => {
    // Reset and create 3 panes
    tmux("kill-pane -a -t test:0")
    tmux("split-window -h -t test:0")
    tmux("split-window -v -t test:0")
    Bun.sleepSync(100)

    const initialPanes = getPaneIds()
    expect(initialPanes.length).toBe(3)

    // Apply a 2-pane layout
    startCmux()
    sendKey("Tab")
    // Cycle until we find a 2-pane layout
    for (let i = 0; i < 20; i++) {
      const output = tmux("capture-pane -t test:0 -p")
      if (output.includes("2 panes")) break
      sendKey("l")
      Bun.sleepSync(100)
    }
    sendKey("Enter")
    Bun.sleepSync(300)

    const afterPanes = getPaneIds()
    expect(afterPanes.length).toBe(2)

    // At least 2 of the original 3 panes should be preserved
    const preservedCount = initialPanes.filter(id => afterPanes.includes(id)).length
    expect(preservedCount).toBe(2)
  })
})
