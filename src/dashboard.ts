/**
 * TUI Dashboard for vLLM instance monitoring.
 * Uses blessed + blessed-contrib for real-time terminal dashboard.
 */
import blessed from "blessed";
import contrib from "blessed-contrib";
import { loadInstanceInfo, loadConfig, isWatchdogRunning, type InstanceInfo } from "./config";
import { getInstanceMetrics, destroyInstance, getLogs, isInstanceInterrupted } from "./vastai";
import { getRecentSessionStats, type ClaudeStats } from "./claude-stats";
import { loadBenchmarkReport } from "./benchmark";
import type { CliArgs } from "./args";

interface DashboardState {
  info: InstanceInfo;
  startTime: number;
  hoursLimit?: number;
  budgetLimit?: number;
  dphTotal: number;
  // Accumulated
  totalSpent: number;
  elapsedHours: number;
  // Instance health
  instanceStatus: string;
  isSpot: boolean;
  // vLLM API stats
  apiRequests: number;
  apiLatencyMs: number[];
  apiTokensGenerated: number;
  // Claude session stats
  claudeStats?: ClaudeStats;
}

export async function startDashboard(opts: {
  hours?: number;
  budget?: number;
  service?: boolean;
  args?: CliArgs;
}) {
  const info = loadInstanceInfo();
  if (!info) {
    console.error("❌ No instance info. Run: bun run deploy start");
    process.exit(1);
    return; // unreachable but satisfies TS
  }

  const cfg = loadConfig();
  const isSpot = opts.args?.spot || cfg.instanceType === "interruptible";

  const state: DashboardState = {
    info,
    startTime: Date.now(),
    hoursLimit: opts.hours ?? info.stopAfterHours,
    budgetLimit: opts.budget ?? info.stopAfterBudget,
    dphTotal: info.dphTotal ?? 0,
    totalSpent: 0,
    elapsedHours: 0,
    instanceStatus: "loading",
    isSpot,
    apiRequests: 0,
    apiLatencyMs: [],
    apiTokensGenerated: 0,
  };

  const screen = blessed.screen({
    smartCSR: true,
    title: `vLLM Dashboard — ${info.instanceId}`,
  });

  const grid = new contrib.grid({ rows: 13, cols: 12, screen });

  // === Row 0-2: Header + Time/Budget ===
  const headerBox = grid.set(0, 0, 2, 6, blessed.box, {
    label: " 🚀 vLLM Instance ",
    tags: true,
    border: { type: "line" },
    style: {
      border: { fg: "cyan" },
      label: { fg: "cyan", bold: true },
    },
    content: formatHeader(state),
  });

  const timeBudgetBox = grid.set(0, 6, 2, 6, blessed.box, {
    label: " ⏰ Time & Budget ",
    tags: true,
    border: { type: "line" },
    style: {
      border: { fg: "yellow" },
      label: { fg: "yellow", bold: true },
    },
    content: "",
  });

  // === Row 2-5: Token stats + Request stats ===
  const tokenBox = grid.set(2, 0, 3, 4, blessed.box, {
    label: " 🔤 Tokens ",
    tags: true,
    border: { type: "line" },
    style: { border: { fg: "green" }, label: { fg: "green", bold: true } },
    content: "",
  });

  const requestBox = grid.set(2, 4, 3, 4, blessed.box, {
    label: " 📡 Requests ",
    tags: true,
    border: { type: "line" },
    style: { border: { fg: "blue" }, label: { fg: "blue", bold: true } },
    content: "",
  });

  const toolBox = grid.set(2, 8, 3, 4, blessed.box, {
    label: " 📊 Benchmark ",
    tags: true,
    border: { type: "line" },
    style: { border: { fg: "magenta" }, label: { fg: "magenta", bold: true } },
    content: formatBenchmark(),
  });

  // === Row 5-8: System metrics ===
  const cpuGauge = grid.set(5, 0, 3, 3, contrib.gauge, {
    label: " CPU% ",
    stroke: "green",
    fill: "white",
    border: { type: "line" },
    style: { border: { fg: "green" } },
  });

  const ramGauge = grid.set(5, 3, 3, 3, contrib.gauge, {
    label: " RAM ",
    stroke: "blue",
    fill: "white",
    border: { type: "line" },
    style: { border: { fg: "blue" } },
  });

  const gpuGauge = grid.set(5, 6, 3, 3, contrib.gauge, {
    label: " GPU ",
    stroke: "yellow",
    fill: "white",
    border: { type: "line" },
    style: { border: { fg: "yellow" } },
  });

  const networkBox = grid.set(5, 9, 3, 3, blessed.box, {
    label: " 🌐 Network ",
    tags: true,
    border: { type: "line" },
    style: { border: { fg: "cyan" }, label: { fg: "cyan", bold: true } },
    content: "",
  });

  // === Row 8-9: Latency sparkline + Settings (compact) ===
  const latencyLine = grid.set(8, 0, 2, 6, contrib.sparkline, {
    label: " ⚡ Latency (ms) ",
    tags: true,
    border: { type: "line" },
    style: {
      fg: "blue",
      border: { fg: "blue" },
      label: { fg: "blue", bold: true },
    },
  });

  const settingsBox = grid.set(8, 6, 2, 6, blessed.box, {
    label: " ⚙ Settings ",
    tags: true,
    border: { type: "line" },
    style: { border: { fg: "white" }, label: { fg: "white", bold: true } },
    content: formatSettings(state, state.info, opts.args),
  });

  // === Row 10-11: Realtime Logs (virtual scroll) ===
  const LOG_BUFFER_MAX = 500;
  const LOG_VISIBLE_LINES = 20;
  const logBuffer: string[] = [];
  let logScrollOffset = 0; // 0 = bottom (newest), positive = scrolled up
  let logAutoScroll = true;

  const logsPanel = grid.set(10, 0, 2, 12, blessed.box, {
    label: " 📜 Logs ",
    tags: true,
    border: { type: "line" },
    style: {
      border: { fg: "green" },
      label: { fg: "green", bold: true },
      fg: "gray",
    },
    scrollable: false,
    mouse: true,
  });

  function renderLogs() {
    const rawHeight = logsPanel.height;
    const panelHeight = rawHeight
      ? Math.max(1, Number(rawHeight) - 2)
      : LOG_VISIBLE_LINES;
    const totalLines = logBuffer.length;
    const maxOffset = Math.max(0, totalLines - panelHeight);
    logScrollOffset = Math.min(logScrollOffset, maxOffset);
    const startIdx = Math.max(0, totalLines - panelHeight - logScrollOffset);
    const endIdx = startIdx + panelHeight;
    const visible = logBuffer.slice(startIdx, endIdx);
    const scrollIndicator = logScrollOffset > 0
      ? `{gray-fg} ↑ ${logScrollOffset} more lines{/gray-fg}`
      : "";
    logsPanel.setContent(visible.join("\n") + (scrollIndicator ? "\n" + scrollIndicator : ""));
  }

  function appendLog(line: string) {
    logBuffer.push(line.substring(0, 250));
    if (logBuffer.length > LOG_BUFFER_MAX) {
      logBuffer.splice(0, logBuffer.length - LOG_BUFFER_MAX);
    }
    if (logAutoScroll) {
      logScrollOffset = 0;
    }
    renderLogs();
  }

  // Mouse wheel scroll on logs panel
  logsPanel.on("wheelup", () => {
    logAutoScroll = false;
    logScrollOffset = Math.min(logScrollOffset + 3, Math.max(0, logBuffer.length - 5));
    renderLogs();
    screen.render();
  });

  logsPanel.on("wheeldown", () => {
    logScrollOffset = Math.max(0, logScrollOffset - 3);
    if (logScrollOffset === 0) logAutoScroll = true;
    renderLogs();
    screen.render();
  });

  // === Row 12: Hotkeys ===
  const logBox = grid.set(12, 0, 1, 12, blessed.box, {
    label: " [q] Quit  [s] Stop instance  [r] Refresh  [l] Logs ",
    tags: true,
    border: { type: "line" },
    style: {
      border: { fg: "gray" },
      label: { fg: "gray" },
      fg: "gray",
    },
    content: " Press q to quit, s to stop, r to refresh, l to fetch logs",
  });

  // Key bindings
  screen.key(["q", "C-c"], () => {
    screen.destroy();
    process.exit(0);
  });

  screen.key(["s"], () => {
    logBox.setContent(" 🛑 Stopping instance...");
    screen.render();
    void destroyInstance(Number(info.instanceId)).then(() => {
      logBox.setContent(" ✅ Instance destroyed. Exiting...");
      screen.render();
      setTimeout(() => {
        screen.destroy();
        process.exit(0);
      }, 1500);
    }).catch((e: unknown) => {
      logBox.setContent(` ❌ Failed: ${String(e)}`);
      screen.render();
    });
  });

  screen.key(["r"], () => {
    logBox.setContent(" 🔄 Refreshing...");
    screen.render();
    void updateAll();
  });

  screen.key(["l"], () => {
    logBox.setContent(" 📜 Fetching logs...");
    screen.render();
    void getLogs(info.instanceId, 30).then((logs: string) => {
      const lines = logs.split("\n").filter((l: string) => l.trim());
      for (const line of lines) {
        appendLog(line);
      }
      logBox.setContent(" Press q to quit, s to stop, l to refresh logs");
      screen.render();
    }).catch(() => {
      logBox.setContent(" ❌ Failed to fetch logs");
      screen.render();
    });
  });

  // Periodic updates
  const POLL_INTERVAL = 5_000;
  const latencyHistory: number[] = [];
  const lastLogLines = new Set<string>();

  async function updateAll() {
    // Fetch instance metrics (includes actual uptime + status)
    let metrics;
    try {
      metrics = await getInstanceMetrics(state.info.instanceId);
      state.instanceStatus = metrics.status;

      // Use actual uptime from Vast.ai instead of local time
      if (metrics.uptime > 0) {
        state.elapsedHours = metrics.uptime / 3600;
        state.totalSpent = state.elapsedHours * state.dphTotal;
      } else {
        // Fallback to local time if API returns 0
        state.elapsedHours = (Date.now() - state.startTime) / 3600000;
        state.totalSpent = state.elapsedHours * state.dphTotal;
      }

      cpuGauge.setPercent(Math.min(100, Math.round(metrics.cpuUtil)));
      const ramPct = metrics.ramTotal > 0 ? Math.round((metrics.ramUsed / metrics.ramTotal) * 100) : 0;
      ramGauge.setPercent(Math.min(100, ramPct));
      gpuGauge.setPercent(Math.min(100, Math.round(metrics.gpuUtil)));

      networkBox.setContent(formatNetworkStatus(metrics));
    } catch {
      // Fallback to local time
      state.elapsedHours = (Date.now() - state.startTime) / 3600000;
      state.totalSpent = state.elapsedHours * state.dphTotal;
    }

    timeBudgetBox.setContent(formatTimeBudget(state));

    // Check if spot instance was interrupted
    if (isInstanceInterrupted(state.instanceStatus)) {
      appendLog(`{red-fg}⚠️  Instance ${state.instanceStatus}! Spot interrupted.{/red-fg}`);
      headerBox.setContent(formatHeader(state, `{red-fg}INTERRUPTED (${state.instanceStatus}){/red-fg}`));
    }

    // Check auto-shutdown conditions
    if (state.hoursLimit && state.elapsedHours >= state.hoursLimit) {
      logBox.setContent(` ⏰ ${state.hoursLimit}h reached — auto-stopping...`);
      screen.render();
      await autoStop(state, screen);
      return;
    }
    if (state.budgetLimit && state.totalSpent >= state.budgetLimit) {
      logBox.setContent(` 💵 $${state.budgetLimit} budget reached — auto-stopping...`);
      screen.render();
      await autoStop(state, screen);
      return;
    }

    // Probe vLLM API for health + latency
    try {
      const start = performance.now();
      const resp = await fetch(`${state.info.apiUrl}/models`, {
        signal: AbortSignal.timeout(5000),
      });
      const latency = Math.round(performance.now() - start);
      state.apiLatencyMs.push(latency);
      if (state.apiLatencyMs.length > 120) state.apiLatencyMs.shift();

      latencyHistory.push(latency);
      if (latencyHistory.length > 60) latencyHistory.shift();
      latencyLine.setData(["Latency"], [latencyHistory]);

      if (resp.ok) {
        const data = await resp.json();
        const modelId = data?.data?.[0]?.id ?? "loading...";
        headerBox.setContent(formatHeader(state, modelId));
      }
    } catch {
      latencyHistory.push(0);
      if (latencyHistory.length > 60) latencyHistory.shift();
      latencyLine.setData(["Latency"], [latencyHistory]);
    }

    // Claude stats (less frequent — every 30s)
    if (Math.round(state.elapsedHours * 3600 / 5) % 6 === 0) {
      try {
        const claudeStats = getRecentSessionStats(120);
        if (claudeStats) {
          state.claudeStats = claudeStats;
        }
      } catch {}
    }

    // Fetch realtime logs (every 15s to avoid spamming)
    if (Math.round(state.elapsedHours * 3600 / 5) % 3 === 0) {
      try {
        const logs = await getLogs(state.info.instanceId, 20);
        const newLines = logs.split("\n").filter((l: string) => l.trim());
        for (const line of newLines) {
          const trimmed = line.substring(0, 250);
          if (!lastLogLines.has(trimmed)) {
            lastLogLines.add(trimmed);
            if (lastLogLines.size > 200) {
              const first = lastLogLines.values().next().value;
              if (first) lastLogLines.delete(first);
            }
            appendLog(trimmed);
          }
        }
      } catch {}
    }

    tokenBox.setContent(formatTokens(state));
    requestBox.setContent(formatRequests(state));
    toolBox.setContent(formatBenchmark());
    settingsBox.setContent(formatSettings(state, state.info, opts.args));

    screen.render();
  }

  // Initial render
  await updateAll();
  screen.render();

  // Start polling
  setInterval(() => { void updateAll(); }, POLL_INTERVAL);
}

