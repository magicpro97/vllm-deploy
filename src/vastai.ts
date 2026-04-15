import { $ } from "bun";

export interface VastOffer {
  id: number;
  gpu_name: string;
  gpu_ram: number;
  dph_total: number;
  inet_up: number;
  inet_down: number;
  num_gpus: number;
  disk_space: number;
  reliability: number;
  dlperf: number;        // deep learning perf score
  cpu_cores_effective: number;
  machine_id: number;
  geolocation: string;
  cuda_max_good: number;
  verified: boolean;
}

export interface ScoredOffer extends VastOffer {
  score: number;         // value score (higher = better deal)
  tier: string;          // GPU tier label
  estTokPerSec: number;  // estimated tok/s for 31B Q4
  costPer1kTok: number;  // estimated cost per 1K tokens
}

export interface VastInstance {
  id: number;
  gpu_name: string;
  actual_status: string;
  public_ipaddr: string;
  ports: Record<string, Array<{ HostPort: string }>>;
  dph_total: number;
  ssh_port: number;
  ssh_host: string;
}

// GPU performance estimates for 31B Q4_K_M model (tok/s)
const GPU_PERF: Record<string, { tokPerSec: number; tier: string }> = {
  "RTX 3090":     { tokPerSec: 18, tier: "💰 Budget" },
  "RTX 3090 Ti":  { tokPerSec: 20, tier: "💰 Budget" },
  "RTX 4090":     { tokPerSec: 32, tier: "⭐ Value" },
  "RTX 4080":     { tokPerSec: 22, tier: "💰 Budget" },  // 16GB, tight
  "RTX 5090":     { tokPerSec: 42, tier: "🏆 Premium" },
  "A6000":        { tokPerSec: 22, tier: "⭐ Value" },
  "A6000 Ada":    { tokPerSec: 28, tier: "⭐ Value" },
  "L40":          { tokPerSec: 25, tier: "⭐ Value" },
  "L40S":         { tokPerSec: 28, tier: "⭐ Value" },
  "A100 PCIe":    { tokPerSec: 35, tier: "🏆 Premium" },
  "A100 SXM":     { tokPerSec: 38, tier: "🏆 Premium" },
  "A100":         { tokPerSec: 35, tier: "🏆 Premium" },
  "H100 PCIe":    { tokPerSec: 55, tier: "🏆 Premium" },
  "H100 SXM":     { tokPerSec: 60, tier: "🏆 Premium" },
  "H100":         { tokPerSec: 55, tier: "🏆 Premium" },
};

// All GPU names to search (>= 24GB VRAM for 31B Q4_K_M)
const GPU_CANDIDATES = [
  "RTX 3090",
  "RTX 3090 Ti",
  "RTX 4090",
  "RTX 5090",
  "A6000",
  "L40",
  "L40S",
  "A100",
  "H100",
];

export async function searchOffers(opts: {
  type: string;
  gpuName: string;
  minVram: number;
  minDisk: number;
  limit?: number;
}): Promise<VastOffer[]> {
  const result =
    await $`vastai search offers --type ${opts.type} --gpu-name ${opts.gpuName} --min-gpu-ram ${opts.minVram} --min-disk ${opts.minDisk} --order dph-asc --limit ${opts.limit ?? 5} --raw`
      .text()
      .catch(() => "[]");
  try {
    return JSON.parse(result);
  } catch {
    return [];
  }
}

/** Search ALL compatible GPUs in parallel, score and rank by value */
export async function searchBestOffers(opts: {
  type: string;
  minVram: number;
  minDisk: number;
  maxPrice: number;
  minReliability?: number;
  minUploadSpeed?: number;
  limit?: number;
  gpuCandidates?: string[];
  sortBy?: "best" | "cheap" | "fast";
  region?: string;
}): Promise<ScoredOffer[]> {
  const candidates = opts.gpuCandidates ?? GPU_CANDIDATES;
  const minReliability = opts.minReliability ?? 0.90;
  const minUpload = opts.minUploadSpeed ?? 100;

  // Search all GPU types in parallel
  const searches = candidates.map((gpu) =>
    searchOffers({
      type: opts.type,
      gpuName: gpu,
      minVram: opts.minVram,
      minDisk: opts.minDisk,
      limit: 3, // top 3 per GPU type
    })
  );

  const results = await Promise.all(searches);
  const allOffers = results.flat();

  // Score and filter
  const scored: ScoredOffer[] = allOffers
    .filter((o) => {
      if (o.dph_total > opts.maxPrice) return false;
      if (o.reliability < minReliability) return false;
      if (o.inet_up < minUpload) return false;
      if (o.gpu_ram < opts.minVram) return false;
      if (opts.region && o.geolocation && !o.geolocation.toUpperCase().includes(opts.region)) return false;
      return true;
    })
    .map((o) => {
      const perf = findGpuPerf(o.gpu_name);
      const tokPerSec = perf.tokPerSec * (o.num_gpus ?? 1);
      // Cost per 1K tokens: price_per_second / tok_per_second * 1000
      const pricePerSec = o.dph_total / 3600;
      const costPer1kTok = tokPerSec > 0 ? (pricePerSec / tokPerSec) * 1000 : 999;

      // Value score: higher = better deal
      const tokPerDollar = tokPerSec / o.dph_total;
      const reliabilityBonus = o.reliability;
      const uploadBonus = Math.min(o.inet_up / 1000, 1);
      const vramHeadroom = Math.min((o.gpu_ram - opts.minVram) / 24, 1);

      const score =
        tokPerDollar * 0.60 +
        reliabilityBonus * 100 * 0.20 +
        uploadBonus * 100 * 0.10 +
        vramHeadroom * 100 * 0.10;

      return {
        ...o,
        score,
        tier: perf.tier,
        estTokPerSec: tokPerSec,
        costPer1kTok,
      };
    });

  // Sort by strategy
  switch (opts.sortBy ?? "best") {
    case "cheap":
      scored.sort((a, b) => a.dph_total - b.dph_total);
      break;
    case "fast":
      scored.sort((a, b) => b.estTokPerSec - a.estTokPerSec);
      break;
    case "best":
    default:
      scored.sort((a, b) => a.costPer1kTok - b.costPer1kTok);
      break;
  }

  return scored.slice(0, opts.limit ?? 10);
}

