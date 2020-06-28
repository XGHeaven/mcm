import { fetchBinaryAndJson } from "../service.ts";
import { StorageManager } from "../storage.ts";
import { path, sha1, colors } from "../deps.ts";
import {
  TaskManager,
  TaskExecutor,
  GroupTaskExecutor,
  GroupTaskCollector,
} from "../task/manager.ts";

const getAssetRemoteEndpoint = (hash: string) =>
  `http://resources.download.minecraft.net/${hash.substring(0, 2)}/${hash}`;
const getAssetStorageEndpoint = (hash: string) =>
  `/minecraft/assets/${hash.substring(0, 2)}/${hash}`;

const getMetaStorageEndpoint = (metaUrl: string) => {
  const parsedUrl = new URL(metaUrl);
  return path.join("/minecraft/launcher-meta", parsedUrl.pathname);
};

const getMinecraftMetaRemoteEndpoint = () =>
  "http://launchermeta.mojang.com/mc/game/version_manifest.json";
const minecraftMetaTarget = "/minecraft/mc/game/version_manifest.json";

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

const getLibraryLockEndpoint = (version: string, hash: string) => {
  return `/minecraft/lock/${version}/${hash}-libraries.json`;
};

export enum MinecraftVersionType {
  RELEASE = "release",
  SNAPSHOT = "snapshot",
}

interface MinecraftVersion {
  id: string;
  type: MinecraftVersionType;
  url: string;
  time: Date;
  releaseTime: Date;
}

interface MinecraftVersionManifest {
  latest: Record<MinecraftVersionType, string>;
  versions: MinecraftVersion[];
}

interface MinecraftPackage {
  id: string;
  type: MinecraftVersionType;
  time: string;
  releaseTime: string;
  mainClass: string;
  minimumLauncherVersion: number;
  assets: string;
  logging: {
    client: {
      argument: string;
      file: {
        id: string;
        sha1: string;
        size: number;
        url: string;
      };
      type: string;
    };
  };
  assetIndex: MinecraftPackageAssetIndex;
  downloads: {
    client: MinecraftPackageDownload;
    client_mappings: MinecraftPackageDownload;
    server: MinecraftPackageDownload;
    server_mappings: MinecraftPackageDownload;
  };
  libraries: MinecraftPackageLibrary[];
}

interface MinecraftPackageLibrary {
  name: string;
  downloads: {
    artifact?: MinecraftLibraryResource;
    classifiers?: Record<string, MinecraftLibraryResource>;
  };
  rules?: any[];
  natives: any;
}

interface MinecraftLibraryResource {
  path: string;
  sha1: string;
  size: number;
  url: string;
}

interface MinecraftPackageDownload {
  sha1: string;
  size: number;
  url: string;
}

interface MinecraftPackageAssetIndex {
  id: string;
  sha1: string;
  size: number;
  totalSize: number;
  url: string;
}

async function fetchMinecraftVersionManifest(): Promise<
  [Uint8Array, MinecraftVersionManifest]
> {
  const [data, manifest] = await fetchBinaryAndJson(
    getMinecraftMetaRemoteEndpoint(),
  );

  return [data, manifest];
}

async function fetchMinecraftPackage(
  url: string,
): Promise<[Uint8Array, MinecraftPackage]> {
  return fetchBinaryAndJson(url);
}

export class MinecraftExecutor {
  private assetIndexCache = new Map<string, Promise<void>>();

  constructor(
    private storage: StorageManager,
    private tasks: TaskManager,
    private versionSelector: (version: MinecraftVersion) => boolean,
    private verify = false
  ) {}

  // 运行的依赖库
  private library(lib: MinecraftLibraryResource) {
    return async () => {
      const target = getLibraryStorageEndpoint(lib.url);
      await this.storage.cacheRemoteFile(lib.url, target);
    };
  }

  private createCacheResource(source: string, target: string): TaskExecutor {
    return async () => this.storage.cacheRemoteFile(source, target);
  }

  private createCacheAssetIndex(
    assetIndex: MinecraftPackageAssetIndex,
  ): TaskExecutor {
    return async ({startLongPhase, stopLongPhase}) => {
      startLongPhase()
      await this.runAssetIndexCheck(assetIndex);
      stopLongPhase()
    };
  }

  private createVersion(versionMeta: MinecraftVersion): TaskExecutor {
    const { id: version, url: source } = versionMeta;
    const target = getMetaStorageEndpoint(source);
    const versionHash = source.split("/").slice(-2)[0];
    const libraryLock = getLibraryLockEndpoint(version, versionHash);

    return async (
      { queue, task, queueGroup, startLongPhase, stopLongPhase },
    ) => {
      if (await this.storage.exist(target)) {
        console.log(`Version ${version} has been cached, skip...`);
        return;
      }

      const [data, mcPackage] = await fetchMinecraftPackage(source);

      const assetIndexRunning = queue(
        `${task.name}:assetIndex`,
        this.createCacheAssetIndex(mcPackage.assetIndex),
      );

      const downloads = queueGroup(
        `${task.name}:downloads`,
        Object.entries(mcPackage.downloads).reduce((exes, [type, download]) => {
          exes[`${task.name}:downloads:${type}`] = this.createCacheResource(
            download.url,
            getLauncherEndpoint(download.url),
          );
          return exes;
        }, {} as GroupTaskExecutor),
      );

      const loggingUrl = mcPackage?.logging?.client?.file?.url
      const logging = loggingUrl ? queue(`${task.name}:logging`, this.createCacheResource(loggingUrl, getLauncherEndpoint(loggingUrl))) : Promise.resolve()

      let libraryPromise: Promise<void>;

      if (await this.storage.isLock(libraryLock)) {
        libraryPromise = Promise.resolve();
        console.log(`Library of ${version} has been locked`);
      } else {
        const col = new GroupTaskCollector()

        for (
          const { downloads: libInfo, name: libName } of mcPackage.libraries
        ) {
          if (libInfo.artifact) {
            col.collect(
              `${task.name}:library:${libName}`
            ,this.library(libInfo.artifact))
          }
          if (libInfo.classifiers) {
            for (const [type, lib] of Object.entries(libInfo.classifiers)) {
              col.collect(
                `${task.name}:library:${libName}:classifiers:${type}`
              , this.library(lib));
            }
          }
        }

        libraryPromise = queueGroup(`${task.name}:library`, col.group).then(() =>
          this.storage.lock(libraryLock)
        );
      }

      startLongPhase();
      await Promise.all([assetIndexRunning, downloads, libraryPromise, logging]);
      stopLongPhase();

      await this.storage.cacheFile(target, data);
    };
  }

