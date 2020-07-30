import { fetchBinaryAndJson } from "../service.ts";
import { Storage } from "../storage.ts";
import { colors, hash, path } from "../deps.ts";
import {
  GroupTaskExecutor,
  TaskExecutor,
  TaskManager,
} from "../task/manager.ts";
import {
  byteToString,
  formatJarUrlPath,
  JarName,
  matchVersion,
  VersionSelector,
} from "../utils.ts";
import { Library, LibraryExecutor } from "./_library.ts";

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
const minecraftMetaTarget = getMetaStorageEndpoint(
  getMinecraftMetaRemoteEndpoint(),
);

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
  OLD_ALPHA = "old_alpha",
  OLD_BETA = "old_beta",
}

interface MinecraftVersion {
  id: string;
  type: MinecraftVersionType;
  url: string;
  time: Date;
  releaseTime: Date;
}

interface MinecraftVersionManifest {
  latest: {
    release: string;
    snapshot: string;
  };
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
  libraries: Library[];
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
  static Prefix = "/minecraft";
  static LibraryPrefix = `${MinecraftExecutor.Prefix}/libraries`;
  static LibraryHost = "libraries.minecraft.net";
  static LibraryOrigin = `https://${MinecraftExecutor.LibraryHost}`;

  static getSourceLibrary(jarName: string | JarName) {
    return formatJarUrlPath(MinecraftExecutor.LibraryOrigin, jarName);
  }
  static getTargetLibrary(jarName: string | JarName) {
    return formatJarUrlPath(this.LibraryPrefix, jarName);
  }
  static getTargetLibraryFromUrl(url: string) {
    const parsedUrl = new URL(url);
    return path.join(this.LibraryPrefix, parsedUrl.pathname);
  }

  #library: LibraryExecutor;
  #assetIndexCache: Map<string, Promise<any>> = new Map();

