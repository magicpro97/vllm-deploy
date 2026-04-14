# Troubleshooting

## Model không load được

### Triệu chứng
`bun run test:api` trả về lỗi hoặc timeout.

### Giải pháp
```bash
# 1. Check logs
bun run logs

# 2. SSH vào xem chi tiết
bun run ssh
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
# Giảm context length
VLLM_ARGS=--max-model-len 4096 --gpu-memory-utilization 0.95

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
   bun run status
   # actual_status phải là "running"
   ```

2. **Model chưa load xong:**
   ```bash
   bun run logs
   # Tìm dòng "INFO: Application startup complete"
   ```

3. **FPT firewall chặn:**
   ```bash
   # Dùng SSH tunnel thay vì direct connect
   ssh -N -L 8000:localhost:18000 -p <SSH_PORT> root@<VAST_IP>
   # Sau đó dùng: http://localhost:8000/v1
   ```

4. **Port mapping sai:**
   ```bash
   bun run info
   # Check API port — Vast.ai map port ngoài khác port trong
   ```

---

## Instance tự tắt

### Nguyên nhân
- Dùng **interruptible** instance → bị preempt
- Hết credits
- Provider tắt máy

### Giải pháp
```bash
# Đổi sang on-demand
INSTANCE_TYPE=on-demand

# Nạp thêm credits
# Vast.ai → Account → Add Credits
```

---

## Quên tắt instance

### Phòng tránh
```bash
# Set budget alert
# Vast.ai → Account → Billing → Daily limit: $5

# Set auto-shutdown cron (trong instance)
bun run ssh
echo "0 22 * * * vastai stop instance \$CONTAINER_ID" | crontab -
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
bun run ssh
# Trong instance:
nvidia-smi                    # Check GPU utilization
vllm chat --url http://localhost:18000/v1   # Test interactive
```

### Tối ưu
```bash
# Tăng GPU utilization
VLLM_ARGS=--max-model-len 8192 --gpu-memory-utilization 0.95

# Bật speculative decoding (nếu hỗ trợ)
VLLM_ARGS=--max-model-len 8192 --gpu-memory-utilization 0.95 --speculative-model google/gemma-4-1b-it --num-speculative-tokens 5
```
