export interface StoredObject {
  /** 对象键（业务侧唯一标识，如 `case-docs/HZB/xxx.pdf`） */
  key: string;
  bytes: number;
}

/**
 * 对象存储端口（R1-3）：本地磁盘（开发/单机）与 S3 兼容（OVH Object Storage）两实现。
 * 单证原件属敏感文件，读取一律经后端鉴权后回源，绝不暴露公开直链。
 */
export abstract class StoragePort {
  abstract put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  abstract get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  abstract exists(key: string): Promise<boolean>;
  abstract delete(key: string): Promise<void>;
  /** 后端类型标识（healthz/排障用） */
  abstract readonly kind: "local" | "s3";
}
