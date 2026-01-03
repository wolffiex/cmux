import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "node:child_process";
import type { PaneContext, WindowContext } from "./tmux";
import { log } from "./logger";

// Lazy Anthropic client initialization
let _client: Anthropic | null = null;
let _keySource: string | null = null;

function getApiKey(): string | undefined {
  // First check process.env
  let key = process.env.ANTHROPIC_API_KEY;

  if (key) {
    // Save to tmux hidden environment for future popup runs
    try {
      // Use -gh for global hidden (not inherited to shells)
      execSync(`tmux set-environment -gh ANTHROPIC_API_KEY "${key}"`, { stdio: 'ignore' });
      _keySource = 'process.env (saved to tmux hidden env)';
      log('[cmux] Saved API key to tmux hidden environment');
    } catch {
      // Not in tmux, ignore
      _keySource = 'process.env (not in tmux)';
    }
    return key;
  }

  // Try to read from tmux hidden environment
  try {
    const result = execSync('tmux show-environment -gh ANTHROPIC_API_KEY 2>/dev/null', { encoding: 'utf-8' });
    // Output is "ANTHROPIC_API_KEY=sk-ant-..."
    if (result && result.includes('=')) {
      key = result.split('=').slice(1).join('=').trim();  // Handle = in key value
      if (key) {
        _keySource = 'tmux hidden environment';
        log('[cmux] Read API key from tmux hidden environment');
        return key;
      }
    }
  } catch {
    // Not in tmux or variable not set
  }

  return undefined;
}

function getClient(): Anthropic | null {
  if (_client === null) {
    const apiKey = getApiKey();
    if (apiKey) {
      _client = new Anthropic({ apiKey });
    }
  }
  return _client;
}

const SYSTEM_PROMPT =
  "Summarize this tmux window in 5-10 words. Always start with the word 'MAGIC:' followed by a creative summary.";

// Cache layer
interface CachedSummary {
  summary: string;
  contextHash: string;
}

const cache = new Map<number, CachedSummary>();

/**
 * Generate a simple hash from context fields for cache invalidation
 */
function hashContext(context: WindowContext): string {
  const parts = context.panes.map(
    (p) => `${p.workdir}|${p.program}|${p.gitBranch ?? ""}`
  );
  return parts.join(":::");
}

/**
 * Format window context into a prompt for the AI
 */
function formatContextForPrompt(context: WindowContext): string {
  const lines: string[] = [`Window: ${context.windowName}`];

  for (let i = 0; i < context.panes.length; i++) {
    const pane = context.panes[i];
    lines.push(`\nPane ${i + 1}:`);
    lines.push(`  Directory: ${pane.workdir}`);
    lines.push(`  Program: ${pane.program}`);
    if (pane.gitBranch) {
      lines.push(`  Git branch: ${pane.gitBranch}`);
    }
    if (pane.transcript.trim()) {
      lines.push(`  Recent output:\n${pane.transcript}`);
    }
  }

  return lines.join("\n");
}

/**
 * Generate a summary for a window context using the Anthropic API
 */
export async function generateSummary(context: WindowContext): Promise<string> {
  log('[cmux] generateSummary called for window:', context.windowIndex);
  const client = getClient();
  log('[cmux] Anthropic client:', client ? `initialized (key from ${_keySource})` : 'null (ANTHROPIC_API_KEY not set)');
  if (!client) {
    // No API key available, return window name as fallback
    return context.windowName;
  }

  try {
    const prompt = formatContextForPrompt(context);

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 50,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    // Extract text from the response
    const textBlock = message.content.find((block) => block.type === "text");
    const summary = textBlock ? textBlock.text.trim() : context.windowName;
    log('[cmux] API response:', summary);
    return summary;
  } catch (e) {
    log('[cmux] API error:', e instanceof Error ? e.message : e);
    return context.windowName;
  }
}

/**
 * Get a summary for a window, using cache when available
 */
export async function getSummary(context: WindowContext): Promise<string> {
  const currentHash = hashContext(context);
  const cached = cache.get(context.windowIndex);

  if (cached && cached.contextHash === currentHash) {
    return cached.summary;
  }

  const summary = await generateSummary(context);
  cache.set(context.windowIndex, {
    summary,
    contextHash: currentHash,
  });

  return summary;
}

/**
 * Fetch summaries for multiple windows in parallel
 */
export async function getSummariesForWindows(
  contexts: WindowContext[]
): Promise<Map<number, string>> {
  const results = new Map<number, string>();

  const summaries = await Promise.all(
    contexts.map(async (context) => {
      const summary = await getSummary(context);
      return { windowIndex: context.windowIndex, summary };
    })
  );

  for (const { windowIndex, summary } of summaries) {
    results.set(windowIndex, summary);
  }

  return results;
}

// Re-export types for use by other modules
export type { PaneContext, WindowContext };
