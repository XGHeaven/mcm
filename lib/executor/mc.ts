import { TaskExecutor } from "../sync-queue.ts";
import {
  fetchBinaryAndJson,
  fetchMinecraftVersionManifest,
  MinecraftLibraryResource,
  MinecraftVersionManifest,
  fetchMinecraftPackage,
  MinecraftPackageAssetIndex,
  MinecraftVersion,
} from "../service.ts";
import { StorageManager } from "../storage.ts";
import { sha1, path } from "../deps.ts";

const getAssetRemoteEndpoint = (hash: string) =>
  `http://resources.download.minecraft.net/${hash.substring(0, 2)}/${hash}`;
const getAssetStorageEndpoint = (hash: string) =>
  `/minecraft/assets/${hash.substring(0, 2)}/${hash}`;

const getAssetIndexStorageEndpoint = (assetIndexUrl: string) => {
  const parsedUrl = new URL(assetIndexUrl);
  return path.join("/minecraft/asset-index", parsedUrl.pathname);
};

const getMetaStorageEndpoint = (metaUrl: string) => {
  const parsedUrl = new URL(metaUrl);
  return path.join("/minecraft/launcher-meta", parsedUrl.pathname);
};

const getVersionsStorageEndpoint = () => {
  return `/minecraft/version_manifest.json`;
};

const getLibraryStorageEndpoint = (libraryUrl: string) => {
  const parsedUrl = new URL(libraryUrl);
  return path.join(`/minecraft/libraries`, parsedUrl.pathname);
};

const getLauncherEndpoint = (jarUrl: string) => {
  return path.join(`/minecraft/launcher`, new URL(jarUrl).pathname);
};

const getVersionLockEndpoint = (version: string) => {
  return `/minecraft/lock/${version}.json`;
};

const getAssetsLockEndpoint = (hash: string) => {
  return `/minecraft/lock/assets-${hash}.json`;
};

export class MinecraftExecutor {
  private versionManifest!: MinecraftVersionManifest;

  constructor(private storage: StorageManager) {}

  // 运行的依赖库
  library(lib: MinecraftLibraryResource) {
    return async () => {
      const target = getLibraryStorageEndpoint(lib.url);
      await this.storage.cacheRemoteFile(lib.url, target);
    };
  }

  createCacheResource(source: string, target: string): TaskExecutor {
    return async () => this.storage.cacheRemoteFile(source, target);
  }

  createCacheAssetIndex(assetIndex: MinecraftPackageAssetIndex): TaskExecutor {
    return async ({ queueChild, task }) => {
      const lockfile = getAssetsLockEndpoint(assetIndex.sha1);
      if (await this.storage.isLock(lockfile)) {
        console.log(
          `Asset of ${assetIndex.id}(${assetIndex.sha1}) has been locked`,
        );
        return;
      }

      const { url: assetIndexUrl } = assetIndex;
      const [data, json] = await fetchBinaryAndJson(assetIndexUrl);

      const assetIndexJsonHash = sha1(data, "", "hex") as string;
      if (assetIndex.sha1 !== assetIndexJsonHash) {
        console.error(
          `(${assetIndex.id}) Fetch asset index maybe not correct, hash is not matched.`,
        );
        console.error(
          `  ${assetIndex.url}(expected) !== ${assetIndexJsonHash}(actual)`,
        );
        console.error(`  Please restart sync again`);
        return;
      }

      for (const { hash } of Object.values(json.objects) as any[]) {
        queueChild(
          `${task.name}:${hash}`,
          this.createCacheResource(
            getAssetRemoteEndpoint(hash),
            getAssetStorageEndpoint(hash),
          ),
        );
      }

      await this.storage.cacheFile(
        getAssetIndexStorageEndpoint(assetIndexUrl),
        data,
      );

      return async ({ error }) => {
        if (error) {
          console.error(
            `Cannot lock assets of ${assetIndex.id} has ${error} error(s). Please try again`,
          );
        } else {
          await this.storage.lock(lockfile);
        }
      };
    };
  }

  createVersion(version: MinecraftVersion): TaskExecutor {
    const { id } = version;
    return async ({ queueChild, task }) => {
      const lockfile = getVersionLockEndpoint(id);
      if (await this.storage.isLock(lockfile)) {
        console.log(`Version of ${id} has been locked`);
        return;
      }
      const [data, mcPackage] = await fetchMinecraftPackage(version.url);

      queueChild(
        `${task.name}:assetIndex`,
        this.createCacheAssetIndex(mcPackage.assetIndex),
      );

      for (const [type, download] of Object.entries(mcPackage.downloads)) {
        queueChild(
          `${task.name}:downloads:${type}`,
          this.createCacheResource(
            download.url,
            getLauncherEndpoint(download.url),
          ),
        );
      }

      for (const { downloads: libInfo, name: libName } of mcPackage.libraries) {
        queueChild(
          `${task.name}:library:${libName}`,
          this.library(libInfo.artifact),
        );
        if (libInfo.classifiers) {
          for (const [type, lib] of Object.entries(libInfo.classifiers)) {
            queueChild(
              `${task.name}:library:${libName}:classifiers:${type}`,
              this.library(lib),
            );
          }
        }
      }

      await this.storage.cacheFile(getMetaStorageEndpoint(version.url), data);

      return async ({ error }) => {
        if (error) {
          console.error(
            `Version ${version.id} has verified error, please try start again`,
          );
        } else {
          await this.storage.lock(lockfile);
        }
      };
    };
  }

  createMinecraftVersion(version?: string | RegExp): TaskExecutor {
    return async ({ queueChild, task }) => {
      let manifest: MinecraftVersionManifest;
      let data: Uint8Array;
      if (this.versionManifest) {
        manifest = this.versionManifest;
      } else {
        [data, manifest] = await fetchMinecraftVersionManifest();
        await this.storage.cacheFile(getVersionsStorageEndpoint(), data, true);
      }

      if (typeof version === "string") {
        const selectedVersion = manifest.versions.find((ver) =>
          ver.id === version
        );
        if (!selectedVersion) {
          console.error("Cannot found version of " + version);
          return;
        }
        queueChild(
          `${task.name}:${version}`,
          this.createVersion(selectedVersion),
        );
      } else if (version) {
        // regexp
        for (const ver of manifest.versions) {
          if (ver.id.match(version)) {
            queueChild(`${task.name}:${ver.id}`, this.createVersion(ver));
          }
        }
      } else {
        for (const ver of manifest.versions) {
          queueChild(`${task.name}-${ver}`, this.createVersion(ver));
        }
      }
    };
  }
}
