export function byteToString(data: ArrayBuffer) {
  const decoder = new TextDecoder("utf-8");
  return decoder.decode(data);
}

export type VersionMatcher = string | RegExp;

export function matchVersion(
  version: string,
  matcher?: VersionMatcher,
): boolean {
  if (typeof matcher === "string") {
    if (matcher) {
      return version === matcher;
    }
  } else if (matcher) {
    return matcher.test(version);
  }

  return true;
}

export interface VersionSelector {
  release: boolean;
  snapshot: boolean;
  diff: boolean;
  latest: boolean;
  // 表示上古版本，一般有 old_beta 和 old_alpha
  old: boolean;
  matchers: VersionMatcher[];
}

export function parseVersionSelector(selectors: string[]): VersionSelector {
  let release = false;
  let snapshot = false;
  let diff = false;
  let latest = false;
  let old = false;

  const versionMatchers: VersionMatcher[] = [];

  for (const selector of selectors) {
    switch (selector) {
      case "release":
        release = true;
        break;
      case "snapshot":
        snapshot = true;
        break;
      case "old":
        old = true;
        break;
      case "diff":
        diff = true;
        break;
      case "all":
        // '' 空字符串就能表示匹配所有
        versionMatchers.push("");
        break;
      case "latest":
        latest = true;
        break;
      default:
        versionMatchers.push(parseVersionMatcher(selector));
    }
  }

  if (!versionMatchers.length) {
    // 如果没有任何一个匹配项，默认就是选择全部
    versionMatchers.push("");
  }

  return {
    matchers: versionMatchers,
    // release 和 snapshot 默认都是 true，但是当有任意一个被设置之后，另外一个就会自动变成 false，除非两个都设置
    release: release || snapshot ? release : true,
    snapshot: release || snapshot ? snapshot : true,
    diff,
    latest,
    old,
  };
}

const encodeCharCode = new Map<RegExp, string>(
  "!'()&^~".split("").map(
    (char) =>
      [
        new RegExp(`\\${char}`, "g"),
        `%${
          char
            .charCodeAt(0)
            .toString(16)
            .toUpperCase()
        }`,
      ] as [RegExp, string],
  ),
);

export function encodeKey(key: string) {
  key = encodeURIComponent(key);
  for (const [reg, str] of encodeCharCode) {
    key = key.replace(reg, str);
  }
  // 恢复 /
  key = key.replace(/%2F/g, "/");
  return key;
}

export function parseVersionMatcher(version: string): VersionMatcher {
  if (version.startsWith("/") && version.endsWith("/")) {
    return new RegExp(version.slice(1, -1));
  }

  let modifier: "rc" | "pre" | "" = "";
  let isReg = false;

  if (version.endsWith("-rc")) {
    modifier = "rc";
    version = version.slice(0, -3);
  } else if (version.endsWith("-pre")) {
    modifier = "pre";
    version = version.slice(0, -4);
  }

  if (version.includes(".*")) {
    // . 不需要处理，后面会统一处理
    version = version.replace(/\.\*/, "(.\\d+)?");
    isReg = true;
  }

  if (isReg || modifier) {
    return new RegExp(
      `^${version.replace(/\./, "\\.")}${modifier ? `-${modifier}\\d+` : ""}$`,
    );
  }

  return version;
}