  constructor(
    private storage: Storage,
    private tasks: TaskManager,
    private versionSelector: VersionSelector,
    private options: { verify?: boolean; ignoreLock?: boolean } = {},
  ) {
    this.#library = new LibraryExecutor(
      { storage, ignoreLock: !!options.ignoreLock },
    );
  }

  private createCacheResource(source: string, target: string): TaskExecutor {
    return async () => this.storage.cacheRemoteFile(source, target);
  }

  private tryCacheAssetIndex(
    assetIndex: MinecraftPackageAssetIndex,
  ): TaskExecutor {
    const { sha1: hash } = assetIndex;
    return async ({ waitTask, runTask }) => {
      const promise = this.#assetIndexCache.get(hash);
      if (promise) {
        await waitTask(promise);
      } else {
        const task = runTask(this.createAssetIndexCheck(assetIndex));
        this.#assetIndexCache.set(hash, task);
        await task;
      }
    };
  }

  private createVersion(versionMeta: MinecraftVersion): TaskExecutor {
    const { id: version, url: source } = versionMeta;
    const target = getMetaStorageEndpoint(source);
    const versionHash = source.split("/").slice(-2)[0];
    const libraryLock = getLibraryLockEndpoint(version, versionHash);

    return async (
      { queue, queueGroup, waitTask, runTask },
    ) => {
      if (!this.options.ignoreLock && await this.storage.exist(target)) {
        console.log(`Version ${version} has been cached, skip...`);
        return;
      }

      const [data, mcPackage] = await fetchMinecraftPackage(source);

      const assetIndexRunning = queue(
        `assetIndex`,
        this.tryCacheAssetIndex(mcPackage.assetIndex),
      );

      const downloads = queueGroup(
        `downloads`,
        Object.entries(mcPackage.downloads).reduce((exes, [type, download]) => {
          exes[`${type}`] = this.createCacheResource(
            download.url,
            getLauncherEndpoint(download.url),
          );
          return exes;
        }, {} as GroupTaskExecutor),
      );

      const loggingUrl = mcPackage?.logging?.client?.file?.url;
      const logging = loggingUrl
        ? queue(
          `logging`,
          this.createCacheResource(loggingUrl, getLauncherEndpoint(loggingUrl)),
        )
        : Promise.resolve();

      let libraryPromise: Promise<void>;

      if (!this.options.ignoreLock && await this.storage.isLock(libraryLock)) {
        libraryPromise = Promise.resolve();
        console.log(`Library of ${version} has been locked`);
      } else {
        libraryPromise = runTask(
          this.#library.createLibraries(mcPackage.libraries),
        ).then(() => this.storage.lock(libraryLock));
      }

      await waitTask(Promise.all(
        [assetIndexRunning, downloads, libraryPromise, logging],
      ));

      await this.storage.cacheJSON(target, data);
    };
  }

  execute() {
    return this.tasks.queue(
      "minecraft",
      async ({ waitTask, queue }) => {
        const [, manifest] = await fetchMinecraftVersionManifest();
        const targetManifest = await this.readTargetMinecraftMeta();

        const targetVersionSet = new Set(
          targetManifest.versions.map((ver) => ver.id),
        );

        const selectedVersionMetas = this.selectVersion(
          manifest,
          targetManifest,
        );
        const successSyncSet = new Set<string>();
        const errorSyncSet = new Set<string>();
        const errorMap = new Map<string, any>();

        const pros: any[] = [];
        for (const ver of selectedVersionMetas) {
          pros.push(
            queue(`${ver.id}`, this.createVersion(ver)).then(
              () => {
                successSyncSet.add(ver.id);
              },
              (e) => {
                errorSyncSet.add(ver.id);
                errorMap.set(ver.id, e);
              },
            ),
          );
        }

        await waitTask(Promise.all(pros));

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
            `${colors.red("sync error")}:`,
          );
          for (const id of errorSyncSet) {
            const error = errorMap.get(id);
            console.log(
              `${colors.red("-")} ${colors.cyan(id)} ${error && error.message}`,
            );
          }
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

  async executeList() {
    const [, manifest] = await fetchMinecraftVersionManifest();
    const targetManifest = await this.readTargetMinecraftMeta();
    const selectedVersionMetas = this.selectVersion(manifest, targetManifest);

    for (const verMeta of selectedVersionMetas) {
      console.log(
        `${colors.green("list")} minecraft ${verMeta.id} \t${
          colors.bold(
            targetManifest.versions.find((ver) => ver.id === verMeta.id)
              ? "synced"
              : "no-sync",
          )
        }\t ${
          verMeta.type !== MinecraftVersionType.RELEASE
            ? colors.gray(verMeta.type)
            : ""
        }`,
      );
    }
  }

  private selectVersion(
    sourceManifest: MinecraftVersionManifest,
    targetManifest?: MinecraftVersionManifest,
  ): MinecraftVersion[] {
    const { matchers, release, diff, snapshot, latest, old } =
      this.versionSelector;
    if (latest) {
      // 如果选择了最新的，忽略所有 matcher
      const selected: MinecraftVersion[] = [];
      if (release && sourceManifest.latest.release) {
        const ver = sourceManifest.versions.find((ver) =>
          ver.id === sourceManifest.latest.release
        );
        if (ver) {
          selected.push(ver);
        }
      }

      if (snapshot && sourceManifest.latest.snapshot) {
        const ver = sourceManifest.versions.find((ver) =>
          ver.id === sourceManifest.latest.snapshot
        );
        if (ver) {
          selected.push(ver);
        }
      }

      if (old) {
        console.log(`old beta cannot have latest version`);
      }

      return selected;
    }

    return sourceManifest.versions.filter((ver) => {
      let ret = matchers.some((matcher) => matchVersion(ver.id, matcher));

      if (ret) {
        switch (ver.type) {
          case MinecraftVersionType.SNAPSHOT:
            ret = snapshot;
            break;
          case MinecraftVersionType.RELEASE:
            ret = release;
            break;
          case MinecraftVersionType.OLD_BETA:
          case MinecraftVersionType.OLD_ALPHA:
            ret = old;
            break;
        }
      }

      if (ret && diff && targetManifest) {
        const targetVer = targetManifest.versions.find((v) => v.id === ver.id);
        if (targetVer) {
          ret = targetVer.url !== ver.url ||
            targetVer.releaseTime !== ver.releaseTime;
        }
      }

      return ret;
    });
  }

  private async readTargetMinecraftMeta(): Promise<MinecraftVersionManifest> {
    if (await this.storage.exist(minecraftMetaTarget)) {
      return JSON.parse(
        byteToString(await this.storage.read(minecraftMetaTarget)),
      );
    }

    return {
      latest: {
        release: "",
        snapshot: "",
      },
      versions: [],
    };
  }

  private createAssetIndexCheck(
    { sha1: expectHash, id, url: source }: MinecraftPackageAssetIndex,
  ): TaskExecutor {
    const target = getMetaStorageEndpoint(source);

    return async ({ queueGroup, waitTask }) => {
      if (!this.options.ignoreLock && await this.storage.exist(target)) {
        console.log(
          `Asset of ${id}(${expectHash}) has been locked`,
        );
        return;
      }

      const [data, json] = await fetchBinaryAndJson(source);

      const actualHash = hash.createHash("sha1").update(data).toString("hex");
      if (expectHash !== actualHash) {
        console.error(
          `(${id}) Fetch asset index maybe not correct, hash is not matched.`,
        );
        console.error(
          `  ${expectHash}(expected) !== ${actualHash}(actual)`,
        );
        console.error(`  Please restart sync again`);
        throw new Error(`${id} hash check failed`);
      }

      const exes: GroupTaskExecutor = {};

      for (const { hash } of Object.values(json.objects) as any[]) {
        exes[
          `${hash}`
        ] = this.createCacheResource(
          getAssetRemoteEndpoint(hash),
          getAssetStorageEndpoint(hash),
        );
      }

      // 只要有一个资源下载失败，就没有必要再尝试下去了
      await waitTask(queueGroup(`assets`, exes, true));

      await this.storage.cacheJSON(
        target,
        data,
      );
    };
  }
}
