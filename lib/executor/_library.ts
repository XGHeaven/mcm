// 处理 forge 和 minecraft 中共用的资源处理

import { TaskExecutor } from "../task/manager.ts";
import { GroupTaskCollector } from "../task/manager.ts";
import { StorageManager } from "../storage.ts";
import { MinecraftExecutor } from "./mc.ts";
import { ForgeExecutor } from "./forge.ts";
import { parseJarName } from "../utils.ts";

export class LibraryExecutor {
  #storage: StorageManager;
  #ignoreLock: boolean;
  constructor(config: {
    storage: StorageManager;
    ignoreLock?: boolean;
  }) {
    this.#storage = config.storage;
    this.#ignoreLock = !!config.ignoreLock;
  }

  createLibraries(libraries: Libraries, lock?: string): TaskExecutor {
    return async ({ task, waitTask, queueGroup }) => {
      if (!this.#ignoreLock && lock && await this.#storage.isLock(lock)) {
        console.log(`Library of ${task.name} has been locked`);
        return;
      }
      const col = new GroupTaskCollector();

      for (
        const { downloads, name, url } of libraries
      ) {
        if (downloads) {
          // minecraft 兼容的格式
          const { artifact, classifiers } = downloads;
          if (artifact) {
            col.collect(
              `${name}`,
              this.createLibraryFile(name, artifact.url, artifact.path),
            );
          }
          if (classifiers) {
            for (const [type, lib] of Object.entries(classifiers)) {
              col.collect(
                `${name}-${type}`,
                this.createLibraryFile(name, lib.url, lib.path),
              );
            }
          }
        } else {
          // 旧版 forge 格式
          col.collect(`${name}`, this.createOldForgeLibrary(name, url));
        }
      }

      await waitTask(queueGroup(`library`, col.group));

      if (lock) {
        await this.#storage.lock(lock);
      }
    };
  }

  createLibraryFile(name: string, url: string, path: string): TaskExecutor {
    return async () => {
      let source = url;
      let target = "";
      if (!url) {
        // 因为新版的 forge 有些 URL 是空的，表示的是他已经内置在 installer 中的
        return;
      }
      switch (new URL(url).hostname) {
        case MinecraftExecutor.LibraryHost:
          target = MinecraftExecutor.getTargetLibraryFromUrl(url);
          break;
        case ForgeExecutor.Host:
          target = ForgeExecutor.getTargetLibraryFromUrl(url);
          break;
        default:
          return Promise.reject(new Error(`Cannot found ${url} target`));
      }

      await this.#storage.cacheRemoteFile(source, target);
    };
  }

  createOldForgeLibrary(name: string, url?: string): TaskExecutor {
    return async () => {
      const jarName = parseJarName(name);
      let source: string, target: string;
      if (url) {
        if (!url.includes(ForgeExecutor.Host)) {
          // 目前只支持 forge 的，对于其他的一律算作不合法
          return Promise.reject(new Error(`Unknown ${url} target`));
        }
        // 说明是要从 forge maven 上拿
        if (
          jarName.group === "net.minecraftforge" && jarName.name === "forge"
        ) {
          // 这个比较特殊，要单独处理。其实前置的请求会自动处理这个的，所以这里不处理问题也不大
          jarName.classifier = "universal";
        }

        source = ForgeExecutor.getSourceLibrary(jarName);
        target = ForgeExecutor.getTargetLibrary(jarName);
      } else {
        // 从 minecraft 官网拿
        source = MinecraftExecutor.getSourceLibrary(jarName);
        target = MinecraftExecutor.getTargetLibrary(jarName);
      }

      await this.#storage.cacheRemoteFile(source, target);
    };
  }
}

export type Libraries = Library[];

export interface Library {
  name: string;
  downloads?: {
    artifact?: LibraryFile;
    classifiers?: Record<string, LibraryFile>;
  };
  url?: string;
  // don't care about others
}

export interface LibraryFile {
  path: string;
  sha1: string;
  size: number;
  url: string;
}
