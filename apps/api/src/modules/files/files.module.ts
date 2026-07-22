import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FilesController } from "./files.controller";
import { StoragePort } from "./storage.port";
import { LocalStorageAdapter, S3StorageAdapter, localRoot } from "./storage.adapters";

/**
 * 文件模块（R1-3）：StoragePort 按配置选择本地磁盘或 S3 兼容后端。
 * 全局导出，供 fulfillment（单证原件）等模块注入。
 */
@Global()
@Module({
  controllers: [FilesController],
  providers: [
    {
      provide: StoragePort,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StoragePort => {
        // 兼容两种 bucket 变量名（.env 模板用 S3_BUCKET_PRIVATE）
        const bucket = config.get<string>("S3_BUCKET") || config.get<string>("S3_BUCKET_PRIVATE") || "";
        const accessKey = config.get<string>("S3_ACCESS_KEY") ?? "";
        const secretKey = config.get<string>("S3_SECRET_KEY") ?? "";
        const endpoint = config.get<string>("S3_ENDPOINT") ?? "";
        // 缺失或仍是占位值 → 回退本地磁盘（开发默认；生产挂 volume 亦可用）
        const isPlaceholder = [bucket, accessKey, secretKey, endpoint].some((v) => !v || v === "xxx");
        return isPlaceholder
          ? new LocalStorageAdapter(localRoot())
          : new S3StorageAdapter(endpoint, config.get<string>("S3_REGION") ?? "us-east-1", bucket, accessKey, secretKey);
      },
    },
  ],
  exports: [StoragePort],
})
export class FilesModule {}
