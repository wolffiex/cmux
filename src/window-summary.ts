import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "child_process";
import { Cache } from "./cache";

// API key is passed via environment (inline in popup command, not stored)
const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;
const summaryCache = new Cache<string>("window-summaries");

interface PaneInfo {
  index: number;
  command: string;
  cwd: string;
  content: string;
}

interface WindowContext {
  windowName: string;
  panes: PaneInfo[];
  gitBranch: string | null;
  gitStatus: string | null;
  gitDiff: string | null;
}

function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 5000 }).trim();
  } catch {
    return "";
  }
}

function gatherWindowContext(windowTarget: string): WindowContext {
  const windowName = run(
    `tmux display-message -t ${windowTarget} -p '#{window_name}'`
  );

  // Get pane info
  const paneData = run(
    `tmux list-panes -t ${windowTarget} -F '#{pane_index}\t#{pane_current_command}\t#{pane_current_path}'`
  );

  const panes: PaneInfo[] = paneData
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [index, command, cwd] = line.split("\t");
      const content = run(
        `tmux capture-pane -t ${windowTarget}.${index} -p | tail -30`
      );
      return { index: parseInt(index), command, cwd, content };
    });

  // Get git info from first pane's cwd
  const primaryCwd = panes[0]?.cwd || "";
  const gitBranch = run(`git -C "${primaryCwd}" branch --show-current`);
  const gitStatus = run(`git -C "${primaryCwd}" status --short`);
  const gitDiff = run(
    `git -C "${primaryCwd}" diff --stat HEAD 2>/dev/null | tail -20`
  );

  return { windowName, panes, gitBranch, gitStatus, gitDiff };
}

const SYSTEM_PROMPT = `You summarize tmux windows in exactly 3 sentences.

Sentence 1: What the project is - infer from repo name, directory, and code context.
Sentence 2: System state - what's actively running (server, tests, build) or "idle" if nothing.
Sentence 3: Current work - infer from git changes and recent activity.

Example outputs:
- "React e-commerce app with Stripe integration. Dev server running. Adding product search filters."
- "CLI tool for managing tmux sessions. Idle. Fixing window summary API targets."
- "Python ML pipeline for sentiment analysis. Training job running (epoch 5/10). Tuning hyperparameters."
- "Go microservice for user auth. Tests failing (3 errors). Refactoring JWT validation."

Rules:
- Be concise. Use active voice. No fluff.
- Skip port numbers unless relevant.
- Reply with only the 3 sentences, nothing else.`;

function buildUserPrompt(ctx: WindowContext): string {
  const panes = ctx.panes
    .map(
      (p) => `<pane index="${p.index}" command="${p.command}" cwd="${p.cwd}">
${p.content || "(empty)"}
</pane>`
    )
    .join("\n");

  return `Summarize this tmux window in 2 sentences.

<window name="${ctx.windowName}">
<git branch="${ctx.gitBranch || "unknown"}">
<status>
${ctx.gitStatus || "(clean)"}
</status>
<diff>
${ctx.gitDiff || "(no changes)"}
</diff>
</git>
<panes>
${panes}
</panes>
</window>`;
}

export async function getWindowSummary(windowId: string): Promise<string> {
  if (!client) {
    throw new Error("No API key available");
  }

  return summaryCache.get(windowId, async () => {
    const ctx = gatherWindowContext(windowId);

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 150,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(ctx) }],
    });

    const content = message.content[0];
    if (content.type === "text") {
      return content.text;
    }
    // Throw instead of returning error string - prevents caching errors
    throw new Error("API returned non-text response");
  });
}

// For testing: summarize current window or show prompt with --debug
if (import.meta.main) {
  const args = process.argv.slice(2);
  const debug = args.includes("--debug");
  const windowId =
    args.find((a) => !a.startsWith("-")) ||
    run("tmux display-message -p '#{window_id}'");

  console.log(`Window: ${windowId}\n`);

  if (debug) {
    const ctx = gatherWindowContext(windowId);
    console.log("=== SYSTEM PROMPT ===\n");
    console.log(SYSTEM_PROMPT);
    console.log("\n=== USER PROMPT ===\n");
    console.log(buildUserPrompt(ctx));
  } else {
    const summary = await getWindowSummary(windowId);
    console.log(summary);
  }
}
