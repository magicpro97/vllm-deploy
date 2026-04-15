# Tối ưu chi phí

## 1. Chọn GPU đúng

| Nhu cầu | CLI Flag | Giá | Lý do |
|---------|----------|-----|-------|
| Rẻ nhất | `--cheap` hoặc `--gpu RTX3090` | ~$0.20-0.35/hr | Đủ 24GB VRAM |
| Best value | `--cheap` (default) | ~$0.30-0.50/hr | Auto-pick rẻ nhất |
| Nhanh nhất | `--fast` | ~$0.50-0.80/hr | RTX 5090/A100 |
| Context dài | `--gpu A100` | ~$0.80-1.20/hr | 40-80GB VRAM |

```bash
# Ví dụ
bun run deploy start --cheap              # Rẻ nhất available
bun run deploy start --gpu RTX3090        # Chọn cụ thể
bun run deploy start --fast --budget 2    # Nhanh nhất, max $2
```

## 2. On-demand vs Spot (Interruptible)

| Loại | Flag | Giá | Rủi ro |
|------|------|-----|--------|
| **On-demand** | (default) | Cao hơn ~30% | Không bị gián đoạn |
| **Spot** | `--spot` | Rẻ hơn ~50% | Có thể bị ngắt bất cứ lúc nào |

**Khuyên:** On-demand cho công việc quan trọng. Spot cho test/thí nghiệm.

```bash
bun run deploy start --spot              # Spot instance
bun run deploy start --spot --service    # Spot + watchdog auto-restart
```

## 3. Auto-shutdown (tránh quên tắt!)

```bash
# Tự tắt sau 2 giờ
bun run deploy start --hours 2

# Tự tắt khi chi phí đạt $1
bun run deploy start --budget 1.00

# Kết hợp cả hai
bun run deploy start --hours 4 --budget 2.00
```

> 💡 Dashboard hiển thị countdown thời gian và budget còn lại.

## 4. Prefix Caching (mặc định bật)

vLLM default bật `--enable-prefix-caching`:
- Cache KV cho repeated prefix (system prompt, tool definitions)
- Tiết kiệm ~50-70% KV cache memory từ request thứ 2+
- Đặc biệt hiệu quả với Claude Code (system prompt lặp lại)

## 5. Service Mode (Watchdog)

```bash
# Watchdog tự restart khi instance die
bun run deploy start --service --spot

# Dùng spot + watchdog = rẻ nhất + tự recovery
```

## 6. Network Storage (cache model)

**Vấn đề:** Mỗi lần tạo instance mới, model phải download lại (~20-60GB = 10-30 phút).

**Giải pháp:** Vast.ai Network Storage

```
Web UI → Storage → Create Volume → 70GB
Cost: ~$1.50/tháng
```

Mount vào instance → model cache persistent → boot nhanh 1-2 phút.

## 7. Custom Template

Sau khi setup xong lần đầu:

1. Web UI → Instance → **Create Template**
2. Lưu lại tất cả config
3. Lần sau: **My Templates** → 1-click RENT

## 8. Vast.ai Budget Alert

```
Vast.ai → Account → Billing → Daily spending limit: $5/day
```

## 9. Bảng chi phí ước tính

| Kịch bản | GPU | Giờ/ngày | Ngày/tháng | Storage | Tổng/tháng |
|----------|-----|---------|-----------|---------|-----------|
| **Tiết kiệm** | RTX 3090 | 2h | 22 | $0.60 | **~$11** |
| **Cân bằng** | RTX 4090 | 2h | 22 | $0.60 | **~$19** |
| **Thoải mái** | RTX 4090 | 4h | 22 | $0.60 | **~$36** |
| **Full-time** | RTX 4090 | 8h | 22 | $0.60 | **~$71** |
| **24/7** | RTX 4090 | 24h | 30 | $0.60 | **~$290** |

## 10. So sánh alternatives

| Dịch vụ | Cost/tháng | Model | Giới hạn |
|---------|-----------|-------|----------|
| **Vast.ai (2h/day)** | ~$18 | Custom HF model | Không |
| OpenRouter Gemma 4 | ~$0.14/$0.40 per 1M tok | Gemma 4 31B (base) | Rate limit |
| Claude Max 5x | $100 | Claude Opus 4.6 | Usage cap |
| OpenAI API | Pay-per-token | GPT-4o | Rate limit |
| RunPod | ~$30+ | Custom | Không |
| Self-host (RTX 4090) | $0 (đã có GPU) | Custom | Hardware |