/** Also search interruptible for comparison */
export async function searchWithSavings(opts: {
  minVram: number;
  minDisk: number;
  maxPrice: number;
  limit?: number;
}): Promise<{ onDemand: ScoredOffer[]; interruptible: ScoredOffer[] }> {
  const [onDemand, interruptible] = await Promise.all([
    searchBestOffers({ ...opts, type: "on-demand" }),
    searchBestOffers({ ...opts, type: "interruptible", maxPrice: opts.maxPrice * 1.5 }),
  ]);
  return { onDemand, interruptible };
}

function findGpuPerf(gpuName: string): { tokPerSec: number; tier: string } {
  // Exact match first
  if (GPU_PERF[gpuName]) return GPU_PERF[gpuName];

  // Fuzzy match
  const normalized = gpuName.toUpperCase();
  for (const [key, val] of Object.entries(GPU_PERF)) {
    if (normalized.includes(key.toUpperCase())) return val;
  }

  // Unknown GPU — estimate conservatively
  return { tokPerSec: 15, tier: "❓ Unknown" };
}

export async function createInstance(
  offerId: number,
  env: Record<string, string>,
  diskSize: number
): Promise<string | null> {
  const envArgs = Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`]);

  const result =
    await $`vastai create instance ${offerId} --image vllm/vllm-openai:latest --disk ${diskSize} ${envArgs}`.text();

  const match = result.match(/(\d+)/);
  return match ? match[1] : null;
}

export async function showInstances(): Promise<VastInstance[]> {
  const result = await $`vastai show instances --raw`.text().catch(() => "[]");
  try {
    return JSON.parse(result);
  } catch {
    return [];
  }
}

export async function showInstancesFormatted(): Promise<string> {
  return $`vastai show instances`.text().catch(() => "No instances");
}

export async function destroyInstance(id: number | string): Promise<string> {
  return $`vastai destroy instance ${id}`.text();
}

export async function getLogs(id: number | string, tail = 50): Promise<string> {
  return $`vastai logs ${id} --tail ${tail}`.text().catch(() => "No logs available");
}

export async function sshConnect(host: string, port: string | number) {
  const proc = Bun.spawn(["ssh", "-p", String(port), `root@${host}`], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;
}

/** Get machine utilization metrics for an instance */
export async function getInstanceMetrics(id: number | string): Promise<InstanceMetrics> {
  try {
    // vastai show instance gives detailed info including utilization
    const result = await $`vastai show instance ${id} --raw`.text().catch(() => "{}");
    const data = JSON.parse(result);
    return {
      cpuUtil: data.cpu_util ?? 0,
      ramUsed: data.mem_usage ?? 0,
      ramTotal: data.cpu_ram ?? 0,
      gpuUtil: data.gpu_util ?? 0,
      gpuTempC: data.gpu_temp ?? 0,
      gpuMemUsed: data.gpu_mem_used ?? 0,
      gpuMemTotal: data.gpu_ram ?? 0,
      inetUp: data.inet_up ?? 0,
      inetDown: data.inet_down ?? 0,
      diskUsed: data.disk_used ?? 0,
      diskTotal: data.disk_space ?? 0,
      uptime: data.duration ?? 0,
      status: data.actual_status ?? "unknown",
    };
  } catch {
    return {
      cpuUtil: 0, ramUsed: 0, ramTotal: 0,
      gpuUtil: 0, gpuTempC: 0, gpuMemUsed: 0, gpuMemTotal: 0,
      inetUp: 0, inetDown: 0,
      diskUsed: 0, diskTotal: 0,
      uptime: 0, status: "unknown",
    };
  }
}

export interface InstanceMetrics {
  cpuUtil: number;
  ramUsed: number;
  ramTotal: number;
  gpuUtil: number;
  gpuTempC: number;
  gpuMemUsed: number;
  gpuMemTotal: number;
  inetUp: number;
  inetDown: number;
  diskUsed: number;
  diskTotal: number;
  uptime: number;
  status: string;
}
