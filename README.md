# 🚀 vLLM Deploy — Gemma 4 31B Claude Opus on Vast.ai

> Self-host **charaf/gemma4-31b-claude-opus-abliterated** trên Vast.ai với chi phí **~$18/tháng** (2h/ngày).  
> OpenAI-compatible API, dùng được với Claude Code, Cursor, Continue, hoặc bất kỳ client nào.

## Tại sao?

| So sánh | Chi phí | Model | Giới hạn |
|---------|---------|-------|----------|
| **Vast.ai (repo này)** | ~$0.30/hr on-demand | Gemma 4 31B Opus Distill | Không giới hạn |
| OpenAI GPT-4o | $5-20/1M tokens | GPT-4o | Rate limit |
| Claude Pro | $20/mo | Claude 3.5/Opus | Usage cap |
| Ollama Cloud Pro | $20/mo | Catalog only | Không custom model |

## Quick Start (5 phút)

### 1. Cài đặt

```powershell
git clone <repo-url> && cd vllm-deploy
pip install vastai
vastai set api-key YOUR_API_KEY
```

### 2. Deploy

```powershell
# Tìm GPU rẻ nhất + deploy 1 lệnh
.\deploy.ps1 start
```

### 3. Dùng

```powershell
# Test API
.\deploy.ps1 test

# Xem thông tin kết nối
.\deploy.ps1 info
```

### 4. Tắt (ngừng tính tiền)

```powershell
.\deploy.ps1 stop
```

## Cấu hình Claude Code

```powershell
# Auto-config Claude Code
.\deploy.ps1 config-claude
```

Hoặc manual — thêm vào Claude Code settings:

```json
{
  "apiProvider": "openai-compatible",
  "apiBaseUrl": "http://<IP>:<PORT>/v1",
  "apiKey": "<TOKEN>",
  "model": "charaf/gemma4-31b-claude-opus-abliterated"
}
```

## Chi phí ước tính

| Sử dụng | GPU | Chi phí/tháng |
|---------|-----|--------------|
| 2h/ngày (tiết kiệm) | RTX 3090 | **~$11** |
| 2h/ngày | RTX 4090 | **~$18** |
| 4h/ngày | RTX 4090 | **~$35** |
| 8h/ngày | RTX 4090 | **~$70** |

> 💡 + $0.60/tháng storage để cache model (skip download mỗi lần boot)

## Tài liệu

- 📖 [Hướng dẫn chi tiết](docs/huong-dan-chi-tiet.md)
- 💰 [Tối ưu chi phí](docs/toi-uu-chi-phi.md)
- 🔧 [Troubleshooting](docs/troubleshooting.md)
- 📊 [So sánh GPU](docs/so-sanh-gpu.md)

## Yêu cầu

- Tài khoản [Vast.ai](https://cloud.vast.ai) (nạp tối thiểu $10)
- Python 3.8+ (cho `vastai` CLI)
- PowerShell 5.1+ (Windows) hoặc Bash (Linux/Mac)

## License

MIT
