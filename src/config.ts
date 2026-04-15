import { $ } from "bun";

export interface Config {
  vastaiApiKey: string;
  model: string;
  vllmArgs: string;
  gpuPrefer: string;
  gpuMinVram: number;
  gpuMaxPrice: number;
  diskSize: number;
  instanceType: "on-demand" | "interruptible";
  hfToken?: string;
  dailyBudgetLimit: number;
}

export interface InstanceInfo {
  instanceId: string;
  ip: string;
  apiPort: string;
  sshPort: string;
  token: string;
  model: string;
  createdAt: string;
  apiUrl: string;
  dphTotal?: number;     // $/hr for budget tracking
  stopAfterHours?: number;
  stopAfterBudget?: number;
}

const DEFAULT_CONFIG: Config = {
  vastaiApiKey: "",
  model: "charaf/gemma4-31b-claude-opus-abliterated",
  vllmArgs: "--max-model-len 8192 --gpu-memory-utilization 0.95",
  gpuPrefer: "RTX 4090",
  gpuMinVram: 24,
  gpuMaxPrice: 0.5,
  diskSize: 50,
  instanceType: "on-demand",
  dailyBudgetLimit: 5.0,
};

export function loadConfig(): Config {
  const envPath = `${import.meta.dir}/../.env`;
  const config = { ...DEFAULT_CONFIG };

  try {
    const content = require("fs").readFileSync(envPath, "utf-8") as string;
    for (const line of content.split("\n")) {
      const match = line.match(/^\s*([^#][^=]+)=(.*)$/);
      if (!match) continue;
      const [, key, val] = match;
      const k = key.trim();
      const v = val.trim();

      switch (k) {
        case "VASTAI_API_KEY":
          config.vastaiApiKey = v;
          break;
        case "VLLM_MODEL":
          config.model = v;
          break;
        case "VLLM_ARGS":
          config.vllmArgs = v;
          break;
        case "GPU_PREFER":
          config.gpuPrefer = v;
          break;
        case "GPU_MIN_VRAM":
          config.gpuMinVram = Number(v);
          break;
        case "GPU_MAX_PRICE":
          config.gpuMaxPrice = Number(v);
          break;
        case "DISK_SIZE":
          config.diskSize = Number(v);
          break;
        case "INSTANCE_TYPE":
          config.instanceType = v as Config["instanceType"];
          break;
        case "HF_TOKEN":
          config.hfToken = v;
          break;
        case "DAILY_BUDGET_LIMIT":
          config.dailyBudgetLimit = Number(v);
          break;
      }
    }
    console.log("✅ Config loaded from .env");
  } catch {
    console.log("⚠️  No .env found. Using defaults. Run: cp .env.example .env");
  }

  return config;
}

const INFO_PATH = `${import.meta.dir}/../instance_info.json`;

export function saveInstanceInfo(info: InstanceInfo) {
  Bun.write(INFO_PATH, JSON.stringify(info, null, 2));
}

export function loadInstanceInfo(): InstanceInfo | null {
  try {
    const data = require("fs").readFileSync(INFO_PATH, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function removeInstanceInfo() {
  try {
    require("fs").unlinkSync(INFO_PATH);
  } catch {}
}

// === PID file for service mode ===
const PID_PATH = `${import.meta.dir}/../.watchdog.pid`;

export function saveWatchdogPid(pid: number) {
  Bun.write(PID_PATH, String(pid));
}

export function loadWatchdogPid(): number | null {
  try {
    const data = require("fs").readFileSync(PID_PATH, "utf-8").trim();
    return Number(data);
  } catch {
    return null;
  }
}

export function removeWatchdogPid() {
  try {
    require("fs").unlinkSync(PID_PATH);
  } catch {}
}

export function isWatchdogRunning(): boolean {
  const pid = loadWatchdogPid();
  if (!pid) return false;
  try {
    process.kill(pid, 0); // check if process exists
    return true;
  } catch {
    removeWatchdogPid();
    return false;
  }
}
