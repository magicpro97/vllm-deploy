# Hướng dẫn chi tiết

## Cài đặt

### 1. Yêu cầu
- [Bun](https://bun.sh) >= 1.0
- Tài khoản [Vast.ai](https://cloud.vast.ai)
- `vastai` CLI: `pip install vastai`

### 2. Setup

```bash
git clone https://github.com/magicpro97/vllm-deploy.git
cd vllm-deploy
bun install
cp .env.example .env
```

Mở `.env`, điền `VASTAI_API_KEY`:
```bash
# Lấy API key từ: https://cloud.vast.ai/account/
VASTAI_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxx
```

Set API key cho CLI:
```bash
vastai set api-key YOUR_API_KEY
```

### 3. Verify
```bash
bun run deploy help      # Xem commands
bun run deploy search    # Test tìm GPU
```

---

## Sử dụng hàng ngày

### Bắt đầu làm việc

```bash
# 1. Deploy (tự tìm GPU rẻ nhất + auto-benchmark)
bun run deploy start

# Hoặc với options
bun run deploy start --cheap           # GPU rẻ nhất
bun run deploy start --fast            # GPU nhanh nhất
bun run deploy start --gpu RTX4090     # Chọn GPU cụ thể
bun run deploy start --spot            # Spot instance (rẻ ~50-65%)
bun run deploy start --spot --auto-recover  # Spot + tự phục hồi
bun run deploy start --hours 2         # Tự tắt sau 2h
bun run deploy start --budget 1.00     # Tự tắt khi đạt $1 (auto spot nếu ≤$5)

# 2. Đợi deploy + auto-benchmark (~5-15 phút)
#    CLI tự chạy benchmark khi model ready

# 3. Xem dashboard real-time
bun run deploy dashboard
```

### Monitor

```bash
# TUI Dashboard — GPU/CPU/RAM/Network/Tokens/Latency/Benchmark
bun run deploy dashboard

# Benchmark throughput & concurrency (đầy đủ)
bun run deploy benchmark

# Quick status check
bun run deploy status

# Thông tin kết nối
bun run deploy info
```

### Service Mode (Watchdog)

```bash
# Chạy background — tự restart khi instance die
bun run deploy start --service

# Spot + watchdog + auto-recover = combo tiết kiệm nhất
bun run deploy start --service --spot --auto-recover

# Check watchdog status
bun run deploy watch
```

### Kết thúc

```bash
# Destroy instance → NGỪNG TÍNH TIỀN
bun run deploy stop
```

### Commands tham khảo

| Command | Mô tả |
|---------|--------|
| `bun run deploy start` | Deploy instance mới |
| `bun run deploy stop` | Destroy instance |
| `bun run deploy status` | Xem instances đang chạy |
| `bun run deploy info` | Thông tin kết nối |
| `bun run deploy test` | Test API endpoint |
| `bun run deploy benchmark` | Đo throughput & concurrency |
| `bun run deploy search` | Tìm GPU available |
| `bun run deploy ssh` | SSH vào instance |
| `bun run deploy logs` | Xem logs |
| `bun run deploy dashboard` | TUI monitoring dashboard |
| `bun run deploy config-claude` | Tạo config Claude Code |

### CLI Flags

| Flag | Mô tả | Default |
|------|--------|---------|
| `--cheap` | Tìm GPU rẻ nhất | ✅ |
| `--fast` | Tìm GPU nhanh nhất | |
| `--best` | GPU tốt nhất (quality) | |
| `--gpu <name>` | Chọn GPU cụ thể (RTX4090, A100...) | |
| `--spot` | Dùng spot/interruptible instance (rẻ ~50-65%) | |
| `--auto-recover` | Tự phục hồi khi spot bị gián đoạn | |
| `--hours <n>` | Auto-shutdown sau n giờ (tính uptime thực tế) | |
| `--budget <n>` | Auto-shutdown khi đạt $n (tích lũy qua recovery) | |
| `--service` | Chạy watchdog background mode | |
| `--dry-run` | Chỉ tìm GPU, không deploy | |
| `--auto` | Skip confirmation, deploy ngay | |

---

## Kết nối Claude Code

### Cách 1: Auto config
```bash
bun run config-claude
```

### Cách 2: Manual

Lấy thông tin từ `bun run info`, thêm vào Claude Code settings:

```json
{
  "apiProvider": "openai-compatible",
  "apiBaseUrl": "http://<IP>:<PORT>/v1",
  "apiKey": "<OPEN_BUTTON_TOKEN>",
  "model": "charaf/gemma4-31b-claude-opus-abliterated"
}
```

### Lấy OPEN_BUTTON_TOKEN

```bash
bun run ssh
# Trong instance:
echo $OPEN_BUTTON_TOKEN
```

---

## Kết nối từ code

### Python
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://<IP>:<PORT>/v1",
    api_key="<TOKEN>"
)

response = client.chat.completions.create(
    model="charaf/gemma4-31b-claude-opus-abliterated",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

### TypeScript/JavaScript
```typescript
const res = await fetch("http://<IP>:<PORT>/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer <TOKEN>"
  },
  body: JSON.stringify({
    model: "charaf/gemma4-31b-claude-opus-abliterated",
    messages: [{ role: "user", content: "Hello!" }]
  })
});
const data = await res.json();
```

### cURL
```bash
curl -X POST http://<IP>:<PORT>/v1/chat/completions \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"model":"charaf/gemma4-31b-claude-opus-abliterated","messages":[{"role":"user","content":"Hello!"}]}'
```

---

## Vast.ai Web UI

Ngoài CLI, bạn có thể dùng web UI tại https://cloud.vast.ai:

- **Instance Portal** (port 1111): Dashboard quản lý services
- **Model UI** (port 7860): Web chat interface để test nhanh
- **Jupyter** (port 8080): Notebook environment
- **Ray Dashboard** (port 8265): Monitor GPU/workload

---

## Đổi model

### Cách 1: CLI flag (ưu tiên)
```bash
bun run deploy start --model google/gemma-4-12b-it
bun run deploy start --model Qwen/Qwen3-32B
bun run deploy start --model meta-llama/Llama-3.1-8B-Instruct
bun run deploy start --model deepseek-ai/DeepSeek-R1-Distill-Qwen-32B

# Kết hợp context length
bun run deploy start --model google/gemma-4-12b-it --context 16384
```

### Cách 2: Env var
```bash
VLLM_MODEL=Qwen/Qwen3-32B bun run deploy start
```

### Cách 3: File .env
```bash
VLLM_MODEL=google/gemma-4-12b-it
VLLM_ARGS=--max-model-len 16384 --gpu-memory-utilization 0.95 --enable-prefix-caching
```

> 💡 Ưu tiên: `--model` flag > env var `VLLM_MODEL` > `.env` file > default
