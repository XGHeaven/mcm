import { StorageLayer } from "./layer.ts";
import { fs, path } from "../deps.ts";

export class FsLayer extends StorageLayer {
  constructor(public root: string) {
    super();
  }

  private prefix(filepath: string) {
    return path.join(this.root, filepath);
  }

  async read(filepath: string): Promise<Uint8Array> {
    filepath = this.prefix(filepath);
    return await Deno.readFile(filepath);
  }

  async write(filepath: string, data: string | Uint8Array): Promise<void> {
    filepath = this.prefix(filepath);
    await fs.ensureDir(path.dirname(filepath));
    if (typeof data === "string") {
      const encoder = new TextEncoder();
      return Deno.writeFile(filepath, encoder.encode(data));
    }

    return Deno.writeFile(filepath, data);
  }

  async exist(filepath: string): Promise<boolean> {
    filepath = this.prefix(filepath);
    return fs.exists(filepath);
  }
}
