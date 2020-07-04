import "./prepare.ts";

import { colors } from "./deps.ts";
import { StorageManager } from "./storage.ts";
import { MinecraftExecutor } from "./executor/mc.ts";
import { FabricExecutor } from "./executor/fabric.ts";
import { parseVersionSelector } from "./utils.ts";
import { TaskManager } from "./task/manager.ts";
import { StorageLayer } from "./storage/layer.ts";
import { FsLayer } from "./storage/fs-layer.ts";
import { AliOSSLayer } from "./storage/alioss-layer.ts";

const args = Deno.args.slice(0);
let storageType = Deno.env.get("STORAGE_TYPE") || "";
let storageOptions = Deno.env.get("STORAGE_OPTIONS") || "";
let listOnly = false;
let parallel = 8;

if (args[0] === "--help" || args[0] === "-h" || args.length === 0) {
  const version = colors.yellow("<version>");
  console.log([
    `mcm [options] <...commands>`,
    ,
    "Available Command:",
    `  mc:${version}\t\tsync minecraft of ${version}`,
    `  fabric:${version}\tsync fabric of ${version}`,
    ,
    `  ${version} is one of`,
    `    ${colors.cyan("1.14.4")} \t\t exact version`,
    `    ${colors.cyan("1.14-pre")} \t\t match 1.14-pre1, 1.14-pre2 etc`,
    `    ${colors.cyan("1.14-rc")} \t\t match 1.14-rc1 1.14-rc2 etc`,
    `    ${colors.cyan("1.14.*")} \t\t match 1.14.1 1.14.2 etc`,
    `    ${colors.cyan("/^1\\.16.*$/")} \t regexp version`,
    `    ${colors.cyan("release")} all release version`,
    `    ${colors.cyan("snapshot")} \t\t only snapshot version`,
    `    ${
      colors.cyan("old")
    } \t\t very very old version before 1.0.0, default false`,
    `    ${colors.cyan("diff")} \t\t version changed`,
    `    ${colors.cyan("all")} \t\t all version`,
    ,
    `Options`,
    `  --verify \t Verify version sync is correct`,
    `  --list-only \t only list version needed to sync`,
    ,
    `Task Options`,
    `  --parallel <number> \t task parallel count, default 8`,
    ,
    `Storage Options:`,
    `  --storage-type \t Layer type of storage or use STORAGE_TYPE env (choice: fs alioss) [default: fs]`,
    `  --storage-options \t Storage layer options or use STORAGE_OPTIONS env`,
    `      ${colors.cyan("fs")} with ${colors.yellow("storage_path")} options`,
    `      ${colors.cyan("alioss")} with ${
      colors.yellow("access_key:access_secret:bucket:endpoint")
    } options`,
  ].join("\n"));
  Deno.exit(0);
}

const commands: string[] = [];

while (args.length > 0) {
  const v = args[0];
  switch (v) {
    case "--storage-type":
      args.shift();
      storageType = args[0];
      break;
    case "--storage-options":
      args.shift();
      storageOptions = args[0];
      break;
    case "--list-only":
      listOnly = true;
      break;
    case "--parallel":
      args.shift();
      parallel = parseInt(args[0], 10);
      break;
    default:
      // command
      commands.push(v);
  }
  args.shift();
}

if (!commands.length) {
  console.error("Please give a command");
  Deno.exit(0);
}

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
const storage = new StorageManager(layer);

const mcCommands = new Set<string>();
const fabricCommands = new Set<string>();

for (const command of commands) {
  const [type, versionString] = command.split(":");
  if (!type || !versionString) {
    console.warn(`command ${colors.cyan(command)} is invalid`);
    continue;
  }
  switch (type) {
    case "mc":
      mcCommands.add(versionString);
      break;
    case "fabric":
      fabricCommands.add(versionString);
      break;
  }
}

if (mcCommands.size) {
  const mc = new MinecraftExecutor(
    storage,
    tasks,
    parseVersionSelector(Array.from(mcCommands.values())),
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