// === Formatters ===

function formatHeader(state: DashboardState, modelId?: string): string {
  const i = state.info;
  return [
    ` Model: {bold}${modelId ?? i.model}{/bold}`,
    ` Instance: ${i.instanceId}`,
    ` API: ${i.apiUrl}`,
    ` GPU: ${state.dphTotal > 0 ? `$${state.dphTotal.toFixed(3)}/hr` : "?"}`,
  ].join("\n");
}

function formatTimeBudget(s: DashboardState): string {
  const elapsed = formatDuration(s.elapsedHours * 3600);
  const lines: string[] = [
    ` Elapsed: {bold}${elapsed}{/bold}`,
    ` Spent:   {bold}{yellow-fg}$${s.totalSpent.toFixed(4)}{/yellow-fg}{/bold}`,
  ];

  if (s.hoursLimit) {
    const remaining = Math.max(0, s.hoursLimit - s.elapsedHours);
    const pct = Math.round((s.elapsedHours / s.hoursLimit) * 100);
    lines.push(` Time:    ${bar(pct)} ${remaining.toFixed(1)}h left`);
  }

  if (s.budgetLimit) {
    const remaining = Math.max(0, s.budgetLimit - s.totalSpent);
    const pct = Math.round((s.totalSpent / s.budgetLimit) * 100);
    lines.push(` Budget:  ${bar(pct)} $${remaining.toFixed(3)} left`);
  }

  return lines.join("\n");
}

