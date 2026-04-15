import {
  loadConfig, saveInstanceInfo, loadInstanceInfo, removeInstanceInfo,
  saveWatchdogPid, loadWatchdogPid, removeWatchdogPid, isWatchdogRunning,
} from "./config";
import {
  searchBestOffers, searchWithSavings,
  createInstance, showInstances, showInstancesFormatted,
  destroyInstance, getLogs, sshConnect,
  getInstanceMetrics, isInstanceInterrupted,
  type VastInstance, type ScoredOffer,
} from "./vastai";
import { log, sleep, formatPrice, table } from "./ui";
import { parseArgs, describeStrategy } from "./args";

const config = loadConfig();
const args = parseArgs(Bun.argv);
const action = args.action;

async function waitForReady(instanceId: string, timeoutSec = 600): Promise<VastInstance | null> {
  log.info("\n⏳ Đợi instance ready...");
  const interval = 15_000;
  let elapsed = 0;

  while (elapsed < timeoutSec * 1000) {
    await sleep(interval);
    elapsed += interval;

    const instances = await showInstances();
    const inst = instances.find((i) => String(i.id) === instanceId);

    if (inst) {
      const pct = Math.round((elapsed / (timeoutSec * 1000)) * 100);
      log.dim(`  [${pct}%] Status: ${inst.actual_status} (${elapsed / 1000}s)`);

      if (inst.actual_status === "running") return inst;
    }
  }

  log.warn(`⚠️  Timeout sau ${timeoutSec}s. Check: vastai show instances`);
  return null;
}

function extractPort(inst: VastInstance, internalPort: string): string {
  if (!inst.ports) return "?";
  const mapping = inst.ports[`${internalPort}/tcp`];
  if (mapping?.[0]?.HostPort) return mapping[0].HostPort;
  return "?";
}

// === Commands ===

async function cmdSearch() {
  const maxPrice = args.maxPrice ?? config.gpuMaxPrice;
  const type = args.spot ? "interruptible" : config.instanceType;

  log.info("\n🔍 Tìm GPU rẻ nhất trên toàn marketplace...");
  log.dim(`  Strategy:  ${describeStrategy(args.strategy)}`);
  log.dim(`  VRAM: >=${config.gpuMinVram}GB | Max: ${formatPrice(maxPrice)}/hr | Type: ${type}`);
  if (args.gpu) log.dim(`  GPU lock:  ${args.gpu}`);
  if (args.region) log.dim(`  Region:    ${args.region}`);
  console.log();

  if (args.spot) {
    // Show both for comparison
    const { onDemand, interruptible } = await searchWithSavings({
      minVram: config.gpuMinVram,
      minDisk: config.diskSize,
      maxPrice,
      limit: 8,
    });

    if (onDemand.length > 0) {
      log.ok("📊 ON-DEMAND:");
      renderOfferTable(onDemand);
    }
    if (interruptible.length > 0) {
      log.warn("\n💸 INTERRUPTIBLE (spot):");
      renderOfferTable(interruptible);
    }
    if (onDemand.length > 0 && interruptible.length > 0) {
      const intFirst = interruptible[0];
      const odFirst = onDemand[0];
      if (intFirst && odFirst) {
        const saving = ((1 - intFirst.dph_total / odFirst.dph_total) * 100).toFixed(0);
        log.info(`\n💡 Spot rẻ hơn ~${saving}%`);
      }
    }
    return;
  }

  const offers = await searchBestOffers({
    type,
    minVram: config.gpuMinVram,
    minDisk: config.diskSize,
    maxPrice,
    sortBy: args.strategy,
    region: args.region,
    gpuCandidates: args.gpu ? [args.gpu] : undefined,
    limit: 10,
  });

  if (offers.length === 0) {
    log.err("❌ Không tìm thấy GPU. Thử: --max-price 1.0 hoặc bỏ --gpu");
    return;
  }

  renderOfferTable(offers);
}

function renderOfferTable(offers: ScoredOffer[]) {
  table(
    ["#", "ID", "GPU", "VRAM", "$/hr", "~tok/s", "$/1Ktok", "Upload", "Rely", "Tier"],
    offers.map((o, i) => [
      String(i + 1),
      String(o.id),
      o.gpu_name,
      `${o.gpu_ram}GB`,
      formatPrice(o.dph_total),
      `~${o.estTokPerSec}`,
      `$${o.costPer1kTok.toFixed(4)}`,
      `${Math.round(o.inet_up)}M`,
      `${(o.reliability * 100).toFixed(0)}%`,
      o.tier,
    ])
  );
}

