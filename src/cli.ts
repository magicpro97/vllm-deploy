import { loadConfig, saveInstanceInfo, loadInstanceInfo, removeInstanceInfo } from "./config";
import { searchOffers, createInstance, showInstances, showInstancesFormatted, destroyInstance, getLogs, sshConnect, type VastInstance } from "./vastai";
import { log, sleep, formatPrice, table } from "./ui";

const config = loadConfig();
const action = Bun.argv[2] ?? "help";

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
  log.info("\n🔍 Tìm GPU phù hợp...");
  log.dim(`  GPU: ${config.gpuPrefer} | VRAM: >=${config.gpuMinVram}GB | Max: ${formatPrice(config.gpuMaxPrice)}/hr\n`);

  const offers = await searchOffers({
    type: config.instanceType,
    gpuName: config.gpuPrefer,
    minVram: config.gpuMinVram,
    minDisk: config.diskSize,
    limit: 10,
  });

  if (offers.length === 0) {
    log.err("❌ Không tìm thấy GPU phù hợp.");
    return;
  }

  table(
    ["#", "ID", "GPU", "VRAM", "Price/hr", "Upload", "Reliability"],
    offers.map((o, i) => [
      String(i + 1),
      String(o.id),
      o.gpu_name,
      `${o.gpu_ram}GB`,
      formatPrice(o.dph_total),
      `${Math.round(o.inet_up)}Mbps`,
      `${(o.reliability * 100).toFixed(0)}%`,
    ])
  );
}

async function cmdStart() {
  log.info("\n🚀 Deploy vLLM trên Vast.ai");
  log.dim(`  Model: ${config.model}`);
  log.dim(`  GPU:   ${config.gpuPrefer} (>= ${config.gpuMinVram}GB VRAM)`);
  log.dim(`  Args:  ${config.vllmArgs}\n`);

  // Search
  log.warn("🔍 Tìm GPU rẻ nhất...");
  const offers = await searchOffers({
    type: config.instanceType,
    gpuName: config.gpuPrefer,
    minVram: config.gpuMinVram,
    minDisk: config.diskSize,
    limit: 5,
  });

  if (offers.length === 0) {
    log.err("❌ Không tìm thấy GPU. Thử đổi GPU_PREFER trong .env");
    process.exit(1);
  }

  // Show offers
  log.ok("\nTop offers:");
  table(
    ["#", "ID", "GPU", "VRAM", "Price/hr", "Upload"],
    offers.map((o, i) => [
      String(i + 1),
      String(o.id),
      o.gpu_name,
      `${o.gpu_ram}GB`,
      formatPrice(o.dph_total),
      `${Math.round(o.inet_up)}Mbps`,
    ])
  );

  const selected = offers[0];
  log.ok(`\n✅ Chọn rẻ nhất: ID=${selected.id} @ ${formatPrice(selected.dph_total)}/hr`);

  const confirm = globalThis.prompt?.("Tiếp tục? (Y/n)") ?? "y";
  if (confirm.toLowerCase() === "n") {
    const choice = globalThis.prompt?.("Nhập số [1-5] hoặc Offer ID") ?? "1";
    const idx = Number(choice);
    const offer = idx >= 1 && idx <= offers.length ? offers[idx - 1] : selected;
    return doCreate(offer.id);
  }

  await doCreate(selected.id);
}

async function doCreate(offerId: number) {
  log.warn("\n📦 Tạo instance...");

  const env: Record<string, string> = {
    VLLM_MODEL: config.model,
    VLLM_ARGS: config.vllmArgs,
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
  const info = loadInstanceInfo();
  let apiUrl: string;
  let token: string;

  if (info) {
    apiUrl = info.apiUrl;
    token = info.token || "";
  } else {
    apiUrl = globalThis.prompt?.("Nhập API URL (http://IP:PORT/v1)") ?? "";
    token = globalThis.prompt?.("Nhập API token") ?? "";
  }

  const claudeConfig = {
    apiProvider: "openai-compatible",
    apiBaseUrl: apiUrl,
    apiKey: token || "not-needed",
    model: config.model,
  };

  log.info("\n📋 Claude Code Config:");
  log.ok(JSON.stringify(claudeConfig, null, 2));
  log.warn("\n💡 Thêm config này vào Claude Code settings.");
  log.dim(`   Hoặc set env:`);
  log.dim(`   export OPENAI_API_BASE="${apiUrl}"`);
  log.dim(`   export OPENAI_API_KEY="${token}"`);
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
    bun run deploy <action>

  ${"\x1b[33m"}ACTIONS:${"\x1b[0m"}
    start           Tìm GPU rẻ nhất → deploy instance
    stop            Destroy instance → ngừng tính tiền
    status          Xem instances đang chạy
    info            Hiện thông tin kết nối (IP, port, token)
    test            Test API endpoint
    ssh             SSH vào instance
    config-claude   Tạo config cho Claude Code
    logs            Xem logs instance
    search          Tìm GPU available
    help            Hiện help này

  ${"\x1b[33m"}SETUP:${"\x1b[0m"}
    ${"\x1b[90m"}1. cp .env.example .env${"\x1b[0m"}
    ${"\x1b[90m"}2. Điền VASTAI_API_KEY vào .env${"\x1b[0m"}
    ${"\x1b[90m"}3. bun run deploy start${"\x1b[0m"}

  ${"\x1b[32m"}CHI PHÍ: ~$0.30-0.50/hr RTX 4090 | ~$18/tháng (2h/ngày)${"\x1b[0m"}
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
