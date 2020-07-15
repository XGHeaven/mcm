export interface LayerWriteOptions {
  type?: string;
}

export abstract class StorageLayer {
  abstract read(filepath: string): Promise<Uint8Array>;
  abstract write(
    filepath: string,
    data: string | ArrayBuffer,
    options?: LayerWriteOptions,
  ): Promise<void>;
  abstract exist(filepath: string, length?: number): Promise<boolean>;

  /**
   * 是否支持同名的文件和文件夹
   */
  isSupportSameFileFolder(): boolean {
    return false;
  }
}
