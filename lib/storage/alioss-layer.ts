import { LayerWriteOptions, StorageLayer } from "./layer.ts";
import { hmac, path, hash } from "../deps.ts";
import { encodeKey } from "../utils.ts";

function buildCanonicalizedResource(
  resourcePath: string,
  parameters: string | string[] | Record<string, string>,
) {
  let canonicalizedResource = `${resourcePath}`;
  let separatorString = "?";

  if (typeof parameters === "string") {
    if (parameters) {
      canonicalizedResource += separatorString + parameters;
    }
  } else if (Array.isArray(parameters)) {
    parameters.sort();
    canonicalizedResource += separatorString + parameters.join("&");
  } else if (parameters) {
    const compareFunc = (entry1: string, entry2: string) => {
      if (entry1[0] > entry2[0]) {
        return 1;
      } else if (entry1[0] < entry2[0]) {
        return -1;
      }
      return 0;
    };
    const processFunc = (key: string) => {
      canonicalizedResource += separatorString + key;
      if (parameters[key]) {
        canonicalizedResource += `=${parameters[key]}`;
      }
      separatorString = "&";
    };
    Object.keys(parameters).sort(compareFunc).forEach(processFunc);
  }

  return canonicalizedResource;
}

function canonicalString(
  method: string,
  resourcePath: string,
  headers: Record<string, string>,
) {
  const OSS_PREFIX = "x-oss-";
  const ossHeaders: string[] = [];
  const headersToSign: Record<string, string> = {};

  let signContent = [
    method.toUpperCase(),
    headers["content-md5"] || "",
    headers["content-type"] || "",
    headers["date"] || headers["x-oss-date"] || new Date().toUTCString(),
  ];

  Object.keys(headers).forEach((key) => {
    const lowerKey = key.toLowerCase();
    if (lowerKey.startsWith(OSS_PREFIX)) {
      headersToSign[lowerKey] = String(headers[key]).trim();
    }
  });

  Object.keys(headersToSign).sort().forEach((key) => {
    ossHeaders.push(`${key}:${headersToSign[key]}`);
  });

  signContent = signContent.concat(ossHeaders);

  signContent.push(buildCanonicalizedResource(resourcePath, ""));

  return signContent.join("\n");
}

function computeSignature(accessKeySecret: string, canonicalString: string) {
  return btoa(
    String.fromCharCode(
      ...(hmac("sha1", accessKeySecret, canonicalString, "utf8") as Uint8Array),
    ),
  );
}

export class AliOSSLayer extends StorageLayer {
  #existCache = new Set<string>();

  constructor(
    private key: string,
    private secret: string,
    private bucket: string,
    private region: string,
  ) {
    super();
  }

  private async request(
    method: string,
    objectKey: string,
    data?: ArrayBuffer,
    type?: string,
  ) {
    const encodedKey = encodeKey(objectKey);
    let url = `http://${this.region}.aliyuncs.com`;
    if (encodedKey.startsWith("/")) {
      url += encodedKey;
    } else {
      url += "/" + encodedKey;
    }
    const now = new Date();

    const signHeader: Record<string, string> = {
      date: now.toUTCString(),
      "content-type": type || "",
    };

    if (data && method === "PUT") {
      signHeader["content-md5"] = hash.createHash("md5").update(data).toString(
        "base64",
      );
      signHeader["content-length"] = `${data.byteLength}`;
    }

    const signResult = computeSignature(
      this.secret,
      canonicalString(
        method,
        path.join(`/${this.bucket}`, objectKey),
        signHeader,
      ),
    );

    let i = 0;
    let error: any;
    while (i < 3) {
      // retry 3 times
      try {
        const resp = await fetch(
          new Request(url, {
            method,
            headers: {
              authorization: `OSS ${this.key}:${signResult}`,
              host: `${this.bucket}.${this.region}.aliyuncs.com`,
              ...signHeader,
            },
            body: data,
          }),
        );
        return resp;
      } catch (e) {
        i++;
        error = i;
      }
    }
    throw error;
  }

  async read(filepath: string): Promise<Uint8Array> {
    const resp = await this.request("GET", filepath);
    return new Uint8Array(await resp.arrayBuffer());
  }

  async write(
    filepath: string,
    data: string | ArrayBuffer,
    options: LayerWriteOptions = {},
  ): Promise<void> {
    let body: ArrayBuffer;
    if (typeof data === "string") {
      body = new TextEncoder().encode(data);
    } else {
      body = data;
    }
    const resp = await this.request("PUT", filepath, body, options.type);

    const text = await resp.text();
    if (resp.status !== 200) {
      throw new Error(text);
    }
  }

  async exist(filepath: string): Promise<boolean> {
    if (this.#existCache.has(filepath)) {
      // 只需要缓存确定存在的文件即可，对于不存在的文件，肯定会上传的
      return true;
    }
    const resp = await this.request("HEAD", filepath);

    try {
      await resp.arrayBuffer();
      if (resp.status !== 200) {
        return false;
      }
      this.#existCache.add(filepath);
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }

  isSupportSameFileFolder(): boolean {
    return true;
  }

  isWantLessUsage(): boolean {
    return true;
  }
}
