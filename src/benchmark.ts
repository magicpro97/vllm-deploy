/**
 * Benchmark module — measure vLLM throughput & concurrency.
 * Used by both CLI `benchmark` command and post-deploy health check.
 * Results are saved to benchmark_report.json for dashboard display.
 */

const BENCHMARK_PATH = `${import.meta.dir}/../benchmark_report.json`;

export interface BenchResult {
  latencyMs: number;
  tokens: number;
  tokPerSec: number;
  success: boolean;
  error?: string;
}

export interface ConcurrencyRow {
  concurrent: number;
  successRate: string;
  p50Ms: number;
  p95Ms: number;
  throughput: number;
  avgTokPerSec: number;
}

export interface BenchmarkReport {
  timestamp: string;
  model: string;
  baseline: {
    latencyMs: number;
    tokens: number;
    tokPerSec: number;
  };
  concurrency: ConcurrencyRow[];
  maxConcurrentSessions: number;
  healthy: boolean;
}

export async function singleRequest(
  apiUrl: string, model: string, headers: Record<string, string>,
  prompt: string, maxTokens: number,
): Promise<BenchResult> {
  const start = Date.now();
  try {
    const res = await fetch(`${apiUrl}/chat/completions`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const data = (await res.json()) as {
      usage?: { completion_tokens?: number };
      error?: { message?: string };
    };
    const elapsed = Date.now() - start;
    if (data.error) {
      return { latencyMs: elapsed, tokens: 0, tokPerSec: 0, success: false, error: data.error.message };
    }
    const tokens = data.usage?.completion_tokens ?? 0;
    return { latencyMs: elapsed, tokens, tokPerSec: tokens / (elapsed / 1000), success: true };
  } catch (e: unknown) {
    return {
      latencyMs: Date.now() - start, tokens: 0, tokPerSec: 0,
      success: false, error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

/**
 * Run full benchmark suite. Returns report and optionally logs progress.
 * @param quiet - if true, suppress console output (for post-deploy auto-run)
 */
export async function runBenchmark(
  apiUrl: string, model: string, token?: string,
  opts?: { quiet?: boolean; concurrencyLevels?: number[] },
): Promise<BenchmarkReport | null> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const quiet = opts?.quiet ?? false;
  const levels = opts?.concurrencyLevels ?? [1, 2, 4, 8];

  // Phase 1: Baseline
  const baseline = await singleRequest(apiUrl, model, headers, "Count from 1 to 20.", 100);
  if (!baseline.success) return null;

  if (!quiet) {
    console.log(`  ✅ Baseline: ${baseline.latencyMs}ms | ${baseline.tokPerSec.toFixed(1)} tok/s`);
  }

  // Phase 2: Concurrent
  const rows: ConcurrencyRow[] = [];
  const prompt = "Write a short poem about programming in exactly 4 lines.";

  for (const c of levels) {
    const promises: Promise<BenchResult>[] = [];
    for (let i = 0; i < c; i++) {
      promises.push(singleRequest(apiUrl, model, headers, prompt, 100));
    }
    const results = await Promise.all(promises);
    const successes = results.filter(r => r.success);
    const failures = results.filter(r => !r.success);

    if (successes.length === 0) break;

    const latencies = successes.map(r => r.latencyMs);
    const totalTokens = successes.reduce((sum, r) => sum + r.tokens, 0);
    const elapsed = Math.max(...latencies);
    const throughput = totalTokens / (elapsed / 1000);
    const avgTokPerSec = successes.reduce((s, r) => s + r.tokPerSec, 0) / successes.length;

    rows.push({
      concurrent: c,
      successRate: `${successes.length}/${c}`,
      p50Ms: Math.round(percentile(latencies, 50)),
      p95Ms: Math.round(percentile(latencies, 95)),
      throughput: Math.round(throughput * 10) / 10,
      avgTokPerSec: Math.round(avgTokPerSec * 10) / 10,
    });

    if (!quiet) {
      console.log(`  c=${c}: p50=${Math.round(percentile(latencies, 50))}ms, ${throughput.toFixed(1)} tok/s`);
    }

    if (failures.length > c / 2) break;
  }

  const maxConcurrent = Math.max(1, Math.floor(baseline.tokPerSec / 5));

  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    model,
    baseline: {
      latencyMs: baseline.latencyMs,
      tokens: baseline.tokens,
      tokPerSec: Math.round(baseline.tokPerSec * 10) / 10,
    },
    concurrency: rows,
    maxConcurrentSessions: maxConcurrent,
    healthy: true,
  };

  return report;
}

/** Quick health check — single request only, returns healthy status */
export async function healthCheck(apiUrl: string, model: string, token?: string): Promise<boolean> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const result = await singleRequest(apiUrl, model, headers, "Say OK.", 5);
  return result.success;
}

export function saveBenchmarkReport(report: BenchmarkReport): void {
  void Bun.write(BENCHMARK_PATH, JSON.stringify(report, null, 2));
}

export function loadBenchmarkReport(): BenchmarkReport | null {
  try {
    const data = require("fs").readFileSync(BENCHMARK_PATH, "utf-8") as string;
    return JSON.parse(data) as BenchmarkReport;
  } catch {
    return null;
  }
}
