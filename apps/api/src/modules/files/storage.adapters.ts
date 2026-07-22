import { Injectable, Logger } from "@nestjs/common";
import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { StoragePort, StoredObject } from "./storage.port";

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg",
  png: "image/png", webp: "image/webp",
};
export const contentTypeOf = (key: string): string =>
  CONTENT_TYPES[key.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

/** 本地磁盘适配器（开发与单机部署；生产挂 Docker volume） */
@Injectable()
export class LocalStorageAdapter extends StoragePort {
  readonly kind = "local" as const;
  private readonly logger = new Logger(LocalStorageAdapter.name);

  constructor(private readonly root: string) {
    super();
  }

  /** 防目录穿越：解析后必须仍在 root 内 */
  private resolveKey(key: string): string {
    const full = resolve(this.root, key);
    if (!full.startsWith(resolve(this.root))) throw new Error(`invalid key: ${key}`);
    return full;
  }

  async put(key: string, body: Buffer): Promise<StoredObject> {
    const full = this.resolveKey(key);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
    this.logger.log(`[local] put ${key} (${body.length} bytes)`);
    return { key, bytes: body.length };
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    const full = this.resolveKey(key);
    if (!existsSync(full)) return null;
    return { body: readFileSync(full), contentType: contentTypeOf(key) };
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(this.resolveKey(key));
  }

  async delete(key: string): Promise<void> {
    const full = this.resolveKey(key);
    if (existsSync(full)) rmSync(full);
  }
}

/**
 * S3 兼容适配器（OVH Object Storage / AWS S3），手写 SigV4，零 SDK 依赖。
 * 配置：S3_ENDPOINT / S3_REGION / S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY
 */
@Injectable()
export class S3StorageAdapter extends StoragePort {
  readonly kind = "s3" as const;
  private readonly logger = new Logger(S3StorageAdapter.name);

  constructor(
    private readonly endpoint: string,
    private readonly region: string,
    private readonly bucket: string,
    private readonly accessKey: string,
    private readonly secretKey: string,
  ) {
    super();
  }

  private sign(method: string, key: string, payload: Buffer, contentType?: string) {
    const url = new URL(`${this.endpoint.replace(/\/$/, "")}/${this.bucket}/${key}`);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = createHash("sha256").update(payload).digest("hex");

    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    if (contentType) headers["content-type"] = contentType;

    const signedHeaders = Object.keys(headers).sort().join(";");
    const canonicalHeaders = Object.keys(headers).sort().map((h) => `${h}:${headers[h]}\n`).join("");
    const canonicalRequest = [method, url.pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");

    const hmac = (k: Buffer | string, d: string) => createHmac("sha256", k).update(d).digest();
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.secretKey}`, dateStamp), this.region), "s3"), "aws4_request");
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

    return {
      url: url.toString(),
      headers: {
        ...headers,
        Authorization: `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
    };
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const { url, headers } = this.sign("PUT", key, body, contentType);
    const res = await fetch(url, { method: "PUT", headers, body: new Uint8Array(body) });
    if (!res.ok) throw new Error(`S3 put ${key} failed: ${res.status} ${await res.text()}`);
    this.logger.log(`[s3] put ${key} (${body.length} bytes)`);
    return { key, bytes: body.length };
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    const { url, headers } = this.sign("GET", key, Buffer.alloc(0));
    const res = await fetch(url, { method: "GET", headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`S3 get ${key} failed: ${res.status}`);
    return {
      body: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get("content-type") ?? contentTypeOf(key),
    };
  }

  async exists(key: string): Promise<boolean> {
    const { url, headers } = this.sign("HEAD", key, Buffer.alloc(0));
    const res = await fetch(url, { method: "HEAD", headers });
    return res.ok;
  }

  async delete(key: string): Promise<void> {
    const { url, headers } = this.sign("DELETE", key, Buffer.alloc(0));
    const res = await fetch(url, { method: "DELETE", headers });
    if (!res.ok && res.status !== 404) throw new Error(`S3 delete ${key} failed: ${res.status}`);
  }
}

/** 供 module factory 复用的本地根目录解析 */
export const localRoot = (): string => process.env.UPLOAD_DIR ?? join(process.cwd(), "uploads");
