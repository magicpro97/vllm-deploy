# Tối ưu chi phí

## 1. Chọn GPU đúng

| Nhu cầu | GPU | Giá | Lý do |
|---------|-----|-----|-------|
| Rẻ nhất | RTX 3090 | ~$0.20-0.35/hr | Đủ 24GB VRAM |
| Best value | RTX 4090 | ~$0.30-0.50/hr | Nhanh hơn 3090 ~30% |
| Context dài | A100 40GB | ~$0.80-1.20/hr | 40GB = context lớn hơn |
| NVFP4 quality | RTX 5090 | ~$0.50-0.80/hr | Cần Blackwell GPU |

Sửa `.env` để đổi GPU:
```bash
GPU_PREFER=RTX 3090    # Rẻ nhất
GPU_MAX_PRICE=0.35     # Max price/hr
```

## 2. On-demand vs Interruptible

| Loại | Giá | Rủi ro |
|------|-----|--------|
| **On-demand** | Cao hơn ~30% | Không bị gián đoạn |
| **Interruptible** | Rẻ hơn | Có thể bị ngắt bất cứ lúc nào |

**Khuyên:** Dùng on-demand cho công việc quan trọng. Interruptible cho test/thí nghiệm.

```bash
INSTANCE_TYPE=interruptible    # Tiết kiệm
```

## 3. Network Storage (cache model)

**Vấn đề:** Mỗi lần tạo instance mới, model phải download lại (~20GB = 10-15 phút).

**Giải pháp:** Vast.ai Network Storage

```
Web UI → Storage → Create Volume → 30GB
Cost: ~$0.60/tháng
```

Mount vào instance → model cache persistent → boot nhanh 1-2 phút thay vì 15 phút.

## 4. Custom Template

Sau khi setup xong lần đầu:

1. Web UI → Instance → **Create Template**
2. Lưu lại tất cả config
3. Lần sau: **My Templates** → 1-click RENT

## 5. Budget Alert

**QUAN TRỌNG:** Tránh quên tắt instance!

```
Vast.ai → Account → Billing → Daily spending limit: $5/day
```

Nếu vượt $5/day → Vast.ai tự cảnh báo.

## 6. Auto-shutdown

Trong instance, set cron job tự tắt:

```bash
# Tự destroy sau 8 giờ
echo "0 */8 * * * vastai stop instance \$CONTAINER_ID" | crontab -
```

## 7. Bảng chi phí ước tính

| Kịch bản | GPU | Giờ/ngày | Ngày/tháng | Storage | Tổng/tháng |
|----------|-----|---------|-----------|---------|-----------|
| **Tiết kiệm** | RTX 3090 | 2h | 22 | $0.60 | **~$11** |
| **Cân bằng** | RTX 4090 | 2h | 22 | $0.60 | **~$19** |
| **Thoải mái** | RTX 4090 | 4h | 22 | $0.60 | **~$36** |
| **Full-time** | RTX 4090 | 8h | 22 | $0.60 | **~$71** |
| **24/7** | RTX 4090 | 24h | 30 | $0.60 | **~$290** |

## 8. So sánh alternatives

| Dịch vụ | Cost/tháng | Model | Giới hạn |
|---------|-----------|-------|----------|
| **Vast.ai (2h/day)** | ~$18 | Custom 31B | Không |
| OpenAI API | Pay-per-token | GPT-4o | Rate limit |
| Claude Pro | $20 | Claude 3.5 | Usage cap |
| Ollama Cloud Pro | $20 | Catalog only | Không custom |
| RunPod | ~$30+ | Custom | Không |
| Self-host (RTX 4090) | $0 (đã có GPU) | Custom | Hardware |