async function cmdStart() {
  const maxPrice = args.maxPrice ?? config.gpuMaxPrice;
  // Smart spot: auto-enable for small budgets
  if (args.budget && args.budget <= 5 && !args.spot) {
    args.spot = true;
    log.dim("  💡 Budget ≤ $5 → auto spot (tiết kiệm ~50%)");
  }
  const type = args.spot ? "interruptible" : config.instanceType;
  const model = args.model ?? config.model;
  const vllmArgs = args.context
    ? config.vllmArgs.replace(/--max-model-len \d+/, `--max-model-len ${args.context}`)
    : config.vllmArgs;

  log.info("\n🚀 Deploy vLLM trên Vast.ai");
  log.dim(`  Model:     ${model}`);
  log.dim(`  Strategy:  ${describeStrategy(args.strategy)}`);
  log.dim(`  Type:      ${type} | Max: ${formatPrice(maxPrice)}/hr`);
  log.dim(`  Args:      ${vllmArgs}`);
  if (args.gpu) log.dim(`  GPU lock:  ${args.gpu}`);
  if (args.region) log.dim(`  Region:    ${args.region}`);
  if (args.hours) log.dim(`  ⏰ Auto-stop: ${args.hours}h`);
  if (args.budget) log.dim(`  💵 Budget:    $${args.budget}`);
  if (args.autoRecover) log.dim(`  🔄 Auto-recover: ON`);
  if (args.hours && args.budget) log.dim(`  → Điều kiện nào đến trước sẽ tự tắt`);
  console.log();

  // Smart multi-GPU search
  log.warn("🔍 Tìm GPU inference rẻ nhất...");
  const offers = await searchBestOffers({
    type,
    minVram: config.gpuMinVram,
    minDisk: config.diskSize,
    maxPrice,
    sortBy: args.strategy,
    region: args.region,
    gpuCandidates: args.gpu ? [args.gpu] : undefined,
    limit: 8,
  });

  if (offers.length === 0) {
    log.err("❌ Không tìm thấy GPU. Thử: --max-price 1.0 hoặc bỏ --gpu filter");
    process.exit(1);
  }

  // Show ranked offers
  log.ok(`\n✅ ${offers.length} offers (${describeStrategy(args.strategy)}):`);
  renderOfferTable(offers);

  const best = offers[0];
  if (!best) return;
  log.ok(`\n🏆 Best: ${best.gpu_name} @ ${formatPrice(best.dph_total)}/hr | ~${best.estTokPerSec} tok/s | $${best.costPer1kTok.toFixed(4)}/1Ktok`);
  log.dim(`   ${best.tier} | ${(best.reliability * 100).toFixed(0)}% reliable | ${Math.round(best.inet_up)}Mbps`);

  if (args.dryRun) {
    log.warn("\n⏹️  --dry-run: không deploy.");
    return;
  }

  let selected: ScoredOffer = best;

  if (!args.auto) {
    const confirm = globalThis.prompt?.("Deploy? (Y/n/số 1-8)") ?? "y";
    if (confirm.toLowerCase() === "n") process.exit(0);
    const idx = Number(confirm);
    if (idx >= 1 && idx <= offers.length) {
      selected = offers[idx - 1] ?? best;
      log.info(`  → Chọn #${idx}: ${selected.gpu_name} @ ${formatPrice(selected.dph_total)}/hr`);
    }
  } else {
    log.info("  → --auto: tự chọn rẻ nhất");
  }

  await doCreate(selected.id, model, vllmArgs, selected.dph_total);
}

async function doCreate(offerId: number, model?: string, vllmArgs?: string, dphTotal?: number) {
  log.warn("\n📦 Tạo instance...");

  const useModel = model ?? config.model;
  const useArgs = vllmArgs ?? config.vllmArgs;

  const env: Record<string, string> = {
    VLLM_MODEL: useModel,
    VLLM_ARGS: useArgs,
    AUTO_PARALLEL: "true",
  };
  if (config.hfToken) env["HUGGING_FACE_HUB_TOKEN"] = config.hfToken;

  const instanceId = await createInstance(offerId, env, config.diskSize);

  if (!instanceId) {
    log.err("❌ Không tạo được instance.");
    process.exit(1);
  }

  log.info(`\n⏳ Instance ID: ${instanceId}`);

  const inst = await waitForReady(instanceId, 600);

  if (inst) {
    const apiPort = extractPort(inst, "8000");
    const sshPort = extractPort(inst, "22");
    const ip = inst.public_ipaddr ?? inst.ssh_host;
    const apiUrl = `http://${ip}:${apiPort}/v1`;

    log.ok("\n✅ Instance READY!");
    log.info(`  API:  ${apiUrl}`);
    log.info(`  SSH:  ssh -p ${sshPort} root@${ip}`);
    log.warn("\n💡 Model đang load, có thể cần thêm 5-10 phút.");
    log.warn("   Chạy 'bun run deploy test' để check API ready.");

    saveInstanceInfo({
      instanceId,
      ip,
      apiPort,
      sshPort,
      token: "",
      model: config.model,
      createdAt: new Date().toISOString(),
      apiUrl,
      dphTotal: dphTotal,
      stopAfterHours: args.hours,
      stopAfterBudget: args.budget,
    });

    // Start auto-shutdown watchdog if limits are set
    if (args.hours || args.budget) {
      if (args.service) {
        startServiceMode(instanceId, dphTotal ?? 0);
      } else {
        await startWatchdog(instanceId, dphTotal ?? 0);
      }
    } else if (args.service) {
      log.warn("⚠️  --service cần --hours và/hoặc --budget để biết khi nào tắt");
    }
  }
}

