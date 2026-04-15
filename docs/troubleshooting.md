# Troubleshooting

## Model không load được

### Triệu chứng
`bun run deploy test` trả về lỗi hoặc timeout.

### Giải pháp
```bash
# 1. Check logs
bun run deploy logs

# 2. SSH vào xem chi tiết
bun run deploy ssh
supervisorctl status vllm
cat /var/log/supervisor/vllm-*.log | tail -50

# 3. Thường gặp:
# - OOM: Model quá lớn cho GPU → giảm max-model-len
# - Download fail: HuggingFace rate limit → thêm HF_TOKEN
# - CUDA mismatch: Chọn Secure Cloud datacenter
```

### Fixes

**OOM (Out of Memory):**
```bash
# Giảm context length trong .env
VLLM_ARGS=--max-model-len 8192 --gpu-memory-utilization 0.95 --enable-prefix-caching

# Hoặc dùng model nhỏ hơn
VLLM_MODEL=google/gemma-4-12b-it
```

**HuggingFace rate limit:**
```bash
# Thêm token vào .env
HF_TOKEN=hf_xxxxxxxxxxxxxxxx
```

---

## Kết nối bị từ chối

### Triệu chứng
`curl: (7) Failed to connect` hoặc timeout.

### Giải pháp

1. **Check instance status:**
   ```bash
   bun run deploy status
   # actual_status phải là "running"
   ```

2. **Model chưa load xong:**
   ```bash
   bun run deploy logs
   # Tìm dòng "INFO: Application startup complete"
   ```

3. **Corporate firewall chặn:**
   ```bash
   # Dùng SSH tunnel thay vì direct connect
   ssh -N -L 8000:localhost:18000 -p <SSH_PORT> root@<VAST_IP>
   # Sau đó dùng: http://localhost:8000/v1
   ```

4. **Port mapping sai:**
   ```bash
   bun run deploy info
   # Check API port — Vast.ai map port ngoài khác port trong
   ```

---

## Instance tự tắt

### Nguyên nhân
- Dùng **spot** instance → bị preempt (phổ biến nhất)
- Hết credits
- Provider tắt máy

### Giải pháp
```bash
# 1. Dùng spot + auto-recover (khuyên dùng)
bun run deploy start --spot --auto-recover
# → Tự tìm GPU mới và deploy lại khi bị gián đoạn

# 2. Dùng on-demand (không bị gián đoạn)
bun run deploy start

# 3. Spot + watchdog + auto-recover (service mode)
bun run deploy start --spot --service --auto-recover

# 4. Nạp thêm credits nếu hết tiền
# Vast.ai → Account → Add Credits
```

## Spot auto-recover không hoạt động

### Triệu chứng
Instance bị gián đoạn nhưng không tự phục hồi.

### Nguyên nhân & Giải pháp

1. **Chưa bật `--auto-recover`:**
   ```bash
   bun run deploy start --spot --auto-recover
   ```

2. **Đã hết 10 lần recovery:**
   - Watchdog giới hạn tối đa 10 lần recovery
   - Restart lại: `bun run deploy start --spot --auto-recover`

3. **Không tìm được GPU phù hợp:**
   - Marketplace hết GPU cùng loại
   - Thử GPU khác: `bun run deploy start --spot --auto-recover --gpu RTX3090`

4. **Cooldown 5 phút:**
   - Giữa mỗi lần recovery có 5 phút chờ
   - Kiểm tra dashboard/logs để thấy countdown

5. **Budget/hours đã hết:**
   - Budget/hours tính tích lũy qua các lần recovery
   - Tăng budget: `--budget 5.00`

---

## Quên tắt instance

### Phòng tránh
```bash
# Auto-shutdown sau 2 giờ
bun run deploy start --hours 2

# Auto-shutdown khi đạt budget
bun run deploy start --budget 1.00

# Set budget alert trên Vast.ai
# Vast.ai → Account → Billing → Daily limit: $5
```

> 💡 Dashboard hiển thị countdown thời gian và budget còn lại.

---

## Dashboard không hiển thị data

### Triệu chứng
Dashboard mở nhưng tất cả panels trống.

### Giải pháp
```bash
# Check có instance đang chạy không
bun run deploy status

# Dashboard cần instance đang chạy + API ready
# Nếu vừa deploy, đợi model load xong rồi mở dashboard
bun run deploy test    # Confirm API ready
bun run deploy dashboard
```

---

## CUDA driver mismatch

### Triệu chứng
```
CUDA error: no kernel image is available for execution on the device
```

### Giải pháp
- Chọn **Secure Cloud** instances (verified drivers)
- Hoặc chọn image tag cụ thể: `vllm/vllm-openai:v0.14.0-cuda-12.9`

---

## Performance chậm

### Kiểm tra
```bash
# Dùng dashboard để monitor real-time
bun run deploy dashboard

# Hoặc SSH vào check
bun run deploy ssh
nvidia-smi                    # Check GPU utilization
```

### Tối ưu
```bash
# Prefix caching đã bật mặc định
# Nếu cần thêm tốc độ, thử speculative decoding:
VLLM_ARGS=--max-model-len 32768 --gpu-memory-utilization 0.95 --enable-prefix-caching --speculative-model google/gemma-4-1b-it --num-speculative-tokens 5
```

---

## Service mode / Watchdog issues

### Watchdog không restart

```bash
# Check watchdog PID
bun run deploy watch

# Nếu watchdog crashed, restart manual:
bun run deploy start --service
```

### Instance restart loop

```bash
# Check logs để xem tại sao instance fail
bun run deploy logs

# Thường do OOM → giảm context length hoặc đổi GPU lớn hơn
```

---

## Dashboard issues

### Dashboard lag với nhiều logs

Dashboard sử dụng **virtual scroll** — chỉ render dòng hiển thị (viewport slicing). Nếu vẫn lag:
- Buffer tối đa 500 dòng, dòng cũ tự xóa
- Dùng mouse wheel để scroll logs
- Auto-scroll resume khi scroll về cuối

### Dashboard hiện sai uptime

Dashboard lấy uptime thực tế từ Vast.ai API (`metrics.uptime`), không phải local time. Nếu hiện sai:
```bash
# Check API response trực tiếp
vastai show instances --raw
# Xem field `duration` — uptime tính bằng giây
```
