
enum MinecraftVersionType {
  RELEASE = 'release',
  SNAPSHOT = 'snapshot'
}

export interface MinecraftVersion {
  id: string
  type: MinecraftVersionType
  url: string
  time: Date
  releaseTime: Date
}

export interface MinecraftVersionManifest {
  latest: Record<MinecraftVersionType, string>
  versions: MinecraftVersion[]
}

export interface MinecraftPackage {
  id: string
  type: MinecraftVersionType
  time: string
  releaseTime: string
  mainClass: string
  minimumLauncherVersion: number
  assets: string
  logging: {
    client: {
      argument: string
      file: {
        id: string,
        sha1: string
        size: number
        url: string
      }
      type: string
    }
  }
  assetIndex: MinecraftPackageAssetIndex
  downloads: {
    client: MinecraftPackageDownload
    client_mappings: MinecraftPackageDownload
    server: MinecraftPackageDownload
    server_mappings: MinecraftPackageDownload
  },
  libraries: MinecraftPackageLibrary[]
}

export interface MinecraftPackageLibrary {
  name: string
  downloads: {
    artifact: MinecraftLibraryResource,
    classifiers?: Record<string, MinecraftLibraryResource>
  }
  rules?: any[]
  natives: any
}

export interface MinecraftLibraryResource {
  path: string
  sha1: string
  size: number
  url: string
}

export interface MinecraftPackageDownload {
  sha1: string
  size: number
  url: string
}

export interface MinecraftPackageAssetIndex {
  id: string
  sha1: string
  size: number
  totalSize: number
  url: string
}

export async function fetchMinecraftVersionManifest(): Promise<[Uint8Array, MinecraftVersionManifest]> {
  const [data, manifest] = await fetchBinaryAndJson('http://launchermeta.mojang.com/mc/game/version_manifest.json')
  for (const version of manifest.versions) {
    version.time = new Date(version.time)
    version.releaseTime = new Date(version.releaseTime)
  }

  return [data, manifest]
}

export async function fetchMinecraftPackage(url: string): Promise<[Uint8Array, MinecraftPackage]> {
  return fetchBinaryAndJson(url)
}

export async function fetchAndRetry(url: string) {
  let i = 0
  while (i < 3) {
    try {
      const resp = await fetch(url)
      console.log(`resource ${url} with ${resp.headers.get('content-type')}(${resp.headers.get('content-length')})`)
      return resp
    } catch(err) {
      console.error(`Request failed for ${url}, retrying(${i + 1}/3)`)
      console.error(err && err.message)
    }
    i++
  }
  throw new Error(`Request ${url} retry limit reached`)
}

export async function fetchBinaryAndJson<T = any>(url: string): Promise<[Uint8Array, T]> {
  const resp = await fetchAndRetry(url)
  const data = new Uint8Array(await resp.arrayBuffer())
  return [data, JSON.parse(new TextDecoder('utf-8').decode(data))]
}