function formatTokens(s: DashboardState): string {
  const cs = s.claudeStats;
  if (!cs) return " Waiting for Claude stats...";

  const fmt = (n: number) => n > 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
  return [
    ` Input:  {bold}${fmt(cs.totalInputTokens)}{/bold}`,
    ` Output: {bold}${fmt(cs.totalOutputTokens)}{/bold}`,
    ` Total:  {bold}{green-fg}${fmt(cs.totalTokens)}{/green-fg}{/bold}`,
    ` Avg/req: ${fmt(cs.avgOutputTokens)}`,
  ].join("\n");
}

function formatRequests(s: DashboardState): string {
  const cs = s.claudeStats;
  if (!cs) return " Waiting...";

  const avgLatency = s.apiLatencyMs.length > 0
    ? Math.round(s.apiLatencyMs.reduce((a, b) => a + b, 0) / s.apiLatencyMs.length)
    : 0;
  const p95 = s.apiLatencyMs.length > 0
    ? Math.round(sorted(s.apiLatencyMs)[Math.floor(s.apiLatencyMs.length * 0.95)] ?? 0)
    : 0;

  return [
    ` Requests: {bold}${cs.requestCount}{/bold}`,
    ` Sessions: ${cs.sessions}`,
    ` Latency avg: ${avgLatency}ms`,
    ` Latency p95: ${p95}ms`,
  ].join("\n");
}

