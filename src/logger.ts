import { appendFileSync, writeFileSync } from "node:fs"

const LOG_FILE = "/tmp/cmux.log"

// Clear log on startup
export function initLog() {
  writeFileSync(LOG_FILE, `=== cmux started ${new Date().toISOString()} ===\n`)
}

export function log(...args: unknown[]) {
  const msg = args.map(a =>
    typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
  ).join(' ')
  try {
    appendFileSync(LOG_FILE, `${msg}\n`)
  } catch (e) {
    // Silently ignore write errors
  }
}
