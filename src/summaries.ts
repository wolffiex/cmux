import Anthropic from "@anthropic-ai/sdk";
import type { PaneContext, WindowContext } from "./tmux";
import { log } from "./logger";

// Lazy Anthropic client initialization
let _client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (_client === null) {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (apiKey) {
      _client = new Anthropic({ apiKey });
    }
  }
  return _client;
}

const SYSTEM_PROMPT =
  "Generate a 5-10 word summary of this tmux window. Focus on what's being worked on. Examples: 'React dev server', 'Git commits review', 'Python tests running'";

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
  log('[cmux] Anthropic client:', client ? 'initialized (using ANTHROPIC_API_KEY)' : 'null (ANTHROPIC_API_KEY not set)');
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
