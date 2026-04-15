/** Parse CLI arguments into typed flags.
 *  Priority: CLI arg > env var > .env config default */
export interface CliArgs {
  action: string;

  // --cheap / --fast / --best (strategy presets) | VLLM_STRATEGY
  strategy: "cheap" | "fast" | "best";

  // --gpu <name>        Lock to specific GPU | VLLM_GPU
  gpu?: string;

  // --max-price <n>     Override max $/hr | VLLM_MAX_PRICE
  maxPrice?: number;

  // --spot              Use interruptible | VLLM_SPOT=1
  spot: boolean;

  // --auto / -y         Skip confirmation | VLLM_AUTO=1
  auto: boolean;

  // --model <name>      Override model | VLLM_MODEL
  model?: string;

  // --context <n>       Override max context length | VLLM_CONTEXT
  context?: number;

  // --region <geo>      Prefer region | VLLM_REGION
  region?: string;

  // --dry-run           Search only, don't deploy
  dryRun: boolean;

  // --hours <n>         Auto-stop after N hours | VLLM_HOURS
  hours?: number;

  // --budget <n>        Auto-stop after spending $N | VLLM_BUDGET
  budget?: number;

  // --service           Run watchdog as background service
  service: boolean;

  // Extra flags passed through (e.g. --restore, --off)
  extra: string[];
}

/** Read env var, return undefined if not set or empty */
function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function envNum(name: string): number | undefined {
  const v = env(name);
  return v ? Number(v) : undefined;
}

function envBool(name: string): boolean {
  const v = env(name);
  return v === "1" || v === "true";
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    action: argv[2] ?? "help",
    // Env fallbacks
    strategy: (env("VLLM_STRATEGY") as CliArgs["strategy"]) ?? "best",
    gpu: env("VLLM_GPU"),
    maxPrice: envNum("VLLM_MAX_PRICE"),
    spot: envBool("VLLM_SPOT"),
    auto: envBool("VLLM_AUTO"),
    model: env("VLLM_MODEL"),
    context: envNum("VLLM_CONTEXT"),
    region: env("VLLM_REGION")?.toUpperCase(),
    dryRun: false,
    hours: envNum("VLLM_HOURS"),
    budget: envNum("VLLM_BUDGET"),
    service: envBool("VLLM_SERVICE"),
    extra: [],
  };

  for (let i = 3; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (!arg) continue;

    switch (arg) {
      // Strategy presets
      case "--cheap":
        args.strategy = "cheap";
        break;
      case "--fast":
        args.strategy = "fast";
        break;
      case "--best":
        args.strategy = "best";
        break;

      // GPU lock
      case "--gpu":
        args.gpu = next;
        i++;
        break;

      // Price override
      case "--max-price":
        args.maxPrice = Number(next);
        i++;
        break;

      // Spot/interruptible
      case "--spot":
        args.spot = true;
        break;

      // Auto-confirm
      case "--auto":
      case "-y":
        args.auto = true;
        break;

      // Model override
      case "--model":
        args.model = next;
        i++;
        break;

      // Context length
      case "--context":
        args.context = Number(next);
        i++;
        break;

      // Region preference
      case "--region":
        args.region = next?.toUpperCase();
        i++;
        break;

      // Dry run
      case "--dry-run":
        args.dryRun = true;
        break;

      // Auto-stop after N hours
      case "--hours":
        args.hours = Number(next);
        i++;
        break;

      // Auto-stop after spending $N
      case "--budget":
        args.budget = Number(next);
        i++;
        break;

      // Background service mode
      case "--service":
        args.service = true;
        break;

      // Pass through unknown flags
      default:
        if (arg.startsWith("--")) args.extra.push(arg);
        break;
    }
  }

  return args;
}

/** Explain what each strategy does */
export function describeStrategy(s: CliArgs["strategy"]): string {
  switch (s) {
    case "cheap":
      return "💰 CHEAP — giá thuê/hr thấp nhất (có thể chậm)";
    case "fast":
      return "⚡ FAST — tok/s cao nhất (có thể đắt)";
    case "best":
      return "⭐ BEST — $/1K tokens thấp nhất (cân bằng giá & tốc độ)";
  }
}
