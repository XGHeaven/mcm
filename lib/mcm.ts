import "./prepare.ts";

import { colors } from "./deps.ts";
import { StorageManager } from "./storage.ts";
import { MinecraftExecutor, MinecraftVersionType } from "./executor/mc.ts";
import { FabricExecutor } from "./executor/fabric.ts";
import { matchVersion, parseVersionMatcher, VersionMatcher } from "./utils.ts";
import { TaskManager } from "./task/manager.ts";
import { StorageLayer } from "./storage/layer.ts";
import { FsLayer } from "./storage/fs-layer.ts";
import { AliOSSLayer } from "./storage/alioss-layer.ts";

const args = Deno.args.slice(0);
let storageType = Deno.env.get('STORAGE_TYPE') || ''
let storageOptions = Deno.env.get('STORAGE_OPTIONS') ||''

if (args[0] === "--help" || args[0] === "-h" || args.length === 0) {
  const version = colors.yellow("<version>");
  console.log("mcm [options] <...commands>");
  console.log();
  console.log("Available Command:");
  console.log(`  mc:${version}\t\tsync minecraft of ${version}`);
  console.log(`  fabric:${version}\tsync fabric of ${version}`);
  console.log();
  console.log(`  ${version} is one of`);
  console.log(`    ${colors.cyan("1.14.4")} \t\t exact version`);
  console.log(`    ${colors.cyan("1.14-pre")} \t\t match 1.14-pre1, 1.14-pre2 etc`);
  console.log(`    ${colors.cyan("1.14-rc")} \t\t match 1.14-rc1 1.14-rc2 etc`);
  console.log(`    ${colors.cyan("1.14.*")} \t\t match 1.14.1 1.14.2 etc`);
  console.log(`    ${colors.cyan("/^1\\.16.*$/")} \t regexp version`);
  console.log(`    ${colors.cyan("release")} all release version`);
  console.log(`    ${colors.cyan("snapshot")} \t\t only snapshot version`);
  console.log(`    ${colors.cyan("diff")} \t\t version changed`);
  console.log(`    ${colors.cyan("all")} \t\t all version`);
  console.log()
  console.log(`Options`)
  console.log(`  --verify \t Verify version sync is correct`)
  console.log()
  console.log(`Storage Options:`)
  console.log(`  --storage-type \t Layer type of storage or use STORAGE_TYPE env (choice: fs alioss) [default: fs]`)
  console.log(`  --storage-options \t Storage layer options or use STORAGE_OPTIONS env`)
  console.log(`      type ${colors.cyan('fs')} with ${colors.yellow('storage_path')}`)
  console.log(`      type ${colors.cyan('alioss')} with ${colors.yellow('access_key:access_secret:bucket:endpoint')}`)
  Deno.exit(0);
}

const commands: string[] = [];

while (args.length > 0) {
  const v = args[0];
  switch (v) {
    case '--storage-type':
      args.shift()
      storageType = args[0]
      break
    case '--storage-options':
      args.shift()
      storageOptions = args[0]
      break
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

let layer: StorageLayer

switch(storageType) {
  case 'fs':
    if (!storageOptions) {
      console.log(`You must be choose a place to cache files`)
      Deno.exit(0);
    }

    layer = new FsLayer(storageOptions)
    break
  case 'alioss':
    const [key, secret, bucket, region] = storageOptions.split(':')
    if (!key || !secret || !bucket || !region) {
      console.error(`AliOSS storage layer need more argument`);
      console.error(`  access_key=${key}`);
      console.error(`  access_secret=${secret}`);
      console.error(`  access_bucket=${bucket}`);
      console.error(`  access_region=${region}`);
      Deno.exit(0);
    }
    layer = new AliOSSLayer(key, secret, bucket, region)
    break
  default:
    console.log(`Unknown storage type ${storageType}`)
    Deno.exit(0)
}

const tasks = new TaskManager();
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

function parseVersions(versions: string[]) {
  let stable: boolean = false;
  let snapshot: boolean = false;
  let diff = false;

  let versionMatchers: VersionMatcher[] = [];

  for (const version of versions) {
    switch (version) {
      case "stable":
        stable = true;
        break;
      case "diff":
        // TODO
        diff = true;
        break;
      case "snapshot":
        snapshot = true;
        break;
      case "all":
        // '' 空字符串就能表示匹配所有
        versionMatchers.push("");
        break;
      default:
        versionMatchers.push(parseVersionMatcher(version))
    }
  }

  return {
    matchers: versionMatchers,
    stable,
    snapshot,
    diff,
  };
}

if (mcCommands.size) {
  const { matchers, stable, snapshot } = parseVersions(
    Array.from(mcCommands.values()),
  );
  new MinecraftExecutor(storage, tasks, (version) => {
    let ret = matchers.some((matcher) => matchVersion(version.id, matcher));

    if (stable && ret) {
      ret = version.type === MinecraftVersionType.RELEASE;
    } else if (snapshot) {
      ret = version.type === MinecraftVersionType.SNAPSHOT;
    }

    return ret;
  }).execute().catch(console.error);
}

if (fabricCommands.size) {
  const { matchers, stable, snapshot } = parseVersions(
    Array.from(fabricCommands.values()),
  );
  new FabricExecutor(storage, tasks, (version) => {
    let ret = matchers.some((matcher) =>
      matchVersion(version.version, matcher)
    );
    if (stable && ret) {
      ret = version.stable;
    } else if (snapshot && ret) {
      ret = !version.stable;
    }

    return ret;
  }).execute().catch(console.error);
}
