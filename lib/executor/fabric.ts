import { Storage } from "../storage.ts";
import { fetchBinaryAndJson, fetchJSON } from "../service.ts";
import { path } from "../deps.ts";
import {
  TaskManager,
  TaskExecutor,
  GroupTaskCollector,
} from "../task/manager.ts";
import { matchVersion, VersionSelector, byteToString } from "../utils.ts";

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

export interface InstallerMeta {
  url: string;
  maven: string;
  version: string;
  stable: boolean;
}

export interface FabricMeta {
  game: GameVersion[];
  mappings: FabricMapping[];
  intermediary: IntermediaryVersion[];
  loader: LoaderVersion[];
  installer: InstallerMeta[];
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

export interface LoaderOfGameMeta {
  loader: LoaderVersion;
  intermediary: IntermediaryVersion;
  launcherMeta: LoaderLauncherMeta;
}

/**
 * Fabric 的整体架构分为三层
 * - mapping 用于抹平不同版本之间的 api 差异。游戏版本相关并且是一对多的关系
 * - intermediary 用于提供一致的 api 层。游戏版本相关但只是一对一关系
 * - loader 用于加载模组。游戏版本无关
 */
export class FabricExecutor {
  static EndpointPrefix = "/fabric";
  static MavenEndpoint = `${FabricExecutor.EndpointPrefix}/maven`;
  static MetaEndpoint = `${FabricExecutor.EndpointPrefix}/meta`;
  static FabricMetaHost = "https://meta.fabricmc.net";
  static FabricMavenHost = "https://maven.fabricmc.net";
  static UrlPrefix = `/v2/versions`;

  constructor(
    private storage: Storage,
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
    const ext = this.storage.isSupportSameFileFolder() ? "" : ".json";
    return [
      url.toString(),
      path.join(FabricExecutor.MetaEndpoint, pathname) + ext,
    ];
  }

  private getSourceMeta(uri: string = "") {
    const url = new URL(FabricExecutor.FabricMetaHost);
    url.pathname = path.join(FabricExecutor.UrlPrefix, uri);
    return url.toString();
  }

  private getTargetMeta(uri: string = "") {
    const ext = this.storage.isSupportSameFileFolder() ? "" : ".json";
    return path.join(
      FabricExecutor.MetaEndpoint,
      FabricExecutor.UrlPrefix,
      uri,
    ) + ext;
  }

  // 对一些 endpoint 不变以及内容发生变化的 json 进行更新
  async storeMeta(metas: FabricMeta) {
    const gameVersions = new Set<string>(
      metas.game.map((ver) => ver.version),
    );

    const cacheTo = async (uri: string, json: any) => {
      const target = this.getTargetMeta(uri);
      await this.storage.cacheJSON(target, JSON.stringify(json));
    };

    const selectGame = async (uri: string) => {
      const [source, target] = this.getMetaPairPath(uri);
      const games = await fetchJSON<GameVersion[]>(source);

      await this.storage.cacheJSON(
        target,
        JSON.stringify(games.filter((ver) => gameVersions.has(ver.version))),
      );
    };

    await Promise.all([
      cacheTo("/game", metas.game),
      selectGame("/game/yarn"),
      selectGame("/game/intermediary"),
      cacheTo("/yarn", metas.mappings),
      cacheTo("/loader", metas.loader),
    ]);
  }

