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

function gatherWindowContext(windowId: string): WindowContext {
  const windowName = run(
    `tmux display-message -t ${windowId} -p '#{window_name}'`
  );

  // Get pane info
  const paneData = run(
    `tmux list-panes -t ${windowId} -F '#{pane_index}\t#{pane_current_command}\t#{pane_current_path}'`
  );

  const panes: PaneInfo[] = paneData
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [index, command, cwd] = line.split("\t");
      const content = run(
        `tmux capture-pane -t ${windowId}.${index} -p | tail -30`
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

Sentence 1: System state - what's actively running.
Sentence 2: Git status - branch and uncommitted changes.
Sentence 3: What the user is working on - infer from git changes and pane activity.

Example outputs:
- "Server + simulator running. 5 uncommitted changes on feature-branch. Adding SSE support for real-time metrics."
- "Tests failing (3 errors). Clean on main. Fixing date parsing in the API response handler."
- "Idle. 2 modified files on feature-branch. Refactoring authentication middleware."
- "Build running. Clean on main. Setting up CI pipeline for the new monorepo."

Rules:
- Be concise. Use active voice. No fluff.
- Skip port numbers unless relevant.
- "Idle" means no server/build/test actively running.
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
