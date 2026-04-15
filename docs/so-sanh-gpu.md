# So sánh GPU

## Cho model 31B (BF16 ~62GB, cần multi-GPU hoặc quantization)

> vLLM mặc định load BF16. Dùng `--quantization` flag nếu cần quantize.
> Default config: `--max-model-len 32768 --gpu-memory-utilization 0.95 --enable-prefix-caching`

| GPU | VRAM | Giá Vast.ai | Tốc độ (est.) | Context khuyên | Ghi chú |
|-----|------|------------|---------------|----------------|---------|
| **RTX 3090** | 24GB | $0.20-0.35/hr | ~15-20 tok/s | 8K-16K | 💰 Rẻ nhất |
| **RTX 4090** | 24GB | $0.30-0.50/hr | ~25-35 tok/s | 16K-32K | ⭐ Best value |
| **A6000** | 48GB | $0.50-0.80/hr | ~20-25 tok/s | 32K+ | Context dài |
| **RTX 5090** | 32GB | $0.50-0.80/hr | ~35-45 tok/s | 16K-32K | 🏆 Nhanh nhất |
| **L4** | 24GB | $0.40-0.60/hr | ~15-20 tok/s | 8K-16K | Datacenter |
| **A100 40GB** | 40GB | $0.80-1.20/hr | ~30-40 tok/s | 32K | Production |
| **A100 80GB** | 80GB | $1.20-2.00/hr | ~30-40 tok/s | 64K+ | Max context |
| **H100** | 80GB | $2.00-3.50/hr | ~50-70 tok/s | 64K+ | Fastest |

> ⚠️ Tốc độ ước tính, thực tế phụ thuộc batch size, prompt length, quantization.

## Quantization so sánh (vLLM supported)

| Format | Size (31B) | VRAM cần | GPU yêu cầu | Chất lượng | vLLM flag |
|--------|-----------|---------|-------------|-----------|-----------|
| **AWQ** | ~18GB | ~20-22GB | Ampere+ | ~96% | `--quantization awq` |
| **GPTQ** | ~18GB | ~20-22GB | Mọi GPU | ~95-96% | `--quantization gptq` |
| **FP8** | ~32GB | ~34-36GB | Ampere+ | ~99% | `--quantization fp8` |
| **BF16** (full) | ~62GB | ~64-68GB | Mọi GPU | 100% | (default) |

> ℹ️ vLLM **không hỗ trợ GGUF**. Dùng AWQ/GPTQ cho quantization trên vLLM.

## Khuyến nghị theo ngân sách

### Rẻ nhất: RTX 3090
```bash
bun run deploy start --gpu RTX3090
# Context tự adjust theo VRAM
# ~$11/tháng (2h/ngày)
```

### Cân bằng: RTX 4090 ⭐
```bash
bun run deploy start --cheap
# Default: 32K context, prefix caching ON
# ~$18/tháng (2h/ngày)
```

### Context dài: A100 80GB
```bash
bun run deploy start --gpu A100
# Context 64K+, prefix caching giảm ~50-70% KV cache
# ~$55/tháng (2h/ngày)
```

## Prefix Caching

vLLM mặc định bật `--enable-prefix-caching`:
- **Tác dụng:** Cache KV cho repeated prefix (system prompt, tool definitions)
- **Tiết kiệm:** ~50-70% KV cache memory cho lần request thứ 2+
- **Phù hợp:** Claude Code (system prompt lặp lại mỗi request)
