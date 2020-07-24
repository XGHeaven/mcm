import { colors } from "./deps.ts";

export async function fetchAndRetry(url: string) {
  let i = 0;
  while (i < 3) {
    try {
      const resp = await fetch(url);
      console.log(
        colors.cyan("fetch"),
        `${url} with ${resp.headers.get("content-type")}(${
          resp.headers.get("content-length")
        })`,
      );
      return resp;
    } catch (err) {
      console.log(colors.red("fetch"), `${url} retrying(${i + 1}/3)`);
      console.error(err && err.message);
    }
    i++;
  }
  throw new Error(`Request ${url} retry limit reached`);
}

export async function fetchBinaryAndJson<T = any>(
  url: string,
): Promise<[Uint8Array, T]> {
  const resp = await fetchAndRetry(url);
  const data = new Uint8Array(await resp.arrayBuffer());
  return [data, JSON.parse(new TextDecoder("utf-8").decode(data))];
}

export async function fetchJSON<T = any>(url: string): Promise<T> {
  const resp = await fetchAndRetry(url);
  return resp.json();
}
