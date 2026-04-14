const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
};

export const log = {
  info: (msg: string) => console.log(`${COLORS.cyan}${msg}${COLORS.reset}`),
  ok: (msg: string) => console.log(`${COLORS.green}${msg}${COLORS.reset}`),
  warn: (msg: string) => console.log(`${COLORS.yellow}${msg}${COLORS.reset}`),
  err: (msg: string) => console.log(`${COLORS.red}${msg}${COLORS.reset}`),
  dim: (msg: string) => console.log(`${COLORS.gray}${msg}${COLORS.reset}`),
  bold: (msg: string) => console.log(`${COLORS.bold}${msg}${COLORS.reset}`),
};

export function prompt(question: string): string {
  process.stdout.write(`${COLORS.cyan}${question}${COLORS.reset} `);
  const buf = Buffer.alloc(256);
  const fd = require("fs").openSync("/dev/stdin", "r");

  // Use Bun's built-in prompt
  const answer = globalThis.prompt?.(question);
  return answer ?? "";
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function formatPrice(n: number): string {
  return `$${n.toFixed(3)}`;
}

export function table(
  headers: string[],
  rows: string[][],
  colWidths?: number[]
) {
  const widths =
    colWidths ??
    headers.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length))
    );

  const hr = widths.map((w) => "─".repeat(w + 2)).join("┼");
  const fmt = (row: string[]) =>
    row.map((c, i) => ` ${(c ?? "").padEnd(widths[i])} `).join("│");

  console.log(`┌${hr.replace(/┼/g, "┬")}┐`);
  console.log(`│${fmt(headers)}│`);
  console.log(`├${hr}┤`);
  rows.forEach((r) => console.log(`│${fmt(r)}│`));
  console.log(`└${hr.replace(/┼/g, "┴")}┘`);
}
