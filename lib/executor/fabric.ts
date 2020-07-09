import { StorageManager } from "../storage.ts";
import { fetchBinaryAndJson } from "../service.ts";
import { path } from "../deps.ts";
import {
  TaskManager,
  TaskExecutor,
  GroupTaskCollector,
} from "../task/manager.ts";
import { matchVersion, VersionSelector } from "../utils.ts";

export interface GameVersion {
  version: string;
  stable: boolean;
}

export interface FabricMapping {
  gameVersion: string;
  separator: string;
  build: number;
  maven: string;
  version: string;
  stable: boolean;
}

export interface IntermediaryVersion {
  maven: string;
  version: string;
  stable: boolean;
}

export interface LoaderVersion {
  separator: string;
  build: number;
  maven: string;
  version: string;
  stable: boolean;
}

export interface InstallInfo {
  url: string;
  maven: string;
  version: string;
  stable: boolean;
}

export interface AllVersions {
  game: GameVersion[];
  mappings: FabricMapping[];
  intermediary: IntermediaryVersion[];
  loader: LoaderVersion[];
  installer: InstallInfo[];
}

export interface LoaderLauncherMeta {
  version: number;
  libraries: {
    client: LoaderLauncherMetaLibrary[];
    common: LoaderLauncherMetaLibrary[];
    server: LoaderLauncherMetaLibrary[];
  };
  mainClass: {
    server: string;
    client: string;
  };
}

export interface LoaderLauncherMetaLibrary {
  _comment?: string;
  name: string;
  url?: string;
}

export class FabricExecutor {
  static EndpointPrefix = "/fabric";
  static MavenEndpoint = `${FabricExecutor.EndpointPrefix}/maven`;
  static MetaEndpoint = `${FabricExecutor.EndpointPrefix}/meta`;
  static FabricMetaHost = "https://meta.fabricmc.net";
  static FabricMavenHost = "https://maven.fabricmc.net";
  static UrlPrefix = `/v2/versions`;

  private allVersions!: AllVersions;

  constructor(
    private storage: StorageManager,
    private tasks: TaskManager,
    private versionSelector: VersionSelector,
  ) {}

  /**
   * 获取上游的 url 以及本地存储的文件名。
   * 因为存在 API URL => File Layer 的问题，也就是说文件系统不允许存在同名的文件和文件夹，
   * 所以这边在转存的时候会自动添加 .json 后缀，保证不重名
   */
  getMetaPairPath(uri: string = ""): [string, string] {
    const url = new URL(FabricExecutor.FabricMetaHost);
    const pathname = path.join(FabricExecutor.UrlPrefix, uri);
    url.pathname = pathname;
    const ext = this.storage.layer.isSupportSameFileFolder() ? "" : ".json";
    return [
      url.toString(),
      path.join(FabricExecutor.MetaEndpoint, pathname) + ext,
    ];
  }

  // 对一些 endpoint 不变以及内容发生变化的 json 进行更新
  updateJSON: TaskExecutor = async () => {
    const resource = [
      "/game",
      "/game/yarn",
      "/game/intermediary",
      "/intermediary",
      "/yarn",
      "/loader",
    ];
    for (const res of resource) {
      const [remote, target] = this.getMetaPairPath(res);
      await this.storage.cacheRemoteFile(remote, target, true);
    }
  };

  createMavenJar(maven: string) {
    const [group, name, version] = maven.split(":");
    const uri = path.join(
      "/",
      group.split(".").join("/"),
      name,
      version,
      `${name}-${version}.jar`,
    );
    return async () => {
      await this.storage.cacheRemoteFile(
        `${FabricExecutor.FabricMavenHost}${uri}`,
        `${FabricExecutor.MavenEndpoint}${uri}`,
      );
    };
  }

  // 根据游戏版本获取对应的 Loader，并递归获取下面的 loader 的 meta
  createLoaderOfGame(gameVersion: string): TaskExecutor {
    return async ({ queue }) => {
      const [source, target] = this.getMetaPairPath(`/loader/${gameVersion}`);
      const [data, loaders] = await fetchBinaryAndJson<
        Array<{
          loader: LoaderVersion;
          intermediary: IntermediaryVersion;
          launcherMeta: LoaderLauncherMeta;
        }>
      >(source);

      const mavenSet = new Set<string>();

      const collectMaven = (lib: LoaderLauncherMetaLibrary) => {
        if (lib.url && lib.url.startsWith(FabricExecutor.FabricMavenHost)) {
          mavenSet.add(lib.name);
        }
      };

      for (const { loader, intermediary, launcherMeta } of loaders) {
        mavenSet.add(loader.maven);
        mavenSet.add(intermediary.maven);

        launcherMeta.libraries.common.forEach(collectMaven);
        launcherMeta.libraries.client.forEach(collectMaven);
        launcherMeta.libraries.server.forEach(collectMaven);

        queue(`${loader.version}`, async () => {
          const [source, target] = this.getMetaPairPath(
            `/loader/${gameVersion}/${loader.version}`,
          );
          await this.storage.cacheRemoteFile(source, target);
        });
      }

      for (const maven of mavenSet) {
        queue(`maven:${maven}`, this.createMavenJar(maven));
      }

      await this.storage.cacheJSON(target, data, true);
    };
  }

  createIntermediaryOfGame(gameVersion: string): TaskExecutor {
    return async () => {
      const [source, target] = this.getMetaPairPath(
        `/intermediary/${gameVersion}`,
      );
      await this.storage.cacheRemoteFile(source, target, true);
      // 因为 loader 会去加载相关的 maven，所以这里不需要缓存
    };
  }

  createVersion(version: string): TaskExecutor {
    return async (
      { queue, queueGroup },
    ) => {
      queue(
        `loader:${version}`,
        this.createLoaderOfGame(version),
      );
      queue(
        `intermediary:${version}`,
        this.createIntermediaryOfGame(version),
      );

      const col = new GroupTaskCollector();

      for (const mapping of this.allVersions.mappings) {
        if (mapping.gameVersion === version) {
          col.collect(
            `${mapping.version}`,
            this.createMavenJar(mapping.maven),
          );
        }
      }

      queueGroup(`mappings`, col.group);
    };
  }

  execute() {
    return this.tasks.queue("fabric", async ({ queue, queueGroup }) => {
      if (!this.allVersions) {
        const [source, target] = this.getMetaPairPath();
        const [data, allVersions] = await fetchBinaryAndJson<AllVersions>(
          source,
        );
        this.allVersions = allVersions;
        await this.storage.cacheJSON(target, data, true);
      }

      const gvc = new GroupTaskCollector();

      const selectedVersion = this.selectVersion(this.allVersions);

      for (const gameVersion of selectedVersion) {
        gvc.collect(
          `${gameVersion.version}`,
          this.createVersion(gameVersion.version),
        );
      }

      queue(`json`, this.updateJSON);
      queueGroup(`versions`, gvc.group);
    });
  }

  private selectVersion(
    sourceManifest: AllVersions,
    targetManifest?: AllVersions,
  ): GameVersion[] {
    const { matchers, snapshot, release, latest, diff } = this.versionSelector;

    if (latest) {
      return sourceManifest.game.slice(0, 1);
    }

    return sourceManifest.game.filter((gameVersion) => {
      let ret = matchers.some((matcher) =>
        matchVersion(gameVersion.version, matcher)
      );

      if (ret && release) {
        ret = !!gameVersion.stable;
      } else if (ret && snapshot) {
        ret = !gameVersion.stable;
      }

      if (ret && diff) {
        console.log(`WARN: fabric cannot support "diff" now`);
      }

      return ret;
    });
  }
}
