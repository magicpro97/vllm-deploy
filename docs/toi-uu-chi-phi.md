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

| Loại | Flag | Giá | Rủi ro | Auto-recover |
|------|------|-----|--------|-------------|
| **On-demand** | (default) | 100% | Không bị gián đoạn | N/A |
| **Spot** | `--spot` | Rẻ hơn ~50-65% | Có thể bị ngắt | ✅ `--auto-recover` |

**Khuyên:**
- **Sử dụng cá nhân:** Spot + `--auto-recover` — tiết kiệm đáng kể, tự phục hồi
- **Công việc quan trọng:** On-demand — không bị gián đoạn
- **Budget nhỏ (≤$5):** Tự động chọn spot (smart auto-spot)

```bash
# Spot instance cơ bản
bun run deploy start --spot

# Spot + tự phục hồi khi bị gián đoạn (khuyên dùng)
bun run deploy start --spot --auto-recover

# Spot + watchdog + auto-recover = combo tiết kiệm nhất
bun run deploy start --spot --service --auto-recover

# Budget nhỏ → tự chuyển spot
bun run deploy start --budget 2.00
```

### Auto-recover hoạt động thế nào?

1. Watchdog poll trạng thái instance mỗi 30s
2. Phát hiện bị gián đoạn (preempted/offline/exited/error)
3. Tự tìm GPU mới phù hợp trên marketplace
4. Tạo instance mới, đợi ready, cập nhật thông tin
5. Tối đa **10 lần recovery**, cooldown 5 phút giữa mỗi lần
6. Budget/hours tính **tích lũy** qua các lần recovery

### Vast.ai chỉ tính tiền khi chạy

Spot instance bị gián đoạn → **không tính tiền** thời gian offline. Dashboard hiển thị uptime thực tế từ Vast.ai API.

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

## 5. Service Mode + Auto-recover

```bash
# Watchdog tự restart khi instance die
bun run deploy start --service --spot --auto-recover

# Combo: spot + watchdog + auto-recover = rẻ nhất + tự recovery
# Tiết kiệm ~50-65% so với on-demand, downtime ~3-5 phút khi bị preempt
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

| Kịch bản | GPU | Giờ/ngày | On-demand | Spot + auto-recover |
|----------|-----|---------|----------|-------------------|
| **Tiết kiệm** | RTX 3090 | 2h | **~$11** | **~$5-6** |
| **Cân bằng** | RTX 4090 | 2h | **~$19** | **~$8-10** |
| **Thoải mái** | RTX 4090 | 4h | **~$36** | **~$16-20** |
| **Full-time** | RTX 4090 | 8h | **~$71** | **~$32-40** |
| **24/7** | RTX 4090 | 24h | **~$290** | **~$130-170** |

> 💡 Spot tiết kiệm ~50-65%. + $0.60/tháng storage.

## 10. So sánh alternatives

| Dịch vụ | Cost/tháng | Model | Giới hạn |
|---------|-----------|-------|----------|
| **Vast.ai (2h/day)** | ~$18 | Custom HF model | Không |
| OpenRouter Gemma 4 | ~$0.14/$0.40 per 1M tok | Gemma 4 31B (base) | Rate limit |
| Claude Max 5x | $100 | Claude Opus 4.6 | Usage cap |
| OpenAI API | Pay-per-token | GPT-4o | Rate limit |
| RunPod | ~$30+ | Custom | Không |
| Self-host (RTX 4090) | $0 (đã có GPU) | Custom | Hardware |
