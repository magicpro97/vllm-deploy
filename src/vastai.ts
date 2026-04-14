import { $ } from "bun";

export interface VastOffer {
  id: number;
  gpu_name: string;
  gpu_ram: number;
  dph_total: number;
  inet_up: number;
  num_gpus: number;
  disk_space: number;
  reliability: number;
}

export interface VastInstance {
  id: number;
  gpu_name: string;
  actual_status: string;
  public_ipaddr: string;
  ports: Record<string, Array<{ HostPort: string }>>;
  dph_total: number;
  ssh_port: number;
  ssh_host: string;
}

export async function searchOffers(opts: {
  type: string;
  gpuName: string;
  minVram: number;
  minDisk: number;
  limit?: number;
}): Promise<VastOffer[]> {
  const result =
    await $`vastai search offers --type ${opts.type} --gpu-name ${opts.gpuName} --min-gpu-ram ${opts.minVram} --min-disk ${opts.minDisk} --order dph-asc --limit ${opts.limit ?? 5} --raw`
      .text()
      .catch(() => "[]");
  try {
    return JSON.parse(result);
  } catch {
    return [];
  }
}

export async function createInstance(
  offerId: number,
  env: Record<string, string>,
  diskSize: number
): Promise<string | null> {
  const envArgs = Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`]);

  const result =
    await $`vastai create instance ${offerId} --image vllm/vllm-openai:latest --disk ${diskSize} ${envArgs}`.text();

  const match = result.match(/(\d+)/);
  return match ? match[1] : null;
}

export async function showInstances(): Promise<VastInstance[]> {
  const result = await $`vastai show instances --raw`.text().catch(() => "[]");
  try {
    return JSON.parse(result);
  } catch {
    return [];
  }
}

export async function showInstancesFormatted(): Promise<string> {
  return $`vastai show instances`.text().catch(() => "No instances");
}

export async function destroyInstance(id: number | string): Promise<string> {
  return $`vastai destroy instance ${id}`.text();
}

export async function getLogs(id: number | string, tail = 50): Promise<string> {
  return $`vastai logs ${id} --tail ${tail}`.text().catch(() => "No logs available");
}

export async function sshConnect(host: string, port: string | number) {
  const proc = Bun.spawn(["ssh", "-p", String(port), `root@${host}`], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;
}