  execute() {
    return this.tasks.queue(
      "minecraft",
      async ({ startLongPhase, stopLongPhase, task, queue }) => {
        const [, manifest] = await fetchMinecraftVersionManifest();
        const targetManifest = await this.readTargetMinecraftMeta();

        const targetVersionSet = new Set(
          targetManifest.versions.map((ver) => ver.id),
        );

        const selectedVersionMetas = manifest.versions.filter(
          this.versionSelector,
        );
        const successSyncSet = new Set<string>();
        const errorSyncSet = new Set<string>();

        const pros: any[] = [];
        for (const ver of selectedVersionMetas) {
          pros.push(
            queue(`${task.name}:${ver.id}`, this.createVersion(ver)).then(
              () => {
                successSyncSet.add(ver.id);
              },
              (e) => {
                errorSyncSet.add(ver.id);
              },
            ),
          );
        }

        startLongPhase();
        await Promise.all(pros);
        stopLongPhase();

        // 版本更新有两个策略
        // 针对没有更新过的版本，直接对其进行更新，并返回远端的元信息
        // 针对已经更新过的版本，同样要进行更新，然后如果更新成功，就是用远端的元信息，否则是用旧的

        let releaseVersion = "";
        let snapshotVersion = "";

        const versions: MinecraftVersion[] = [];

        for (const ver of manifest.versions) {
          const version = ver.id;
          if (successSyncSet.has(version)) {
            // 更新成功直接使用新版的
            versions.push(ver);
          } else if (targetVersionSet.has(version)) {
            // 本地存在的版本并且没有得到更新的话，直接使用本地数据
            const oldVer = targetManifest.versions.find((ov) =>
              ov.id === version
            );
            if (oldVer) {
              versions.push(oldVer);
            }
          }
        }

        // 这边每次都获取最新的信息，无需关心更新是否成功
        for (const ver of versions) {
          if (!snapshotVersion) {
            snapshotVersion = ver.id;
          }
          if (ver.type === MinecraftVersionType.RELEASE) {
            if (!releaseVersion) {
              releaseVersion = ver.id;
            }
          }
        }

        const newManifest: MinecraftVersionManifest = {
          latest: {
            release: releaseVersion,
            snapshot: snapshotVersion,
          },
          versions,
        };

        await this.storage.cacheFile(
          minecraftMetaTarget,
          new TextEncoder().encode(JSON.stringify(newManifest)),
          true,
        );
        if (errorSyncSet.size) {
          console.log(
            `Sync error for ${
              Array.from(errorSyncSet.values()).map((v) => colors.cyan(v)).join(
                ", ",
              )
            } sync error`,
          );
        } else {
          console.log(
            `Sync success for ${
              Array.from(successSyncSet.values()).map((v) => colors.cyan(v))
                .join(", ")
            }`,
          );
        }
      },
    );
  }

  private async readTargetMinecraftMeta(): Promise<MinecraftVersionManifest> {
    if (await this.storage.exist(minecraftMetaTarget)) {
      return JSON.parse(await this.storage.layer.read(minecraftMetaTarget));
    }

    return {
      latest: {
        release: "",
        snapshot: "",
      },
      versions: [],
    };
  }

  private runAssetIndexCheck(
    { sha1: hash, id, url: source }: MinecraftPackageAssetIndex,
  ) {
    if (this.assetIndexCache.get(hash)) {
      return this.assetIndexCache.get(hash);
    }

    const target = getMetaStorageEndpoint(source);

    const promise = this.tasks.queue(
      `minecraft:asset-index:${id}`,
      async ({ queueGroup, task, startLongPhase, stopLongPhase }) => {
        if (await this.storage.exist(target)) {
          console.log(
            `Asset of ${id}(${hash}) has been locked`,
          );
          return;
        }

        const [data, json] = await fetchBinaryAndJson(source);

        const actualHash = sha1(data, "", "hex") as string;
        if (hash !== actualHash) {
          console.error(
            `(${id}) Fetch asset index maybe not correct, hash is not matched.`,
          );
          console.error(
            `  ${hash}(expected) !== ${actualHash}(actual)`,
          );
          console.error(`  Please restart sync again`);
          throw new Error(`${id} hash check failed`);
        }

        const exes: GroupTaskExecutor = {};

        for (const { hash } of Object.values(json.objects) as any[]) {
          exes[
            `${task.name}:${hash}`
          ] = this.createCacheResource(
            getAssetRemoteEndpoint(hash),
            getAssetStorageEndpoint(hash),
          );
        }

        startLongPhase();
        // 只要有一个资源下载失败，就没有必要再尝试下去了
        await queueGroup(`${task.name}:assets`, exes, true);
        stopLongPhase();

        await this.storage.cacheFile(
          target,
          data,
        );
      },
    );

    this.assetIndexCache.set(hash, promise);
    return promise;
  }
}
