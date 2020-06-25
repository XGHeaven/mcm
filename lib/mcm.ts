import "./prepare.ts";

import { colors } from "./deps.ts";
import { StorageManager } from "./storage.ts";
import { MinecraftExecutor, MinecraftVersionType } from "./executor/mc.ts";
import { FabricExecutor } from "./executor/fabric.ts";
import { matchVersion, parseVersionMatcher, VersionMatcher } from "./utils.ts";
import { TaskManager } from "./task/manager.ts";

const args = Deno.args.slice(0);

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
  Deno.exit(0);
}

const commands: string[] = [];

while (args.length > 0) {
  const v = args[0];
  switch (v) {
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

const tasks = new TaskManager();
const storage = StorageManager.create();

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
