import { StorageLayer } from "./storage/layer.ts";
import { fetchAndRetry } from "./service.ts";
import { FsLayer } from "./storage/fs-layer.ts";
import { path } from "./deps.ts";
import { AliOSSLayer } from "./storage/alioss-layer.ts";

function createLockBuffer() {
  return new TextEncoder().encode(
    JSON.stringify({ lock: true, time: new Date().toUTCString() }),
  );
}

export class StorageManager {
  static createLayer(): StorageLayer {
    let type = (Deno.env.get("STORAGE_LAYER_TYPE") || "").toLowerCase();

    switch (type) {
      case "fs":
        return new FsLayer(
          path.resolve(
            Deno.cwd(),
            Deno.env.get("FS_LAYER_STORAGE") || ".storage",
          ),
        );
      case "alioss":
        const key = Deno.env.get("ALIOSS_LAYER_KEY");
        const secret = Deno.env.get("ALIOSS_LAYER_SECRET");
        const bucket = Deno.env.get("ALIOSS_LAYER_BUCKET");
        const region = Deno.env.get("ALIOSS_LAYER_REGION");
        if (!key || !secret || !bucket || !region) {
          console.error(`AliOSS storage layer need more argument`);
          console.error(`  ALIOSS_LAYER_KEY=${key}`);
          console.error(`  ALIOSS_LAYER_SECRET=${secret}`);
          console.error(`  ALIOSS_LAYER_BUCKET=${bucket}`);
          console.error(`  ALIOSS_LAYER_REGION=${region}`);
          Deno.exit(0);
        }
        return new AliOSSLayer(key, secret, bucket, region);
    }

    throw new Error(`Cannot found layer of ${type}`);
  }

  static create() {
    return new StorageManager(StorageManager.createLayer());
  }

  constructor(public layer: StorageLayer) {}

  async cacheRemoteFile(
    source: string,
    target: string,
    force: boolean = false,
  ): Promise<void> {
    if (!force && await this.layer.exist(target)) {
      return;
    }

    const resp = await fetchAndRetry(source);
    const data = new Uint8Array(await resp.arrayBuffer());

    await this.layer.write(target, data, {
      type: resp.headers.get("content-type") || "",
    });
  }

  async cacheFile(target: string, data: Uint8Array, force = false) {
    if (!force && await this.layer.exist(target)) {
      return;
    }

    await this.layer.write(target, data, {
      type: target.endsWith(".json")
        ? "application/json"
        : "application/octet-stream",
    });
  }

  async cacheJSON(target: string, data: Uint8Array, force = false) {
    if (!force && await this.layer.exist(target)) {
      return;
    }

    await this.layer.write(target, data, {
      type: "application/json",
    });
  }

  async exist(filepath: string) {
    return this.layer.exist(filepath);
  }

  async isLock(lockpath: string) {
    return this.layer.exist(lockpath);
  }

  async lock(lockpath: string) {
    await this.layer.write(lockpath, createLockBuffer());
  }
}