// === Auto-shutdown watchdog ===

async function startWatchdog(instanceId: string, dphTotal: number) {
  const hours = args.hours;
  const budget = args.budget;
  let currentInstanceId = instanceId;
  let currentDph = dphTotal;
  let cumulativeSpent = 0; // tracks total across recoveries
  let cumulativeHours = 0;
  let recoveryCount = 0;
  const MAX_RECOVERIES = 10;
  const RECOVERY_COOLDOWN = 5 * 60 * 1000; // 5 min between recoveries

  // Calculate limits
  const maxHours = hours ?? Infinity;
  const maxBudget = budget ?? Infinity;

  log.warn(`\n🔒 Auto-shutdown watchdog đang chạy:`);
  if (hours) log.dim(`   ⏰ Tắt sau ${hours}h`);
  if (budget) log.dim(`   💵 Tắt khi chi $${budget}`);
  if (args.autoRecover) log.dim(`   🔄 Auto-recover: ON (max ${MAX_RECOVERIES} lần)`);
  log.warn(`   ⚠️  Đóng terminal sẽ HỦY watchdog! Dùng 'bun run deploy stop' để tắt thủ công.`);

  const checkInterval = 60_000;

  while (true) {
    await sleep(checkInterval);

    // Check instance status via Vast.ai API
    const metrics = await getInstanceMetrics(currentInstanceId);
    const status = metrics.status;

    // Use actual uptime from Vast.ai (not local time)
    const sessionHours = metrics.uptime / 3600;
    const sessionSpent = sessionHours * currentDph;
    const totalHours = cumulativeHours + sessionHours;
    const totalSpent = cumulativeSpent + sessionSpent;

    // Instance interrupted?
    if (isInstanceInterrupted(status)) {
      log.warn(`\n⚠️  Instance ${currentInstanceId} status: ${status}`);
      cumulativeHours += sessionHours;
      cumulativeSpent += sessionSpent;

      if (args.autoRecover && recoveryCount < MAX_RECOVERIES) {
        // Check if we still have budget/time left
        if (totalHours >= maxHours) {
          log.warn(`⏰ Đã đạt ${hours}h — không recover.`);
          await autoDestroy(currentInstanceId, `${hours}h`, totalSpent);
          return;
        }
        if (totalSpent >= maxBudget) {
          log.warn(`💵 Đã chi $${totalSpent.toFixed(2)}/${budget} — không recover.`);
          await autoDestroy(currentInstanceId, `$${totalSpent.toFixed(2)}`, totalSpent);
          return;
        }

        recoveryCount++;
        log.warn(`🔄 Auto-recover #${recoveryCount}/${MAX_RECOVERIES}...`);
        log.dim(`   Đợi ${RECOVERY_COOLDOWN / 60000} phút trước khi tìm GPU mới...`);
        await sleep(RECOVERY_COOLDOWN);

        const newId = await recoverSpotInstance();
        if (newId) {
          currentInstanceId = newId;
          const info = loadInstanceInfo();
          currentDph = info?.dphTotal ?? currentDph;
          log.ok(`✅ Recovered! Instance mới: ${newId}`);
          continue;
        } else {
          log.err(`❌ Không tìm được GPU. Dừng watchdog.`);
          return;
        }
      } else {
        const reason = recoveryCount >= MAX_RECOVERIES
          ? `Đã recover ${MAX_RECOVERIES} lần`
          : "Auto-recover OFF";
        log.err(`❌ Instance offline. ${reason}. Dừng watchdog.`);
        removeInstanceInfo();
        return;
      }
    }

    // Check time limit
    if (hours && totalHours >= hours) {
      log.warn(`\n⏰ ĐÃ ĐẠT ${hours}h (actual uptime) — tự tắt...`);
      await autoDestroy(currentInstanceId, `${hours}h`, totalSpent);
      return;
    }

    // Check budget limit
    if (budget && totalSpent >= budget) {
      log.warn(`\n💵 ĐÃ CHI $${totalSpent.toFixed(2)}/${budget} — tự tắt...`);
      await autoDestroy(currentInstanceId, `$${totalSpent.toFixed(2)}`, totalSpent);
      return;
    }

    // Progress report every 10 minutes
    if (Math.round(metrics.uptime / 60) % 10 === 0) {
      const remaining = Math.max(0, (maxHours - totalHours) * 60);
      const statusIcon = status === "running" ? "🟢" : "🟡";
      log.dim(`   ${statusIcon} ${totalHours.toFixed(1)}h | $${totalSpent.toFixed(3)} spent | ~${Math.round(remaining)}m left${recoveryCount > 0 ? ` | 🔄${recoveryCount}` : ""}`);
    }
  }
}

