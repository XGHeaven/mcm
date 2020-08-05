import { StorageLayer } from "./storage/layer.ts";
import { fetchAndRetry } from "./service.ts";
import { byteToString } from "./utils.ts";

function createLockBuffer() {
  return new TextEncoder().encode(
    JSON.stringify({ lock: true, time: new Date().toUTCString() }),
  );
}

export class Storage implements StorageLayer {
  constructor(private layer: StorageLayer) {}

  read = this.layer.read.bind(this.layer);
  write = this.layer.write.bind(this.layer);
  exist = this.layer.exist.bind(this.layer);
  isSupportSameFileFolder = this.layer.isSupportSameFileFolder.bind(this.layer);
  isWantLessUsage = this.layer.isWantLessUsage.bind(this.layer);

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

  async cacheJSON(target: string, data: Uint8Array | string, force = false) {
    if (!force && await this.layer.exist(target)) {
      return;
    }
    const value = data instanceof Uint8Array
      ? data
      : new TextEncoder().encode(data);

    await this.layer.write(target, value, {
      type: "application/json",
    });
  }

  async readJSONWithDefault<T>(target: string, defaults: T): Promise<T> {
    try {
      const data = await this.layer.read(target);
      return JSON.parse(byteToString(data));
    } catch (e) {
      return defaults;
    }
  }

  async readFromBoth(source: string, target: string): Promise<Uint8Array> {
    if (this.layer.isWantLessUsage()) {
      return new Uint8Array(await (await fetchAndRetry(source)).arrayBuffer());
    }
    return await this.layer.read(target);
  }

  async readJSONFromBoth<T>(source: string, target: string): Promise<T> {
    const data = await this.readFromBoth(source, target);
    return JSON.parse(byteToString(data));
  }

  async isLock(lockpath: string) {
    return this.layer.exist(lockpath);
  }

  async lock(lockpath: string) {
    await this.layer.write(lockpath, createLockBuffer());
  }
}
