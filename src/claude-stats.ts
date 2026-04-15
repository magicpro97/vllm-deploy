/**
 * Parse Claude Code session JSONL files for usage stats.
 * Reads from ~/.claude/projects/ to get token usage, tool calls, etc.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "fs";

function joinPath(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/");
}

export interface ClaudeStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  requestCount: number;
  toolUseCalls: number;
  webSearchCalls: number;
  webFetchCalls: number;
  avgOutputTokens: number;
  sessions: number;
  lastActivity?: string;
}

const CLAUDE_DIR = joinPath(
  process.env["USERPROFILE"] ?? process.env["HOME"] ?? "",
  ".claude"
);

/** Find all project session JSONL files */
function findSessionFiles(): string[] {
  const projectsDir = joinPath(CLAUDE_DIR, "projects");
  if (!existsSync(projectsDir)) return [];

  const files: string[] = [];
  try {
    for (const project of readdirSync(projectsDir)) {
      const projPath = joinPath(projectsDir, project);
      try {
        for (const file of readdirSync(projPath)) {
          if (file.endsWith(".jsonl")) {
            files.push(joinPath(projPath, file));
          }
        }
      } catch {}
    }
  } catch {}
  return files;
}

/** Parse a single JSONL file for stats */
function parseSessionFile(filePath: string): Partial<ClaudeStats> {
  const stats: Partial<ClaudeStats> = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    requestCount: 0,
    toolUseCalls: 0,
    webSearchCalls: 0,
    webFetchCalls: 0,
  };

  try {
    const content = readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);

        if (obj.type === "assistant" && obj.message?.usage) {
          const u = obj.message.usage;
          stats.totalInputTokens! += u.input_tokens || 0;
          stats.totalOutputTokens! += u.output_tokens || 0;
          stats.requestCount! += 1;

          if (u.server_tool_use) {
            stats.webSearchCalls! += u.server_tool_use.web_search_requests || 0;
            stats.webFetchCalls! += u.server_tool_use.web_fetch_requests || 0;
          }

          // Count tool_use blocks in content
          if (Array.isArray(obj.message.content)) {
            for (const block of obj.message.content) {
              if (block.type === "tool_use") stats.toolUseCalls! += 1;
            }
          }

          if (obj.timestamp) stats.lastActivity = obj.timestamp;
        }
      } catch {}
    }
  } catch {}

  return stats;
}

/** Get aggregated stats from all Claude sessions */
export function getAllClaudeStats(): ClaudeStats {
  const files = findSessionFiles();
  const total: ClaudeStats = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    requestCount: 0,
    toolUseCalls: 0,
    webSearchCalls: 0,
    webFetchCalls: 0,
    avgOutputTokens: 0,
    sessions: files.length,
  };

  for (const file of files) {
    const s = parseSessionFile(file);
    total.totalInputTokens += s.totalInputTokens || 0;
    total.totalOutputTokens += s.totalOutputTokens || 0;
    total.requestCount += s.requestCount || 0;
    total.toolUseCalls += s.toolUseCalls || 0;
    total.webSearchCalls += s.webSearchCalls || 0;
    total.webFetchCalls += s.webFetchCalls || 0;
    if (s.lastActivity) total.lastActivity = s.lastActivity;
  }

  total.totalTokens = total.totalInputTokens + total.totalOutputTokens;
  total.avgOutputTokens =
    total.requestCount > 0
      ? Math.round(total.totalOutputTokens / total.requestCount)
      : 0;

  return total;
}

/** Get stats from the most recent active session only */
export function getRecentSessionStats(maxAgeMinutes = 60): ClaudeStats | null {
  const files = findSessionFiles();
  if (files.length === 0) return null;

  // Sort by modification time, newest first
  const sorted = files
    .map((f) => {
      try {
        const stat = statSync(f);
        return { path: f, mtime: stat.mtimeMs };
      } catch {
        return { path: f, mtime: 0 };
      }
    })
    .sort((a, b) => b.mtime - a.mtime);

  const newest = sorted[0];
  if (!newest) return null;
  const ageMinutes = (Date.now() - newest.mtime) / 60000;
  if (ageMinutes > maxAgeMinutes) return null;

  const s = parseSessionFile(newest.path);
  return {
    totalInputTokens: s.totalInputTokens || 0,
    totalOutputTokens: s.totalOutputTokens || 0,
    totalTokens: (s.totalInputTokens || 0) + (s.totalOutputTokens || 0),
    requestCount: s.requestCount || 0,
    toolUseCalls: s.toolUseCalls || 0,
    webSearchCalls: s.webSearchCalls || 0,
    webFetchCalls: s.webFetchCalls || 0,
    avgOutputTokens:
      s.requestCount! > 0
        ? Math.round(s.totalOutputTokens! / s.requestCount!)
        : 0,
    sessions: 1,
    lastActivity: s.lastActivity,
  };
}
