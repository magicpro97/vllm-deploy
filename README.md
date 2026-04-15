# 🚀 vLLM Deploy — Self-host LLM on Vast.ai

> CLI tool để deploy **vLLM** trên [Vast.ai](https://cloud.vast.ai) — tìm GPU rẻ nhất, deploy 1 lệnh, monitor real-time.  
> OpenAI-compatible API, dùng được với Claude Code, Cursor, Continue, hoặc bất kỳ client nào.

## ✨ Features

- 🔍 **Smart GPU search** — tự tìm GPU rẻ nhất trên marketplace (`--cheap`, `--fast`, `--best`)
- 🚀 **1-command deploy** — start, stop, status, SSH, logs
- 📊 **TUI Dashboard** — real-time monitoring CPU/GPU/RAM/Network/Tokens/Latency (virtual scroll logs)
- 📈 **Auto-benchmark** — tự đo throughput & concurrency sau deploy, hiện trên dashboard
- 💰 **Cost control** — auto-shutdown với `--hours` và `--budget`
- 🔄 **Service mode** — watchdog tự restart khi instance die
- 🎯 **Spot instance** — tiết kiệm ~50-65% với `--spot`, auto-recover khi bị gián đoạn
- ⚡ **Prefix caching** — giảm ~50-70% KV cache cho repeated context
- 🛡️ **Strict TypeScript + ESLint** — zero errors, zero warnings, production-ready

## Tại sao?

| So sánh | Chi phí | Model | Giới hạn |
|---------|---------|-------|----------|
| **Vast.ai spot (repo này)** | ~$0.15/hr spot | Bất kỳ HF model | Không giới hạn |
| **Vast.ai on-demand** | ~$0.30/hr | Bất kỳ HF model | Không giới hạn |
| OpenAI GPT-4o | $5-20/1M tokens | GPT-4o | Rate limit |
| Claude Pro | $20/mo | Claude 3.5/Opus | Usage cap |
| OpenRouter Gemma 4 | $0.14/$0.40 per 1M | Gemma 4 31B (base) | Rate limit |

## Quick Start

### 1. Cài đặt

```bash
git clone https://github.com/magicpro97/vllm-deploy.git && cd vllm-deploy
bun install

# Cài Vast.ai CLI
pip install vastai
vastai set api-key YOUR_API_KEY
```

### 2. Deploy

```bash
# Tìm GPU rẻ nhất + deploy (tự chạy benchmark sau khi ready)
bun run deploy start

# Hoặc với options
bun run deploy start --cheap          # GPU rẻ nhất
bun run deploy start --fast           # GPU nhanh nhất
bun run deploy start --gpu RTX4090    # Chọn GPU cụ thể
bun run deploy start --model Qwen/Qwen3-32B  # Đổi model
bun run deploy start --spot           # Spot instance (rẻ hơn ~50-65%)
bun run deploy start --spot --auto-recover  # Spot + tự phục hồi khi bị gián đoạn
bun run deploy start --hours 2        # Tự tắt sau 2h
bun run deploy start --budget 1.00    # Tự tắt khi đạt $1 (auto spot nếu ≤$5)
```

### 3. Monitor

```bash
# TUI Dashboard real-time
bun run deploy dashboard

# Benchmark throughput & concurrency
bun run deploy benchmark

# Hoặc quick check
bun run deploy status
bun run deploy info
```

### 4. Dùng

```bash
# Test API endpoint
bun run deploy test

# SSH vào instance
bun run deploy ssh

# Xem logs
bun run deploy logs
```

### 5. Tắt (ngừng tính tiền)

```bash
bun run deploy stop
```

## Cấu hình Claude Code

```bash
# Auto-config Claude Code settings
bun run deploy config-claude
```

Hoặc manual — thêm vào `~/.claude/settings.json`:

```json
{
  "apiProvider": "openai-compatible",
  "apiBaseUrl": "http://<IP>:<PORT>/v1",
  "apiKey": "<TOKEN>",
  "model": "charaf/gemma4-31b-claude-opus-abliterated"
}
```

## Spot Instance (Tiết kiệm ~50-65%)

```bash
# Spot instance — rẻ hơn đáng kể
bun run deploy start --spot

# Spot + auto-recover (tự tìm GPU mới khi bị gián đoạn)
bun run deploy start --spot --auto-recover

# Budget nhỏ (≤$5) tự chuyển sang spot
bun run deploy start --budget 2.00
```

> 💡 `--auto-recover` tự tìm GPU mới khi spot bị preempt, tối đa 10 lần recovery. Dashboard hiển thị trạng thái spot real-time.

## Service Mode (Background)

```bash
# Chạy watchdog — tự restart khi instance die
bun run deploy start --service

# Spot + watchdog + auto-recover = combo tiết kiệm nhất
bun run deploy start --service --spot --auto-recover

# Xem trạng thái watchdog
bun run deploy watch
```

## Đổi Model

Mặc định dùng `charaf/gemma4-31b-claude-opus-abliterated`. Đổi bằng `--model`:

```bash
# Dùng model khác từ HuggingFace
bun run deploy start --model Qwen/Qwen3-32B
bun run deploy start --model google/gemma-4-12b-it
bun run deploy start --model meta-llama/Llama-3.1-8B-Instruct
bun run deploy start --model deepseek-ai/DeepSeek-R1-Distill-Qwen-32B

# Kết hợp với context length
bun run deploy start --model google/gemma-4-12b-it --context 16384
```

Hoặc set trong `.env`:
```bash
VLLM_MODEL=Qwen/Qwen3-32B
```

## Chi phí ước tính

| Sử dụng | GPU | On-demand | Spot (~50-65% rẻ hơn) |
|---------|-----|-----------|----------------------|
| 2h/ngày (tiết kiệm) | RTX 3090 | **~$11** | **~$5-6** |
| 2h/ngày | RTX 4090 | **~$18** | **~$8-10** |
| 4h/ngày | RTX 4090 | **~$35** | **~$16-20** |
| 8h/ngày | RTX 4090 | **~$70** | **~$32-40** |

> 💡 + $0.60/tháng storage để cache model (skip download mỗi lần boot)

## Tài liệu

- 📖 [Hướng dẫn chi tiết](docs/huong-dan-chi-tiet.md)
- 📊 [Dashboard](docs/dashboard.md)
- 💰 [Tối ưu chi phí](docs/toi-uu-chi-phi.md)
- 🔧 [Troubleshooting](docs/troubleshooting.md)
- 🖥️ [So sánh GPU](docs/so-sanh-gpu.md)

## Tech Stack

- **Runtime:** [Bun](https://bun.sh)
- **Language:** TypeScript (strict mode)
- **TUI:** blessed + blessed-contrib
- **Linting:** ESLint + typescript-eslint (strictTypeChecked)
- **vLLM defaults:** 32K context, prefix caching, 95% GPU utilization

## Yêu cầu

- [Bun](https://bun.sh) 1.0+
- Tài khoản [Vast.ai](https://cloud.vast.ai) (nạp tối thiểu $10)
- Python 3.8+ (cho `vastai` CLI)

## License

MIT