/** Attempt to find and deploy a new spot instance after interruption */
async function recoverSpotInstance(): Promise<string | null> {
  log.warn("🔍 Tìm GPU mới cho spot recovery...");

  const maxPrice = args.maxPrice ?? config.gpuMaxPrice;
  const model = args.model ?? config.model;
  const vllmArgs = args.context
    ? config.vllmArgs.replace(/--max-model-len \d+/, `--max-model-len ${args.context}`)
    : config.vllmArgs;

  const offers = await searchBestOffers({
    type: "interruptible",
    minVram: config.gpuMinVram,
    minDisk: config.diskSize,
    maxPrice,
    sortBy: args.strategy,
    region: args.region,
    gpuCandidates: args.gpu ? [args.gpu] : undefined,
    limit: 5,
  });

  if (offers.length === 0) {
    log.err("❌ Không tìm thấy GPU nào.");
    return null;
  }

  const best = offers[0];
  if (!best) return null;
  log.info(`🏆 Tìm thấy: ${best.gpu_name} @ ${formatPrice(best.dph_total)}/hr`);

  const env: Record<string, string> = {};
  env["VLLM_MODEL"] = model;
  env["VLLM_ARGS"] = vllmArgs;
  if (config.hfToken) env["HF_TOKEN"] = config.hfToken;

  const newId = await createInstance(best.id, env, config.diskSize);
  if (!newId) {
    log.err("❌ Không tạo được instance mới.");
    return null;
  }

  // Wait for ready
  const inst = await waitForReady(newId, 300);
  if (!inst) {
    log.err("❌ Instance mới không ready trong 5 phút.");
    return null;
  }

  const ports = inst.ports ?? {};
  const apiPort = ports["8000/tcp"]?.[0]?.HostPort ?? "8000";
  const sshPort = String(inst.ssh_port ?? ports["22/tcp"]?.[0]?.HostPort ?? "22");
  const ip = inst.public_ipaddr ?? inst.ssh_host;

  saveInstanceInfo({
    instanceId: newId,
    ip,
    apiPort,
    sshPort,
    token: "",
    model,
    createdAt: new Date().toISOString(),
    apiUrl: `http://${ip}:${apiPort}/v1`,
    dphTotal: best.dph_total,
    stopAfterHours: args.hours,
    stopAfterBudget: args.budget,
  });

  return newId;
}

async function autoDestroy(instanceId: string, reason: string, totalSpent: number) {
  try {
    await destroyInstance(Number(instanceId));
    removeInstanceInfo();
    removeWatchdogPid();
    log.ok(`\n✅ Instance ${instanceId} đã tự tắt.`);
    log.info(`   Lý do: ${reason}`);
    log.info(`   Tổng chi: ~$${totalSpent.toFixed(3)}`);
  } catch (e) {
    log.err(`❌ Không tắt được instance ${instanceId}: ${e}`);
    log.warn(`   Hãy chạy: bun run deploy stop`);
  }
  process.exit(0);
}

/** Start watchdog as a detached background process */
function startServiceMode(_instanceId: string, _dphTotal: number) {
  // Build args for background process
  const bgArgs = [
    "run", "src/cli.ts", "watch",
    ...(args.hours ? ["--hours", String(args.hours)] : []),
    ...(args.budget ? ["--budget", String(args.budget)] : []),
    ...(args.autoRecover ? ["--auto-recover"] : []),
  ];

  const proc = Bun.spawn(["bun", ...bgArgs], {
    cwd: import.meta.dir + "/..",
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env, VLLM_SERVICE_BG: "1" },
  });

  proc.unref(); // detach from parent
  saveWatchdogPid(proc.pid);

  log.ok(`\n🔧 Watchdog chạy nền: PID ${proc.pid}`);
  log.dim(`   Xem: bun run deploy dashboard`);
  log.dim(`   Tắt: bun run deploy stop`);
}

