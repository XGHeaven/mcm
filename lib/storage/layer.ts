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

  /**
   * 是否期望尽可能的减少使用，也就是调用的代价比较大。
   * 常用于云服务层，因为云服务的下行流量往往是收费的，所以当需要重复请求数据的时候，希望能够直接请求源站
   */
  isWantLessUsage() {
    return false;
  }
}
