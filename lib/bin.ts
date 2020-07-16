import { colors, flags } from "./deps.ts";

import { TaskManager } from "./task/manager.ts";
import { parseVersionSelector } from "./utils.ts";

// storage
import { Storage } from "./storage.ts";
import { AliOSSLayer } from "./storage/alioss-layer.ts";
import { StorageLayer } from "./storage/layer.ts";
import { FsLayer } from "./storage/fs-layer.ts";

// executor
import { MinecraftExecutor } from "./executor/mc.ts";
import { FabricExecutor } from "./executor/fabric.ts";
import { ForgeExecutor } from "./executor/forge.ts";

const args = flags.parse(Deno.args, {
  string: ["storage-type", "storage-options"],
  boolean: ["help", "list-only", "verify", "ignore-lock", "prefer-use-source"],
  alias: {
    help: ["h"],
  },
  default: {
    parallel: 8,
  },
});

const listOnly = args["list-only"] || false;
const parallel = parseInt(args["parallel"], 10) || 8;
const preferUseSource = !!args["prefer-use-source"];

if (args["help"] || args["_"].length === 0) {
  const version = colors.yellow("<version>");
  console.log([
    `mcm [options] <...commands>`,
    ,
    "Available Command",
    `  minecraft:${version}\t sync minecraft of ${version}, alias: mc`,
    `  fabric:${version}\t sync fabric of ${version}`,
    `  forge:${version}\t sync forge of ${version}`,
    ,
    `  ${version} is one of`,
    `    ${colors.cyan("1.14.4")} \t\t exact version`,
    `    ${colors.cyan("1.14-pre")} \t\t match 1.14-pre1, 1.14-pre2 etc`,
    `    ${colors.cyan("1.14-rc")} \t\t match 1.14-rc1 1.14-rc2 etc`,
    `    ${colors.cyan("1.14.*")} \t\t match 1.14.1 1.14.2 etc`,
    `    ${colors.cyan("/^1\\.16.*$/")} \t regexp version`,
    `    ${colors.cyan("release")} \t\t all release version`,
    `    ${colors.cyan("snapshot")} \t\t only snapshot version`,
    `    ${colors.cyan("old")} \t\t old version before 1.0.0, default false`,
    `    ${colors.cyan("diff")} \t\t version changed`,
    `    ${colors.cyan("all")} \t\t all version`,
    ,
    `Options`,
    `  --verify \t\t Verify version sync is correct`,
    `  --list-only \t\t only list version needed to sync`,
    `  --ignore-lock \t Ignore lock file`,
    ,
    `Task Options`,
    `  --parallel <number> \t task parallel count, default 8`,
    ,
    `Storage Options`,
    `  --storage-type \t Layer type of storage or use STORAGE_TYPE env (choice: fs alioss) [default: fs]`,
    `  --storage-options \t Storage layer options or use STORAGE_OPTIONS env`,
    `      ${colors.cyan("fs")} \t with ${
      colors.yellow("storage_path")
    } options`,
    `      ${colors.cyan("alioss")} \t with ${
      colors.yellow("access_key:access_secret:bucket:endpoint")
    } options`,
    `  --prefer-use-source \t Prefer use source file instead of cache when need to refetch data do something`,
  ].join("\n"));
  Deno.exit(0);
}

const commands: string[] = args["_"] as string[];
const storageType = Deno.env.get("STORAGE_TYPE") || args["storage-type"] || "";
const storageOptions = Deno.env.get("STORAGE_OPTIONS") ||
  args["storage-options"] || "";

let layer: StorageLayer;

switch (storageType) {
  case "fs":
    if (!storageOptions) {
      console.log(`You must be choose a place to cache files`);
      Deno.exit(0);
    }

    layer = new FsLayer(storageOptions);
    break;
  case "alioss":
    const [key, secret, bucket, region] = storageOptions.split(":");
    if (!key || !secret || !bucket || !region) {
      console.error(`AliOSS storage layer need more argument`);
      console.error(`  access_key=${key}`);
      console.error(`  access_secret=${secret}`);
      console.error(`  access_bucket=${bucket}`);
      console.error(`  access_region=${region}`);
      Deno.exit(0);
    }
    layer = new AliOSSLayer(key, secret, bucket, region);
    break;
  default:
    console.log(`Unknown storage type ${storageType}`);
    Deno.exit(0);
}

const tasks = new TaskManager({
  parallel,
});
const storage = new Storage(layer);

const mcCommands = new Set<string>();
const fabricCommands = new Set<string>();
const forgeCommands = new Set<string>();

for (const command of commands) {
  const [type, versionString] = command.split(":");
  if (!type || !versionString) {
    console.warn(`command ${colors.cyan(command)} is invalid`);
    continue;
  }
  switch (type) {
    case "mc":
    case "minecraft":
      mcCommands.add(versionString);
      break;
    case "fabric":
      fabricCommands.add(versionString);
      break;
    case "forge":
      forgeCommands.add(versionString);
      break;
  }
}

if (mcCommands.size) {
  const mc = new MinecraftExecutor(
    storage,
    tasks,
    parseVersionSelector(Array.from(mcCommands.values())),
    {
      verify: !!args.verify,
      ignoreLock: !!args["ignore-lock"],
    },
  );

  if (listOnly) {
    mc.executeList().catch(console.error);
  } else {
    mc.execute().catch(console.error);
  }
}

if (fabricCommands.size) {
  const fabric = new FabricExecutor(
    storage,
    tasks,
    parseVersionSelector(Array.from(fabricCommands.values())),
  );

  if (!listOnly) {
    fabric.execute().catch(console.error);
  }
}

if (forgeCommands.size) {
  const forge = new ForgeExecutor(
    {
      storage,
      tasks,
      versionSelector: parseVersionSelector(Array.from(forgeCommands.values())),
      ignoreLock: !!args["ignore-lock"],
      verify: !!args.verify,
      preferUseSource,
    },
  );

  if (!listOnly) {
    forge.execute().catch(console.error);
  }
}