async function cmdStop() {
  // Kill watchdog service if running
  if (isWatchdogRunning()) {
    const pid = loadWatchdogPid();
    if (pid) {
      try {
        process.kill(pid);
        log.ok(`🔧 Watchdog service (PID ${pid}) stopped.`);
      } catch {}
      removeWatchdogPid();
    }
  }

  const instances = await showInstances();

  if (instances.length === 0) {
    log.dim("ℹ️  Không có instance đang chạy.");
    return;
  }

  log.warn("\n🛑 Instances đang chạy:");
  table(
    ["ID", "GPU", "Price/hr", "Status"],
    instances.map((i) => [
      String(i.id),
      i.gpu_name ?? "?",
      i.dph_total ? formatPrice(i.dph_total) : "?",
      i.actual_status ?? "?",
    ])
  );

  if (instances.length === 1) {
    const inst = instances[0];
    if (!inst) return;
    const id = inst.id;
    const confirm = globalThis.prompt?.(`Destroy instance ${id}? (Y/n)`) ?? "y";
    if (confirm.toLowerCase() !== "n") {
      const result = await destroyInstance(id);
      log.ok(`✅ Instance ${id} destroyed. Ngừng tính tiền.`);
      console.log(result);
      removeInstanceInfo();
    }
  } else {
    const input = globalThis.prompt?.("Nhập Instance ID (hoặc 'all')") ?? "";
    if (input === "all") {
      for (const inst of instances) {
        await destroyInstance(inst.id);
        log.ok(`  Destroyed: ${inst.id}`);
      }
      removeInstanceInfo();
    } else {
      await destroyInstance(input);
      log.ok(`✅ Destroyed: ${input}`);
    }
  }
}

async function cmdStatus() {
  log.info("\n📊 Instance Status:");
  console.log(await showInstancesFormatted());
}

async function cmdInfo() {
  const info = loadInstanceInfo();
  if (info) {
    log.info("\n📋 Thông tin kết nối:");
    log.ok(`  API URL:  ${info.apiUrl}`);
    log.ok(`  API Key:  ${info.token || "(SSH vào instance chạy: echo $OPEN_BUTTON_TOKEN)"}`);
    log.dim(`  Model:    ${info.model}`);
    log.dim(`  Instance: ${info.instanceId}`);
    log.dim(`  Created:  ${info.createdAt}`);
  } else {
    log.warn("ℹ️  Chưa có instance. Chạy: bun run deploy start");
  }
  console.log(await showInstancesFormatted());
}

