#!/usr/bin/env bun

import { spawn } from "node:child_process";

function isInsideTmux(): boolean {
  return !!process.env.TMUX;
}

function startTmuxSession(): void {
  const tmux = spawn("tmux", ["new-session"], {
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
