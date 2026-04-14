# Hướng dẫn chi tiết

## Cài đặt

### 1. Yêu cầu
- [Bun](https://bun.sh) >= 1.0
- Tài khoản [Vast.ai](https://cloud.vast.ai)
- `vastai` CLI: `pip install vastai`

### 2. Setup

```bash
git clone <repo-url>
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
# 1. Deploy (tự tìm GPU rẻ nhất)
bun run start

# 2. Đợi ~5-15 phút (boot + load model)

# 3. Check API ready
bun run test:api

# 4. Lấy thông tin kết nối
bun run info
```

### Kết thúc

```bash
# Destroy instance → NGỪNG TÍNH TIỀN
bun run stop
```

### Commands tham khảo

| Command | Mô tả |
|---------|--------|
| `bun run start` | Deploy instance mới |
| `bun run stop` | Destroy instance |
| `bun run status` | Xem instances đang chạy |
| `bun run info` | Thông tin kết nối |
| `bun run test:api` | Test API endpoint |
| `bun run search` | Tìm GPU available |
| `bun run ssh` | SSH vào instance |
| `bun run logs` | Xem logs |
| `bun run config-claude` | Tạo config Claude Code |

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

Sửa `.env`:
```bash
VLLM_MODEL=google/gemma-4-12b-it
VLLM_ARGS=--max-model-len 16384 --gpu-memory-utilization 0.9
```

Hoặc dùng bất kỳ model nào từ HuggingFace:
```bash
VLLM_MODEL=meta-llama/Llama-3.1-8B-Instruct
VLLM_MODEL=Qwen/Qwen3-32B
VLLM_MODEL=deepseek-ai/DeepSeek-R1-Distill-Qwen-32B
```