async function cmdTest() {
  log.info("\n🧪 Test API...");

  let apiUrl: string;
  let token: string | undefined;

  const info = loadInstanceInfo();
  if (info) {
    apiUrl = info.apiUrl;
    token = info.token || undefined;
  } else {
    apiUrl = globalThis.prompt?.("Nhập API URL (http://IP:PORT/v1)") ?? "";
    token = globalThis.prompt?.("Nhập token (enter để skip)") || undefined;
  }

  // Test /v1/models
  log.warn("\n1️⃣  GET /v1/models");
  try {
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${apiUrl}/models`, { headers, signal: AbortSignal.timeout(10_000) });
    const data = (await res.json()) as { data?: { id: string }[] };
    const models = data.data?.map((m) => m.id).join(", ") ?? "?";
    log.ok(`  ✅ Models: ${models}`);
  } catch (e: unknown) {
    log.err(`  ❌ Lỗi: ${e instanceof Error ? e.message : String(e)}`);
    log.warn("  💡 Model có thể chưa load xong. Thử lại sau 2-3 phút.");
    return;
  }

  // Test chat completion
  log.warn("\n2️⃣  POST /v1/chat/completions");
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const body = {
      model: config.model,
      messages: [{ role: "user", content: "Say hello in Vietnamese, max 10 words." }],
      max_tokens: 50,
      temperature: 0.7,
    };

    const res = await fetch(`${apiUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    const reply = data.choices?.[0]?.message?.content ?? "?";
    log.ok(`  ✅ Response: ${reply}`);

    const usage = data.usage;
    if (usage) {
      log.dim(`  📊 Tokens: prompt=${usage.prompt_tokens}, completion=${usage.completion_tokens}`);
    }
  } catch (e: unknown) {
    log.err(`  ❌ Lỗi: ${e instanceof Error ? e.message : String(e)}`);
  }

  log.ok("\n✅ API test complete!");
}

// === Benchmark: test throughput & concurrency ===

interface BenchResult {
  latencyMs: number;
  tokens: number;
  tokPerSec: number;
  success: boolean;
  error?: string;
}

async function singleRequest(
  apiUrl: string, model: string, headers: Record<string, string>, prompt: string, maxTokens: number,
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
    if (data.error) return { latencyMs: elapsed, tokens: 0, tokPerSec: 0, success: false, error: data.error.message };
    const tokens = data.usage?.completion_tokens ?? 0;
    return { latencyMs: elapsed, tokens, tokPerSec: tokens / (elapsed / 1000), success: true };
  } catch (e: unknown) {
    return { latencyMs: Date.now() - start, tokens: 0, tokPerSec: 0, success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

async function cmdBenchmark() {
  log.info("\n📊 Benchmark — đo throughput & concurrency\n");

  const info = loadInstanceInfo();
  if (!info) { log.err("❌ Chưa deploy instance. Dùng: bun run deploy start"); return; }

  const apiUrl = info.apiUrl;
  const model = info.model ?? config.model;
  const headers: Record<string, string> = {};
  if (info.token) headers["Authorization"] = `Bearer ${info.token}`;

  // Phase 1: Single request baseline
  log.warn("1️⃣  Single request baseline...");
  const baseline = await singleRequest(apiUrl, model, headers, "Count from 1 to 20.", 100);
  if (!baseline.success) {
    log.err(`  ❌ API lỗi: ${baseline.error}`);
    log.warn("  💡 Đảm bảo model đã load xong: bun run deploy test");
    return;
  }
  log.ok(`  ✅ Latency: ${baseline.latencyMs}ms | ${baseline.tokens} tokens | ${baseline.tokPerSec.toFixed(1)} tok/s`);

  // Phase 2: Concurrent requests (1, 2, 4, 8, 16)
  log.warn("\n2️⃣  Concurrent requests...\n");

  const concurrencyLevels = [1, 2, 4, 8, 16];
  const prompt = "Write a short poem about programming in exactly 4 lines.";
  const maxTokens = 100;

  const rows: string[][] = [];

  for (const c of concurrencyLevels) {
    const promises: Promise<BenchResult>[] = [];
    for (let i = 0; i < c; i++) {
      promises.push(singleRequest(apiUrl, model, headers, prompt, maxTokens));
    }
    const results = await Promise.all(promises);
    const successes = results.filter(r => r.success);
    const failures = results.filter(r => !r.success);

    if (successes.length === 0) {
      log.warn(`  c=${c}: tất cả ${c} requests failed → dừng benchmark`);
      break;
    }

    const latencies = successes.map(r => r.latencyMs);
    const totalTokens = successes.reduce((sum, r) => sum + r.tokens, 0);
    const elapsed = Math.max(...latencies);
    const throughput = totalTokens / (elapsed / 1000);

    rows.push([
      String(c),
      `${successes.length}/${c}`,
      `${Math.round(percentile(latencies, 50))}ms`,
      `${Math.round(percentile(latencies, 95))}ms`,
      throughput.toFixed(1),
      (successes.reduce((s, r) => s + r.tokPerSec, 0) / successes.length).toFixed(1),
    ]);

    log.dim(`  c=${c}: p50=${Math.round(percentile(latencies, 50))}ms, throughput=${throughput.toFixed(1)} tok/s${failures.length ? `, ${failures.length} failed` : ""}`);

    // Stop if >50% failed
    if (failures.length > c / 2) {
      log.warn(`  ⚠️ >50% failed tại c=${c} → đây là giới hạn`);
      break;
    }
  }

  // Summary table
  log.info("\n📊 Kết quả:");
  console.log();
  table(
    ["Concurrent", "Success", "P50 Latency", "P95 Latency", "Throughput (tok/s)", "Avg tok/s/req"],
    rows,
  );

  // Phase 3: Capacity estimate
  log.info("\n💡 Ước tính khả năng chịu tải:");
  const baselineTokPerSec = baseline.tokPerSec;
  log.dim(`  • Single request: ${baselineTokPerSec.toFixed(1)} tok/s`);
  log.dim(`  • Claude Code (1 session): ~${Math.round(baselineTokPerSec)} tok/s — thoải mái ✅`);

  const estimatedMaxConcurrent = Math.max(1, Math.floor(baselineTokPerSec / 5));
  log.dim(`  • Ước tính max concurrent sessions: ~${estimatedMaxConcurrent} (≥5 tok/s mỗi session)`);

  if (estimatedMaxConcurrent <= 2) {
    log.warn("  → Chỉ nên dùng 1-2 Claude Code sessions");
  } else if (estimatedMaxConcurrent <= 5) {
    log.ok(`  → Thoải mái 2-3 sessions, max ~${estimatedMaxConcurrent}`);
  } else {
    log.ok(`  → Có thể chạy ${Math.min(estimatedMaxConcurrent, 10)}+ sessions đồng thời`);
  }

  log.ok("\n✅ Benchmark complete!");
}

async function cmdSsh() {
  const info = loadInstanceInfo();
  if (info?.ip && info.sshPort) {
    log.info("🔗 SSH vào instance...");
    await sshConnect(info.ip, info.sshPort);
  } else {
    log.warn("💡 Dùng Vast.ai web UI → instance → SSH button");
    log.dim("   Hoặc: ssh -p <PORT> root@<IP>");
    console.log(await showInstancesFormatted());
  }
}

async function cmdConfigClaude() {
  const home = process.env["USERPROFILE"] ?? process.env["HOME"] ?? "";
  const settingsPath = `${home}/.claude/settings.json`;
  const backupPath = `${home}/.claude/settings.json.vllm-backup`;

  // --restore flag: khôi phục backup
  if (args.extra.includes("--restore")) {
    return restoreClaudeSettings(settingsPath, backupPath);
  }

  // --off flag: tắt vLLM, dùng lại Anthropic API gốc
  if (args.extra.includes("--off")) {
    return disableVllmInClaude(settingsPath);
  }

  // Get instance info
  const info = loadInstanceInfo();
  if (!info) {
    log.err("❌ Chưa có instance. Chạy: bun run deploy start");
    log.dim("   Hoặc dùng --restore để khôi phục settings cũ");
    return;
  }

  // Read current settings
  let settings: Record<string, unknown> = {};
  try {
    const raw = await Bun.file(settingsPath).text();
    settings = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    log.warn("⚠️  Không tìm thấy settings.json, tạo mới");
  }

  // Backup trước khi sửa (chỉ backup lần đầu)
  const backupExists = await Bun.file(backupPath).exists();
  if (!backupExists) {
    await Bun.write(backupPath, JSON.stringify(settings, null, 2));
    log.ok(`💾 Backup: ${backupPath}`);
  }

  // Update env vars
  if (!settings["env"]) settings["env"] = {};
  const apiBase = info.apiUrl.replace(/\/v1\/?$/, "");
  const envObj = settings["env"] as Record<string, string>;

  envObj["ANTHROPIC_BASE_URL"] = apiBase;
  envObj["ANTHROPIC_API_KEY"] = info.token || "not-needed";

  // Ghi file
  await Bun.write(settingsPath, JSON.stringify(settings, null, 2));

  log.ok("\n✅ Claude Code settings đã cập nhật!");
  log.info(`   ANTHROPIC_BASE_URL = ${apiBase}`);
  log.info(`   ANTHROPIC_API_KEY  = ${info.token ? "***" + info.token.slice(-4) : "not-needed"}`);
  log.warn("\n⚡ Restart Claude Code để áp dụng.");
  log.dim(`   Khôi phục: bun run deploy config-claude --restore`);
  log.dim(`   Tắt vLLM:  bun run deploy config-claude --off`);
}

async function restoreClaudeSettings(settingsPath: string, backupPath: string) {
  try {
    const raw = await Bun.file(backupPath).text();
    await Bun.write(settingsPath, raw);
    log.ok("✅ Đã khôi phục settings từ backup!");
    log.warn("⚡ Restart Claude Code để áp dụng.");
  } catch {
    log.err("❌ Không tìm thấy backup. Không có gì để khôi phục.");
  }
}

async function disableVllmInClaude(settingsPath: string) {
  try {
    const raw = await Bun.file(settingsPath).text();
    const settings = JSON.parse(raw) as Record<string, unknown>;
    const envObj = settings["env"] as Record<string, unknown> | undefined;
    if (envObj) {
      delete envObj["ANTHROPIC_BASE_URL"];
      delete envObj["ANTHROPIC_API_KEY"];
    }
    await Bun.write(settingsPath, JSON.stringify(settings, null, 2));
    log.ok("✅ Đã tắt vLLM proxy — Claude Code sẽ dùng API gốc.");
    log.warn("⚡ Restart Claude Code để áp dụng.");
  } catch {
    log.err("❌ Không đọc được settings.json");
  }
}

async function cmdLogs() {
  const info = loadInstanceInfo();
  if (info) {
    log.info(`📜 Logs cho instance ${info.instanceId}:`);
    console.log(await getLogs(info.instanceId));
  } else {
    log.err("❌ Chưa có instance info. Chạy: bun run deploy start");
  }
}

function cmdHelp() {
  console.log(`
  \x1b[1m\x1b[36mvLLM Deploy — Quản lý vLLM trên Vast.ai\x1b[0m
  ════════════════════════════════════════

  \x1b[33mUSAGE:\x1b[0m
    bun run deploy <action> [flags]

  \x1b[33mACTIONS:\x1b[0m
    start           Tìm GPU rẻ nhất → deploy instance
    stop            Destroy instance + kill watchdog
    status          Xem instances đang chạy
    info            Hiện thông tin kết nối
    test            Test API endpoint
    benchmark       📊 Đo throughput & concurrent capacity (alias: bench)
    dashboard       📊 TUI real-time dashboard (alias: dash)
    ssh             SSH vào instance
    config-claude   Cập nhật Claude Code settings → vLLM
      --restore     Khôi phục settings gốc từ backup
      --off         Tắt vLLM, dùng lại Anthropic API
    logs            Xem logs instance
    search          Tìm GPU available (không deploy)
    watch           Gắn watchdog auto-shutdown vào instance
    help            Hiện help này

  \x1b[33mFLAGS:\x1b[0m
    --cheap         💰 Giá thuê/hr thấp nhất
    --fast          ⚡ Tok/s cao nhất
    --best          ⭐ $/1K tokens thấp nhất (default)
    --gpu <name>    🎯 Lock GPU cụ thể             [VLLM_GPU]
    --max-price <n> 💵 Max giá/hr                   [VLLM_MAX_PRICE]
    --spot          💸 Dùng interruptible            [VLLM_SPOT=1]
    --auto-recover  🔄 Tự thuê lại khi spot bị ngắt  [VLLM_AUTO_RECOVER=1]
    --model <name>  🔄 Đổi model                    [VLLM_MODEL]
    --context <n>   📏 Context length                [VLLM_CONTEXT]
    --region <geo>  🌍 Ưu tiên vùng                  [VLLM_REGION]
    --auto / -y     🤖 Tự chọn, không hỏi            [VLLM_AUTO=1]
    --dry-run       🔍 Chỉ search, không deploy
    --hours <n>     ⏰ Tự tắt sau N giờ              [VLLM_HOURS]
    --budget <n>    💵 Tự tắt khi chi $N             [VLLM_BUDGET]
    --service       🔧 Chạy watchdog nền (background) [VLLM_SERVICE=1]

  \x1b[33mENV VARS:\x1b[0m  (ưu tiên: flag > env var > .env file)
    \x1b[90mVLLM_MODEL, VLLM_GPU, VLLM_MAX_PRICE, VLLM_SPOT,\x1b[0m
    \x1b[90mVLLM_HOURS, VLLM_BUDGET, VLLM_CONTEXT, VLLM_REGION,\x1b[0m
    \x1b[90mVLLM_AUTO, VLLM_SERVICE, VLLM_STRATEGY, VLLM_AUTO_RECOVER\x1b[0m

  \x1b[33mEXAMPLES:\x1b[0m
    \x1b[90mbun run start --hours 2 -y              # 2h rồi tự tắt\x1b[0m
    \x1b[90mbun run start --budget 1 --service -y   # Background, tắt khi chi $1\x1b[0m
    \x1b[90mbun run deploy dashboard                # TUI monitoring\x1b[0m
    \x1b[90mbun run start --cheap --spot -y          # Siêu tiết kiệm\x1b[0m
    \x1b[90mbun run start --spot --auto-recover -y   # Spot + tự phục hồi\x1b[0m
    \x1b[90mVLLM_HOURS=2 VLLM_AUTO=1 bun run start  # Dùng env vars\x1b[0m
    \x1b[90mbun run deploy watch --hours 1 --service # Background watchdog\x1b[0m
    \x1b[90mbun run deploy benchmark                # Đo throughput & concurrency\x1b[0m
    \x1b[90mbun run deploy stop                      # Tắt tất cả\x1b[0m

  \x1b[32mCHI PHÍ: ~$0.20-0.50/hr | ~$11-35/tháng (2h/ngày)\x1b[0m
`);
}

// === Watch command: attach watchdog to running instance ===
async function cmdWatch() {
  if (!args.hours && !args.budget) {
    log.err("❌ Cần --hours <n> và/hoặc --budget <n>");
    log.dim("   Ví dụ: bun run deploy watch --hours 2 --budget 1");
    return;
  }

  const info = loadInstanceInfo();
  if (!info) {
    log.err("❌ Chưa có instance. Chạy: bun run deploy start");
    return;
  }

  const dph = info.dphTotal ?? 0;
  if (dph <= 0) {
    log.err("❌ Không biết giá/hr. Chạy lại start với version mới.");
    return;
  }

  if (args.service) {
    startServiceMode(info.instanceId, dph);
  } else {
    log.info(`\n👀 Watch instance ${info.instanceId} @ ${formatPrice(dph)}/hr`);
    await startWatchdog(info.instanceId, dph);
  }
}

// === Dashboard command: TUI monitoring ===
async function cmdDashboard() {
  const { startDashboard } = await import("./dashboard");
  await startDashboard({
    hours: args.hours,
    budget: args.budget,
    service: args.service,
    args,
  });
}

// === Router ===
const commands: Record<string, () => Promise<void> | void> = {
  start: cmdStart,
  stop: cmdStop,
  status: cmdStatus,
  info: cmdInfo,
  test: cmdTest,
  benchmark: cmdBenchmark,
  bench: cmdBenchmark,
  ssh: cmdSsh,
  "config-claude": cmdConfigClaude,
  logs: cmdLogs,
  search: cmdSearch,
  watch: cmdWatch,
  dashboard: cmdDashboard,
  dash: cmdDashboard,
  help: cmdHelp,
};

const cmd = commands[action];
if (cmd) {
  await cmd();
} else {
  log.err(`❌ Unknown action: ${action}`);
  cmdHelp();
}
