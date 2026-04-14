import { loadConfig, saveInstanceInfo, loadInstanceInfo, removeInstanceInfo } from "./config";
import {
  searchOffers, searchBestOffers, searchWithSavings,
  createInstance, showInstances, showInstancesFormatted,
  destroyInstance, getLogs, sshConnect,
  type VastInstance, type ScoredOffer,
} from "./vastai";
import { log, sleep, formatPrice, table } from "./ui";
import { parseArgs, describeStrategy, type CliArgs } from "./args";

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
      const saving = ((1 - interruptible[0].dph_total / onDemand[0].dph_total) * 100).toFixed(0);
      log.info(`\n💡 Spot rẻ hơn ~${saving}%`);
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
  log.ok(`\n🏆 Best: ${best.gpu_name} @ ${formatPrice(best.dph_total)}/hr | ~${best.estTokPerSec} tok/s | $${best.costPer1kTok.toFixed(4)}/1Ktok`);
  log.dim(`   ${best.tier} | ${(best.reliability * 100).toFixed(0)}% reliable | ${Math.round(best.inet_up)}Mbps`);

  if (args.dryRun) {
    log.warn("\n⏹️  --dry-run: không deploy.");
    return;
  }

  let selected = best;

  if (!args.auto) {
    const confirm = globalThis.prompt?.("Deploy? (Y/n/số 1-8)") ?? "y";
    if (confirm.toLowerCase() === "n") process.exit(0);
    const idx = Number(confirm);
    if (idx >= 1 && idx <= offers.length) {
      selected = offers[idx - 1];
      log.info(`  → Chọn #${idx}: ${selected.gpu_name} @ ${formatPrice(selected.dph_total)}/hr`);
    }
  } else {
    log.info("  → --auto: tự chọn rẻ nhất");
  }

  await doCreate(selected.id, model, vllmArgs);
}

async function doCreate(offerId: number, model?: string, vllmArgs?: string) {
  log.warn("\n📦 Tạo instance...");

  const useModel = model ?? config.model;
  const useArgs = vllmArgs ?? config.vllmArgs;

  const env: Record<string, string> = {
    VLLM_MODEL: useModel,
    VLLM_ARGS: useArgs,
    AUTO_PARALLEL: "true",
  };
  if (config.hfToken) env.HUGGING_FACE_HUB_TOKEN = config.hfToken;

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
    });
  }
}

async function cmdStop() {
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
    const id = instances[0].id;
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
    const data = (await res.json()) as any;
    const models = data.data?.map((m: any) => m.id).join(", ") ?? "?";
    log.ok(`  ✅ Models: ${models}`);
  } catch (e: any) {
    log.err(`  ❌ Lỗi: ${e.message}`);
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

    const data = (await res.json()) as any;
    const reply = data.choices?.[0]?.message?.content ?? "?";
    log.ok(`  ✅ Response: ${reply}`);

    const usage = data.usage;
    if (usage) {
      log.dim(`  📊 Tokens: prompt=${usage.prompt_tokens}, completion=${usage.completion_tokens}`);
    }
  } catch (e: any) {
    log.err(`  ❌ Lỗi: ${e.message}`);
  }

  log.ok("\n✅ API test complete!");
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
  const home = process.env.USERPROFILE || process.env.HOME || "";
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
  let settings: Record<string, any> = {};
  try {
    const raw = await Bun.file(settingsPath).text();
    settings = JSON.parse(raw);
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
  if (!settings.env) settings.env = {};
  const apiBase = info.apiUrl.replace(/\/v1\/?$/, ""); // Claude cần base URL không có /v1

  settings.env.ANTHROPIC_BASE_URL = apiBase;
  settings.env.ANTHROPIC_API_KEY = info.token || "not-needed";

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
    const settings = JSON.parse(raw);
    if (settings.env) {
      delete settings.env.ANTHROPIC_BASE_URL;
      delete settings.env.ANTHROPIC_API_KEY;
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
  ${"\x1b[1m\x1b[36m"}vLLM Deploy — Quản lý vLLM trên Vast.ai${"\x1b[0m"}
  ════════════════════════════════════════

  ${"\x1b[33m"}USAGE:${"\x1b[0m"}
    bun run deploy <action> [flags]

  ${"\x1b[33m"}ACTIONS:${"\x1b[0m"}
    start           Tìm GPU rẻ nhất → deploy instance
    stop            Destroy instance → ngừng tính tiền
    status          Xem instances đang chạy
    info            Hiện thông tin kết nối
    test            Test API endpoint
    ssh             SSH vào instance
    config-claude   Cập nhật Claude Code settings → vLLM
      --restore     Khôi phục settings gốc từ backup
      --off         Tắt vLLM, dùng lại Anthropic API
    logs            Xem logs instance
    search          Tìm GPU available (không deploy)
    help            Hiện help này

  ${"\x1b[33m"}FLAGS (cho start/search):${"\x1b[0m"}
    --cheap         💰 Giá thuê/hr thấp nhất (có thể chậm)
    --fast          ⚡ Tok/s cao nhất (có thể đắt)
    --best          ⭐ $/1K tokens thấp nhất (default, cân bằng)
    --gpu <name>    🎯 Lock GPU cụ thể (e.g. "RTX 4090")
    --max-price <n> 💵 Max giá/hr (e.g. 0.80)
    --spot          💸 Dùng interruptible (rẻ hơn ~30%)
    --model <name>  🔄 Đổi model (override .env)
    --context <n>   📏 Context length (e.g. 4096, 16384)
    --region <geo>  🌍 Ưu tiên vùng (US, EU, Asia)
    --auto / -y     🤖 Tự chọn rẻ nhất, không hỏi
    --dry-run       🔍 Chỉ search, không deploy

  ${"\x1b[33m"}EXAMPLES:${"\x1b[0m"}
    ${"\x1b[90m"}bun run start                        # Smart search, chọn best deal${"\x1b[0m"}
    ${"\x1b[90m"}bun run start --cheap                 # Rẻ nhất $/hr${"\x1b[0m"}
    ${"\x1b[90m"}bun run start --fast --gpu "A100"      # A100 nhanh nhất${"\x1b[0m"}
    ${"\x1b[90m"}bun run start --spot -y                # Spot rẻ, auto deploy${"\x1b[0m"}
    ${"\x1b[90m"}bun run start --max-price 0.30 -y      # Max $0.30/hr, auto${"\x1b[0m"}
    ${"\x1b[90m"}bun run start --model google/gemma-4-12b-it --context 16384${"\x1b[0m"}
    ${"\x1b[90m"}bun run search --spot                  # So sánh on-demand vs spot${"\x1b[0m"}
    ${"\x1b[90m"}bun run start --cheap --spot -y         # Siêu tiết kiệm, full auto${"\x1b[0m"}

  ${"\x1b[32m"}CHI PHÍ: ~$0.20-0.50/hr | ~$11-35/tháng (2h/ngày)${"\x1b[0m"}
`);
}

// === Router ===
const commands: Record<string, () => Promise<void> | void> = {
  start: cmdStart,
  stop: cmdStop,
  status: cmdStatus,
  info: cmdInfo,
  test: cmdTest,
  ssh: cmdSsh,
  "config-claude": cmdConfigClaude,
  logs: cmdLogs,
  search: cmdSearch,
  help: cmdHelp,
};

const cmd = commands[action];
if (cmd) {
  await cmd();
} else {
  log.err(`❌ Unknown action: ${action}`);
  cmdHelp();
}
