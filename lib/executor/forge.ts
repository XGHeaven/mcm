import { StorageManager } from "../storage.ts";
import {
  TaskExecutor,
  TaskManager,
  GroupTaskCollector,
} from "../task/manager.ts";
import {
  byteToString,
  formatJarUrlPath,
  JarName,
  matchVersion,
  VersionSelector,
} from "../utils.ts";
import { fetchAndRetry, fetchBinaryAndJson } from "../service.ts";
import { JSZip, path } from "../deps.ts";
import { Libraries, LibraryExecutor } from "./_library.ts";

type ForgeVersions = Record<string, string[]>;
interface ForgeVersionMeta {
  classifiers: Record<string, ForgeVersionClassifier>;
}

type ForgeVersionClassifier = Record<string, string>;

interface ForgeNewInstallProfile {
  spec: string;
  libraries: Libraries;
  // 其他的暂时不重要
}

interface ForgeOldInstallProfile {
  // 暂时用不到，就不写了
  install: {};
  versionInfo: ForgeInstallProfileVersionInfo;
}

type ForgeInstallProfile = ForgeNewInstallProfile | ForgeOldInstallProfile;

interface ForgeInstallProfileVersionInfo {
  id: string;
  time: string;
  releaseTime: string;
  type: string;
  minecraftArguments: string;
  mainClass: string;
  inheritsFrom: string;
  jar: string;
  libraries: ForgeLibrary[];
  // others 不重要的不写了
}

interface ForgeLibrary {
  name: string;
  url?: string;
  serverreq?: boolean;
  clientreq?: boolean;
  checksums?: string[];
}

async function getInstallProfileJSON(
  jarData: Uint8Array,
): Promise<ForgeInstallProfile> {
  const zip = await JSZip.loadAsync(jarData);
  const jsonString: string = await zip.file("install_profile.json").async(
    "string",
  );
  return JSON.parse(jsonString);
}

export class ForgeExecutor {
  static Prefix = "/forge";
  static MavenPrefix = `${ForgeExecutor.Prefix}/maven`;
  static ForgePrefix = `${ForgeExecutor.Prefix}/maven/net/minecraftforge/forge`;
  static Host = "files.minecraftforge.net";
  static Maven = `https://${ForgeExecutor.Host}/maven`;
  static SourceVersionsUrl =
    `${ForgeExecutor.Maven}/net/minecraftforge/forge/maven-metadata.json`;
  static TargetVersionUrl = `${ForgeExecutor.ForgePrefix}/maven-metadata.json`;
  static PromotionsSlimUrl =
    `${ForgeExecutor.Maven}/net/minecraftforge/forge/promotions_slim.json`;
  static PromotionsUrl =
    `${ForgeExecutor.Maven}/net/minecraftforge/forge/promotions.json`;

  // forge 版本的元数据
  static sourceForgeVersionMeta = (forgeVersion: string) =>
    `${ForgeExecutor.Maven}/net/minecraftforge/forge/${forgeVersion}/meta.json`;
  static targetForgeVersionMeta = (forgeVersion: string) =>
    `${ForgeExecutor.ForgePrefix}/${forgeVersion}/meta.json`;

  static sourceForgeFile = (fullVersion: string, type: string, ext: string) =>
    `${ForgeExecutor.Maven}/net/minecraftforge/forge/${fullVersion}/forge-${fullVersion}-${type}.${ext}`;
  static targetForgeFile = (fullVersion: string, type: string, ext: string) =>
    `${ForgeExecutor.ForgePrefix}/${fullVersion}/forge-${fullVersion}-${type}.${ext}`;

  static getSourceLibrary(jarName: JarName | string) {
    return formatJarUrlPath(this.Maven, jarName);
  }
  static getTargetLibrary(jarName: JarName | string) {
    return formatJarUrlPath(this.MavenPrefix, jarName);
  }
  static getTargetLibraryFromUrl(url: string) {
    const parsed = new URL(url);
    return path.join(this.Prefix, parsed.pathname);
  }

  static installProfileLock = (fullVersion: string) =>
    `${ForgeExecutor.Prefix}/lock/${fullVersion}/install_profile.lock`;

  #storage: StorageManager;
  #tasks: TaskManager;
  #versionSelector: VersionSelector;
  #verify: boolean = false;
  #ignoreLock: boolean = false;
  #library: LibraryExecutor;
  #installerJarCache = new Map<string, Uint8Array>();

  constructor(
    config: {
      storage: StorageManager;
      tasks: TaskManager;
      versionSelector: VersionSelector;
      verify?: boolean;
      ignoreLock?: boolean;
    },
  ) {
    this.#storage = config.storage;
    this.#tasks = config.tasks;
    this.#versionSelector = config.versionSelector;
    this.#verify = !!config.verify;
    this.#ignoreLock = !!config.ignoreLock;
    this.#library = new LibraryExecutor(
      { storage: this.#storage, ignoreLock: this.#ignoreLock },
    );
  }

