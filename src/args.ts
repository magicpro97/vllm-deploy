/** Parse CLI arguments into typed flags */
export interface CliArgs {
  action: string;

  // --cheap / --fast / --best (strategy presets)
  strategy: "cheap" | "fast" | "best";

  // --gpu <name>        Lock to specific GPU
  gpu?: string;

  // --max-price <n>     Override max $/hr
  maxPrice?: number;

  // --spot              Use interruptible (cheaper, may be preempted)
  spot: boolean;

  // --auto / -y         Skip confirmation, deploy immediately
  auto: boolean;

  // --model <name>      Override model
  model?: string;

  // --context <n>       Override max context length
  context?: number;

  // --region <geo>      Prefer region (US, EU, Asia)
  region?: string;

  // --dry-run           Search only, don't deploy
  dryRun: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    action: argv[2] ?? "help",
    strategy: "best",
    spot: false,
    auto: false,
    dryRun: false,
  };

  for (let i = 3; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

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
