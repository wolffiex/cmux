import Anthropic from "@anthropic-ai/sdk";
import type { PaneContext, WindowContext } from "./tmux";

// Lazy Anthropic client initialization
let _client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (_client === null && process.env.ANTHROPIC_API_KEY) {
    _client = new Anthropic();
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
  const client = getClient();
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
    return textBlock ? textBlock.text.trim() : context.windowName;
  } catch {
    // API error, return window name as fallback
    return context.windowName;
  }
}

/**
 * Get a summary for a window, using cache when available
 */
export async function getSummary(context: WindowContext): Promise<string> {
  const currentHash = hashContext(context);
  const cached = cache.get(context.windowId);

  if (cached && cached.contextHash === currentHash) {
    return cached.summary;
  }

  const summary = await generateSummary(context);
  cache.set(context.windowId, {
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
      return { windowId: context.windowId, summary };
    })
  );

  for (const { windowId, summary } of summaries) {
    results.set(windowId, summary);
  }

  return results;
}

// Re-export types for use by other modules
export type { PaneContext, WindowContext };
