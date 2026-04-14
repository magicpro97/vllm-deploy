# So sánh GPU

## Cho model Gemma 4 31B Q4_K_M (~20GB)

| GPU | VRAM | Giá Vast.ai | Tốc độ (est.) | Context max | Khuyên |
|-----|------|------------|---------------|-------------|--------|
| **RTX 3090** | 24GB | $0.20-0.35/hr | ~15-20 tok/s | ~4K-8K | 💰 Rẻ nhất |
| **RTX 4090** | 24GB | $0.30-0.50/hr | ~25-35 tok/s | ~4K-8K | ⭐ Best value |
| **A6000** | 48GB | $0.50-0.80/hr | ~20-25 tok/s | ~16K-32K | Context dài |
| **RTX 5090** | 32GB | $0.50-0.80/hr | ~35-45 tok/s | ~8K-16K | 🏆 Nhanh nhất |
| **L4** | 24GB | $0.40-0.60/hr | ~15-20 tok/s | ~4K-8K | Datacenter |
| **A100 40GB** | 40GB | $0.80-1.20/hr | ~30-40 tok/s | ~16K-32K | Production |
| **A100 80GB** | 80GB | $1.20-2.00/hr | ~30-40 tok/s | ~64K+ | Max context |
| **H100** | 80GB | $2.00-3.50/hr | ~50-70 tok/s | ~64K+ | Fastest |

> ⚠️ Tốc độ ước tính, thực tế phụ thuộc batch size, prompt length, quantization.

## Quantization so sánh

| Format | Size | VRAM cần | GPU yêu cầu | Chất lượng |
|--------|------|---------|-------------|-----------|
| **GGUF Q4_K_M** | ~20GB | ~22-24GB | Mọi GPU | ~95-96% |
| **GGUF Q5_K_M** | ~23GB | ~25-27GB | Mọi GPU | ~97-98% |
| **NVFP4** | ~18GB | ~20-22GB | Blackwell only | ~99.5% |
| **FP8** | ~32GB | ~34-36GB | Ampere+ | ~99% |
| **BF16** (full) | ~62GB | ~64-68GB | Mọi GPU | 100% |

## Khuyến nghị theo ngân sách

### Rẻ nhất: RTX 3090 + Q4_K_M
```bash
GPU_PREFER=RTX 3090
VLLM_ARGS=--max-model-len 4096 --gpu-memory-utilization 0.95
# ~$11/tháng (2h/ngày)
```

### Cân bằng: RTX 4090 + Q4_K_M ⭐
```bash
GPU_PREFER=RTX 4090
VLLM_ARGS=--max-model-len 8192 --gpu-memory-utilization 0.95
# ~$18/tháng (2h/ngày)
```

### Chất lượng cao: RTX 5090 + NVFP4
```bash
GPU_PREFER=RTX 5090
VLLM_ARGS=--max-model-len 8192 --gpu-memory-utilization 0.95 --quantization nvfp4
# ~$25/tháng (2h/ngày)
```

### Context dài: A100 + Q5_K_M
```bash
GPU_PREFER=A100
VLLM_ARGS=--max-model-len 32768 --gpu-memory-utilization 0.9
# ~$55/tháng (2h/ngày)
```