function formatBenchmark(): string {
  const report = loadBenchmarkReport();
  if (!report) return " No benchmark yet\n Run: bun run deploy benchmark";

  const lines: string[] = [];
  const age = Date.now() - new Date(report.timestamp).getTime();
  const agoMin = Math.round(age / 60_000);
  const agoStr = agoMin < 60 ? `${agoMin}m ago` : `${Math.round(agoMin / 60)}h ago`;

  lines.push(` {bold}${report.baseline.tokPerSec} tok/s{/bold} baseline`);
  lines.push(` Latency:  ${report.baseline.latencyMs}ms`);
  lines.push(` Sessions: {bold}~${report.maxConcurrentSessions}{/bold} max concurrent`);

  // Show best concurrency result
  const last = report.concurrency[report.concurrency.length - 1];
  if (last) {
    lines.push(` Peak:     ${last.throughput} tok/s @c=${last.concurrent}`);
  }

  lines.push(` {gray-fg}${agoStr}{/gray-fg}`);

  return lines.join("\n");
}

function formatNetworkStatus(m: { inetUp: number; inetDown: number; status: string; gpuTempC: number; gpuMemUsed: number; gpuMemTotal: number; diskUsed: number; diskTotal: number }): string {
  return [
    ` ↑ ${Math.round(m.inetUp)} Mbps`,
    ` ↓ ${Math.round(m.inetDown)} Mbps`,
    ` ${m.status === "running" ? "{green-fg}●{/}" : "{red-fg}●{/}"} ${m.status}`,
    ` 🌡 ${m.gpuTempC}°C`,
    ` VRAM ${m.gpuMemUsed}/${m.gpuMemTotal}G`,
    ` Disk ${m.diskUsed}/${m.diskTotal}G`,
  ].join("\n");
}

