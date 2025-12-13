#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { join } from "node:path";

const CONFIG_PATH = join(import.meta.dir, "../../config/tmux.conf");
const CMUXX_PATH = join(import.meta.dir, "cmuxx.ts");

function isInsideTmux(): boolean {
  return !!process.env.TMUX;
}

function startTmuxSession(): void {
  const tmux = spawn("tmux", [
    "-f", CONFIG_PATH,
    "new-session",
    ";",
    "bind", "-n", "M-Space", "run-shell", CMUXX_PATH
  ], {
    stdio: "inherit",
  });

  tmux.on("close", (code) => {
    process.exit(code ?? 0);
  });
}

function main(): void {
  const args = process.argv.slice(2);

  // No arguments and not inside tmux: start a session
  if (args.length === 0 && !isInsideTmux()) {
    startTmuxSession();
    return;
  }

  // TODO: Handle other cases
  // - Inside tmux: open typeahead
  // - With arguments: handle subcommands (new, resume, stop, etc.)
}

main();