  execute() {
    return this.#tasks.queue("forge", async ({ queue, waitTask }) => {
      const [_, sourceVersions] = await fetchBinaryAndJson<ForgeVersions>(
        ForgeExecutor.SourceVersionsUrl,
      );
      const targetVersions = await this.readTargetVersions();

      const selectedVersions = this.selectedVersions(
        sourceVersions,
        targetVersions,
      );

      const promises: any[] = [];
      const successGameVersions = new Set<string>();
      for (
        const [gameVersion, fullVersions] of Object.entries(selectedVersions)
      ) {
        promises.push(
          queue(
            `${gameVersion}`,
            this.createGameVersion(gameVersion, fullVersions),
          ).then(() => {
            successGameVersions.add(gameVersion);
          }).catch((e) => {
            console.log(e);
          }),
        );
      }

      await waitTask(Promise.all(promises));

      const newVersions = Object.entries(sourceVersions).reduce(
        (versions, [gameVersion, sourceFullVersions]) => {
          const targetFullVersions = targetVersions[gameVersion];
          const successFullVersions = selectedVersions[gameVersion];
          const isSuccess = successGameVersions.has(gameVersion);

          if (isSuccess) {
            if (targetFullVersions) {
              // 如果成功而且也缓存了，就按照原先的顺序取并集
              versions[gameVersion] = sourceFullVersions.filter((version) =>
                targetFullVersions.includes(version) ||
                successFullVersions.includes(version)
              );
            } else {
              // 如果成功但没有缓存，就直接缓存
              versions[gameVersion] = successFullVersions;
            }
          } else {
            // 如果缓存了但是本次更新失败了，就直接用缓存的数据
            versions[gameVersion] = targetFullVersions;
          }
          return versions;
        },
        {} as ForgeVersions,
      );

      await this.#storage.cacheJSON(
        ForgeExecutor.TargetVersionUrl,
        new TextEncoder().encode(JSON.stringify(newVersions)),
        true,
      );
    });
  }

  private createForgeVersion(version: string): TaskExecutor {
    return async ({ waitTask, queueGroup, runTask }) => {
      const sourceUrl = ForgeExecutor.sourceForgeVersionMeta(version);
      const targetUrl = ForgeExecutor.targetForgeVersionMeta(version);

      if (!this.#ignoreLock && await this.#storage.exist(targetUrl)) {
        console.log(`forge version ${version} already synced`);
        return;
      }
      const [data, json] = await fetchBinaryAndJson<ForgeVersionMeta>(
        sourceUrl,
      );

      const gc = new GroupTaskCollector();
      for (const [type, extHash] of Object.entries(json.classifiers)) {
        for (const [ext] of Object.entries(extHash)) {
          gc.collect(
            `${type}-${ext}`,
            this.createForgeFile(version, type, ext),
          );
        }
      }

      await waitTask(queueGroup("classifiers", gc.group));

      const installerLock = ForgeExecutor.installProfileLock(version);
      if (
        !this.#ignoreLock && json.classifiers["installer"] &&
        !await this.#storage.isLock(installerLock)
      ) {
        const jarData = this.#installerJarCache.get(version) ??
          await this.#storage.layer.read(
            ForgeExecutor.targetForgeFile(version, "installer", "jar"),
          );
        const profile = await getInstallProfileJSON(jarData);

        if ("install" in profile && "versionInfo" in profile) {
          // 旧版本 forge installer
          await runTask(
            this.#library.createLibraries(profile.versionInfo.libraries),
          );
        } else if ("spec" in profile && "libraries" in profile) {
          // 新版本 forge installer
          await runTask(this.#library.createLibraries(profile.libraries));
        } else {
          return Promise.reject(
            new Error(`Unknown install profile of ${version}`),
          );
        }

        await this.#storage.lock(installerLock);
      }

      await this.#storage.cacheJSON(targetUrl, data);
    };
  }

  private createForgeFile(
    fullVersion: string,
    type: string,
    ext: string,
  ): TaskExecutor {
    return async () => {
      const source = ForgeExecutor.sourceForgeFile(fullVersion, type, ext);
      const target = ForgeExecutor.targetForgeFile(fullVersion, type, ext);
      if (type === "installer" && ext === "jar") {
        if (!await this.#storage.exist(target)) {
          const resp = await fetchAndRetry(source);
          const jarData = new Uint8Array(await resp.arrayBuffer());
          await this.#storage.layer.write(
            target,
            jarData,
            { type: resp.headers.get("content.type") || "" },
          );
          this.#installerJarCache.set(fullVersion, jarData);
        }
        return;
      }
      await this.#storage.cacheRemoteFile(source, target);
    };
  }

  private createGameVersion(
    gameVersion: string,
    forgeVersions: string[],
  ): TaskExecutor {
    return async ({ waitTask, queue }) => {
      await waitTask(
        Promise.all(forgeVersions.map((version) =>
          queue(`${version}`, this.createForgeVersion(version))
        )),
      );
    };
  }

  private async readTargetVersions(): Promise<ForgeVersions> {
    if (await this.#storage.layer.exist(ForgeExecutor.TargetVersionUrl)) {
      return JSON.parse(
        byteToString(
          await this.#storage.layer.read(ForgeExecutor.TargetVersionUrl),
        ),
      );
    }

    return {};
  }

  private selectedVersions(
    sourceVersions: ForgeVersions,
    targetVersions: ForgeVersions = {},
  ): ForgeVersions {
    const { matchers, diff } = this.#versionSelector;
    const sourceKeys = Object.keys(sourceVersions);

    return sourceKeys.filter((version) => {
      return matchers.some((matcher) => matchVersion(version, matcher));
    }).reduce((acc, version) => {
      let sourceForgeVersions = sourceVersions[version];

      if (diff) {
        const targetForgeVersions = targetVersions[version];
        if (targetForgeVersions) {
          sourceForgeVersions = sourceForgeVersions.filter((ver) =>
            !targetForgeVersions.includes(ver)
          );
        }
      }

      if (sourceForgeVersions.length) {
        acc[version] = sourceForgeVersions;
      }

      return acc;
    }, {} as ForgeVersions);
  }
}
