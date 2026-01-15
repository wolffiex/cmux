import { appendFileSync, writeFileSync } from "node:fs"

const LOG_FILE = "/tmp/cmux.log"
const DEBUG_ENABLED = !!process.env.CMUX_DEBUG

let initialized = false

// No-op for backward compatibility
export function initLog() {
  // Lazy initialization - do nothing here
}

export function log(...args: unknown[]) {
  // Skip all logging when debug is disabled (no disk I/O)
  if (!DEBUG_ENABLED) return

  // Lazy init: create log file on first actual log call
  if (!initialized) {
    initialized = true
    try {
      writeFileSync(LOG_FILE, `=== cmux started ${new Date().toISOString()} ===\n`)
    } catch {
      // Silently ignore write errors
    }
  }

  const msg = args.map(a =>
    typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
  ).join(' ')
  try {
    appendFileSync(LOG_FILE, `${msg}\n`)
  } catch {
    // Silently ignore write errors
  }
}
