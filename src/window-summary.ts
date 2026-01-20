import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { Cache } from "./cache";

// Read API key from config file (never passed through tmux)
function getApiKey(): string | null {
  const configPath = join(homedir(), ".config", "cmux", "api-key");
  if (existsSync(configPath)) {
    return readFileSync(configPath, "utf-8").trim();
  }
  // Fall back to env for development convenience
  return process.env.ANTHROPIC_API_KEY || null;
}

const apiKey = getApiKey();
const client = apiKey ? new Anthropic({ apiKey }) : null;
const summaryCache = new Cache<string>("window-summaries", 60 * 1000); // 1 minute TTL

interface PaneInfo {
  index: number;
  command: string;
  cwd: string;
  content: string;
  active: boolean;
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

  // Get pane info including active status
  const paneData = run(
    `tmux list-panes -t ${windowTarget} -F '#{pane_index}\t#{pane_current_command}\t#{pane_current_path}\t#{pane_active}'`
  );

  const panes: PaneInfo[] = paneData
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [index, command, cwd, active] = line.split("\t");
      const content = run(`tmux capture-pane -t ${windowTarget}.${index} -p | tail -30`);
      return { index: parseInt(index), command, cwd, content, active: active === "1" };
    })
    // Sort active pane first
    .sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));

  // Get git info from first pane's cwd
  const primaryCwd = panes[0]?.cwd || "";
  const gitBranch = run(`git -C "${primaryCwd}" branch --show-current`);
  const gitStatus = run(`git -C "${primaryCwd}" status --short`);
  const gitDiff = run(
    `git -C "${primaryCwd}" diff --stat HEAD 2>/dev/null | tail -20`
  );

  return { windowName, panes, gitBranch, gitStatus, gitDiff };
}

const SYSTEM_PROMPT = `You summarize tmux windows in exactly 2 short sentences.

Sentence 1: What the project is (3-4 words max).
Sentence 2: Current work - what the user is doing right now.

Example outputs:
- "Tmux session manager. Working on AI summaries."
- "React e-commerce app. Adding search filters."
- "Python ML pipeline. Tuning hyperparameters."
- "Go auth microservice. Fixing JWT validation."
- "Fitness tracking app. Adding coach feature."

Rules:
- Be extremely concise. No fluff.
- First sentence: just the project type, no details.
- Second sentence: specific current task. Focus primarily on the active pane (marked "active", shown first) - it has the most recent activity. Other panes may contain stale output from earlier work. If panes are empty, infer from git changes.
- Reply with only the 2 sentences, nothing else.`;

function buildUserPrompt(ctx: WindowContext): string {
  const panes = ctx.panes
    .map(
      (p) => `<pane index="${p.index}" command="${p.command}" cwd="${p.cwd}"${p.active ? " active" : ""}>
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
