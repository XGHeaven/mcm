import { Storage } from "../storage.ts";
import {
  GroupTaskCollector,
  TaskExecutor,
  TaskManager,
} from "../task/manager.ts";
import { path, colors } from "../deps.ts";
import { fetchJSON } from "../service.ts";
import { VersionSelector } from "../utils.ts";

interface AddonSynced {
  id: number;
  name: string;
  firstSyncDate: string;
}

interface Addon {
  id: number;
  name: string;
}

interface AddonFile {
  id: number;
  downloadUrl: string;
  fileName: string;
  displayName: string;
}

export class CurseExecutor {
  static readonly Prefix = "/curse";
  static readonly AddonPrefix = `${CurseExecutor.Prefix}/api/v2/addon`;
  static readonly ApiHost = "https://addons-ecs.forgesvc.net";
  static readonly AddonListPath = `${CurseExecutor.Prefix}/addons.json`;

  // 转化 edge.forgecdn.net 的资源
  static toFilePath(downloadUrl: string) {
    return path.join(CurseExecutor.Prefix, new URL(downloadUrl).pathname);
  }

  #storage: Storage;
  #task: TaskManager;
  #version: VersionSelector;
  #addonSynced: Map<number, AddonSynced> = new Map();

  constructor(config: {
    storage: Storage;
    task: TaskManager;
    versionSelector: VersionSelector;
  }) {
    this.#storage = config.storage;
    this.#task = config.task;
    this.#version = config.versionSelector;
  }

  private getAddonPairPath(uri: string): [string, string] {
    const pathname = path.join(CurseExecutor.AddonPrefix, uri);
    const sourceUrl = new URL(CurseExecutor.ApiHost);
    sourceUrl.pathname = path.join(`/api/v2/addon`, uri);
    return [
      sourceUrl.toString(),
      this.#storage.isSupportSameFileFolder() ? pathname : `${pathname}.json`,
    ];
  }

  private createFile(addonId: number, file: AddonFile): TaskExecutor {
    return async () => {
      const [, downloadApiTarget] = this.getAddonPairPath(
        `/${addonId}/file/${file.id}/download-url`,
      );
      await Promise.all([
        this.#storage.cacheRemoteFile(
          file.downloadUrl,
          CurseExecutor.toFilePath(file.downloadUrl),
        ),
        // this.#storage.cacheFile(downloadApiTarget, new TextEncoder().encode(file.downloadUrl))
      ]);
    };
  }

  private createAddon(id: number): TaskExecutor {
    return async ({ waitTask, queueGroup }) => {
      const [addonSource, addonTarget] = this.getAddonPairPath(`/${id}`);

      const [filesSource, filesTarget] = this.getAddonPairPath(`/${id}/files`);

      const sourceFiles = await fetchJSON<AddonFile[]>(filesSource);
      const targetFiles = await this.#storage.readJSONWithDefault<AddonFile[]>(
        filesTarget,
        [],
      );

      const syncedIds = new Set(targetFiles.map((file) => file.id));

      const files = this.#version.diff
        ? sourceFiles.filter((file) => !syncedIds.has(file.id))
        : sourceFiles;

      if (files.length !== 0) {
        const group = new GroupTaskCollector();

        for (const file of files) {
          group.collect(file.displayName, this.createFile(id, file));
        }

        await waitTask(queueGroup("files", group.group));

        await this.#storage.cacheJSON(filesTarget, JSON.stringify(sourceFiles));
      }

      await this.#storage.cacheRemoteFile(addonSource, addonTarget);
    };
  }

  execute() {
    return this.#task.queue("curse", async ({ waitTask, queueGroup }) => {
      let addons = await this.#storage.readJSONWithDefault<AddonSynced[]>(
        CurseExecutor.AddonListPath,
        [],
      );
      const { matchers } = this.#version;
      const syncedIds = new Set<number>(addons.map((addon) => addon.id));
      const newIds: number[] = [];
      const deleteIds: number[] = [];

      for (const matcher of matchers) {
        if (typeof matcher === "string" && matcher) {
          if (matcher[0] !== "-") {
            const id = parseInt(matcher, 10);
            if (id && !syncedIds.has(id)) {
              newIds.push(id);
            } else {
              console.log(`${matcher} is not valid or already added`);
            }
          } else {
            const id = parseInt(matcher.slice(1), 10);
            if (id && syncedIds.has(id)) {
              deleteIds.push(id);
            } else {
              console.log(`${matcher} is not valid or not added`);
            }
          }
        }
      }

      const group = new GroupTaskCollector();

      // 如果是添加删除任务，那么就只执行该任务
      if (newIds.length || deleteIds.length) {
        addons = addons.filter((addon) => !deleteIds.includes(addon.id));

        if (newIds.length) {
          for (const newId of newIds) {
            group.collect(`${newId}`, this.createAddon(newId));
          }
          await waitTask(queueGroup("new-addon", group.group));

          for (const newId of newIds) {
            const [addonSource, addonTarget] = this.getAddonPairPath(
              `/${newId}`,
            );
            const addonInfo = await this.#storage.readJSONFromBoth<Addon>(
              addonSource,
              addonTarget,
            );

            const now = new Date();
            addons.push({
              id: addonInfo.id,
              name: addonInfo.name,
              firstSyncDate: now.toISOString(),
            });
          }
        }
      } else {
        for (const addon of addons) {
          group.collect(`${addon.id}`, this.createAddon(addon.id));
        }

        await waitTask(queueGroup("addon", group.group));
      }

      // 虽然能保证 addons 里面不会有脏数据，但是为了保险，还是过滤一下
      await this.#storage.cacheJSON(
        CurseExecutor.AddonListPath,
        JSON.stringify(addons.filter(Boolean)),
        true,
      );
    });
  }

  async executeList() {
    const addons = await this.#storage.readJSONWithDefault<AddonSynced[]>(
      CurseExecutor.AddonListPath,
      [],
    );
    for (const addon of addons) {
      console.log(
        `${colors.green("list")} \t${
          colors.cyan(addon.id + "")
        } \t ${addon.name}`,
      );
    }
  }
}