function formatSettings(state: DashboardState, _info: InstanceInfo, cliArgs?: CliArgs): string {
  const cfg = loadConfig();
  const watchdog = isWatchdogRunning();

  const lines: string[] = [];

  // Model
  lines.push(` Model:    {bold}${cliArgs?.model ?? cfg.model}{/bold}`);

  // Strategy
  const strat = cliArgs?.strategy ?? "best";
  const stratIcon = strat === "cheap" ? "💰" : strat === "fast" ? "⚡" : "⭐";
  lines.push(` Strategy: ${stratIcon} ${strat}`);

  // GPU preference
  if (cliArgs?.gpu) {
    lines.push(` GPU lock: {bold}${cliArgs.gpu}{/bold}`);
  } else {
    lines.push(` GPU pref: ${cfg.gpuPrefer}`);
  }

  // Instance type
  const instType = cliArgs?.spot ? "spot" : cfg.instanceType;
  const isSpot = instType === "interruptible" || instType === "spot";
  lines.push(` Type:     ${isSpot ? "{yellow-fg}spot{/}" : "{green-fg}on-demand{/}"}`);

  // Instance status
  const statusIcon = state.instanceStatus === "running" ? "{green-fg}●{/}"
    : isInstanceInterrupted(state.instanceStatus) ? "{red-fg}●{/}"
    : "{yellow-fg}●{/}";
  lines.push(` Status:   ${statusIcon} ${state.instanceStatus}`);

  // Price + spot savings
  lines.push(` $/hr:     {yellow-fg}$${state.dphTotal.toFixed(3)}{/}`);
  if (isSpot && state.elapsedHours > 0) {
    // Estimate on-demand as ~2x spot price
    const estimatedSaved = state.dphTotal * state.elapsedHours;
    lines.push(` Saved:    {green-fg}~$${estimatedSaved.toFixed(3)}{/} vs on-demand`);
  }

  // Auto-recover
  if (cliArgs?.autoRecover) {
    lines.push(` Recover:  {green-fg}ON{/}`);
  }
  // Limits
  if (state.hoursLimit) {
    lines.push(` Max time: ${state.hoursLimit}h`);
  }
  if (state.budgetLimit) {
    lines.push(` Max $:    $${state.budgetLimit}`);
  }

  // Service mode
  lines.push(` Watchdog: ${watchdog ? "{green-fg}running{/}" : "{gray-fg}off{/}"}`);

  // Region
  if (cliArgs?.region) {
    lines.push(` Region:   ${cliArgs.region}`);
  }

  // Context
  const ctx = cliArgs?.context ?? 8192;
  lines.push(` Context:  ${ctx >= 1000 ? `${(ctx / 1000).toFixed(0)}K` : ctx}`);

  return lines.join("\n");
}

// === Helpers ===

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

function bar(pct: number, width = 10): string {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  const color = pct > 80 ? "{red-fg}" : pct > 50 ? "{yellow-fg}" : "{green-fg}";
  return `${color}[${"█".repeat(filled)}${"░".repeat(empty)}]{/} ${pct}%`;
}

function sorted(arr: number[]): number[] {
  return [...arr].sort((a, b) => a - b);
}

async function autoStop(state: DashboardState, screen: blessed.Widgets.Screen) {
  try {
    await destroyInstance(Number(state.info.instanceId));
    const { removeInstanceInfo } = await import("./config");
    removeInstanceInfo();
  } catch {}
  setTimeout(() => {
    screen.destroy();
    console.log(`✅ Instance auto-stopped. Spent: $${state.totalSpent.toFixed(4)}`);
    process.exit(0);
  }, 2000);
}