  private createMavenJar(maven: string): TaskExecutor {
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

  private createIntermediaryOfGame(gameVersion: string): TaskExecutor {
    return async () => {
      const [source, target] = this.getMetaPairPath(
        `/intermediary/${gameVersion}`,
      );
      await this.storage.cacheRemoteFile(source, target, true);
      // 因为 loader 会去加载相关的 maven，所以这里不需要缓存
    };
  }

  createVersion(gameVersion: string): TaskExecutor {
    return async (
      { queue, queueGroup, waitTask },
    ) => {
      const [metaSource, metaTarget] = this.getMetaPairPath(
        `/loader/${gameVersion}`,
      );
      const sourceLoaderOfGame = await fetchJSON<LoaderOfGameMeta[]>(
        metaSource,
      );
      const currentLoaderOfGame = await this.getTargetLoaderOfGame(gameVersion);

      const syncedLoaderVersion = new Set<string>(
        currentLoaderOfGame.map(({ loader }) => loader.version),
      );

      const interTask = queue(
        `intermediary:${gameVersion}`,
        this.createIntermediaryOfGame(gameVersion),
      );

      const loaderCollect = new GroupTaskCollector();

      const mavenSet = new Set<string>();

      const collectMaven = (lib: LoaderLauncherMetaLibrary) => {
        if (lib.url && lib.url.startsWith(FabricExecutor.FabricMavenHost)) {
          mavenSet.add(lib.name);
        }
      };

      const loaderOfGame = this.versionSelector.diff
        ? sourceLoaderOfGame.filter((loader) =>
          syncedLoaderVersion.has(loader.loader.version)
        )
        : sourceLoaderOfGame;

      for (const loaderMeta of loaderOfGame) {
        const { loader, intermediary, launcherMeta } = loaderMeta;
        mavenSet.add(loader.maven);
        mavenSet.add(intermediary.maven);

        launcherMeta.libraries.common.forEach(collectMaven);
        launcherMeta.libraries.client.forEach(collectMaven);
        launcherMeta.libraries.server.forEach(collectMaven);

        loaderCollect.collect(`${loader.version}`, async () => {
          await this.storage.cacheJSON(
            this.getTargetMeta(`/loader/${gameVersion}/${loader.version}`),
            new TextEncoder().encode(JSON.stringify(loaderMeta)),
          );
        });
      }

      const mavenCollect = new GroupTaskCollector();
      for (const maven of mavenSet) {
        mavenCollect.collect(`${maven}`, this.createMavenJar(maven));
      }

      await waitTask(
        Promise.all(
          [
            interTask,
            queueGroup(`loader`, loaderCollect.group),
            queueGroup("maven", mavenCollect.group),
          ],
        ),
      );
      await this.storage.cacheJSON(
        metaTarget,
        new TextEncoder().encode(JSON.stringify(sourceLoaderOfGame)),
        true,
      );
    };
  }

  execute() {
    return this.tasks.queue("fabric", async ({ queue, waitTask }) => {
      const [source, target] = this.getMetaPairPath();
      const metas = await fetchJSON<FabricMeta>(
        source,
      );

      const selectedVersion = this.selectVersion(metas);
      const successVersions = new Set<string>();
      const syncedVersions = new Set<string>();

      const versionPromises = selectedVersion.map((gameVersion) =>
        queue(
          `${gameVersion.version}`,
          this.createVersion(gameVersion.version),
        ).then(() => {
          successVersions.add(gameVersion.version);
        })
      );

      await waitTask(
        Promise.all(
          [
            versionPromises,
            queue("installer", this.createInstaller(metas.installer)),
          ],
        ),
      );

      const newMetas: FabricMeta = {
        game: metas.game.filter((game) => {
          const version = game.version;
          return successVersions.has(version) || syncedVersions.has(version);
        }),
        mappings: metas.mappings.filter((mapping) => {
          const version = mapping.gameVersion;
          return successVersions.has(version) || syncedVersions.has(version);
        }),
        intermediary: metas.intermediary.filter((inter) => {
          const version = inter.version;
          return successVersions.has(version) || syncedVersions.has(version);
        }),
        loader: metas.loader,
        installer: metas.installer,
      };

      await this.storeMeta(newMetas);
      await this.storage.cacheJSON(
        target,
        JSON.stringify(newMetas),
        true,
      );
    });
  }

  private async getTargetLoaderOfGame(
    version: string,
  ): Promise<LoaderOfGameMeta[]> {
    const target = this.getTargetMeta(`/loader/${version}`);
    if (await this.storage.exist(target)) {
      return JSON.parse(byteToString(await this.storage.read(target)));
    }

    return [];
  }

  private createInstaller(sourceInstaller: InstallerMeta[]): TaskExecutor {
    return async ({ waitTask, queue }) => {
      await waitTask(
        Promise.all(sourceInstaller.map((installer) =>
          queue(`${installer.version}`, this.createMavenJar(installer.maven))
        )),
      );
    };
  }

  private selectVersion(
    sourceManifest: FabricMeta,
    targetManifest?: FabricMeta,
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
