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
    return new RegExp(version.slice(1, -1))
  }

  let modifier: 'rc' | 'pre' | '' = ''
  let isReg = false

  if (version.endsWith('-rc')) {
    modifier = 'rc'
    version = version.slice(0, -3)
  } else if (version.endsWith('-pre')) {
    modifier = 'pre'
    version = version.slice(0, -4)
  }

  if (version.includes('.*')) {
    // . 不需要处理，后面会统一处理
    version = version.replace(/\.\*/, '(.\\d+)?')
    isReg = true
  }

  if (isReg || modifier) {
    return new RegExp(`^${version.replace(/\./, '\\.')}${modifier ? `-${modifier}\\d+` : ''}$`)
  }

  return version
}
