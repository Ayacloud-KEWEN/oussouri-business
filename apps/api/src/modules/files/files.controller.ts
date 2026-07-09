import {
  BadRequestException, Controller, Get, NotFoundException, Param, Post, Res,
  UploadedFile, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Public } from "../iam/jwt-auth.guard";
import { Roles } from "../iam/roles.guard";

/**
 * 文件服务（演示版：本地磁盘卷存储；R1-3 切换 OVH S3 预签名直传时保留同一 key 语义）。
 * 仅允许图片（产品照片场景）；单证原件走独立私有通道（不经此公开读接口）。
 */
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), "uploads");
const ALLOWED = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const MAX_BYTES = 5 * 1024 * 1024;
const KEY_PATTERN = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;
const CONTENT_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

@Controller("files")
export class FilesController {
  @Roles("SUPPLIER", "ADMIN", "BROKER")
  @Post("upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_BYTES } }))
  upload(@UploadedFile() file: { mimetype: string; buffer: Buffer; size: number } | undefined) {
    if (!file) throw new BadRequestException({ code: "VALIDATION_FAILED", detail: "缺少文件（form 字段名 file）" });
    const ext = ALLOWED.get(file.mimetype);
    if (!ext) throw new BadRequestException({ code: "VALIDATION_FAILED", detail: "仅支持 JPG/PNG/WebP 图片" });
    if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
    const key = `${randomUUID()}.${ext}`;
    writeFileSync(join(UPLOAD_DIR, key), file.buffer);
    return { key, url: `/api/v1/files/${key}` };
  }

  @Public()
  @Get(":key")
  serve(@Param("key") key: string, @Res() res: { setHeader: (k: string, v: string) => void; status: (n: number) => { end: () => void } } & NodeJS.WritableStream) {
    if (!KEY_PATTERN.test(key)) throw new NotFoundException({ code: "NOT_FOUND", detail: "文件不存在" });
    const path = join(UPLOAD_DIR, key);
    if (!existsSync(path)) throw new NotFoundException({ code: "NOT_FOUND", detail: "文件不存在" });
    const ext = key.split(".").pop()!;
    res.setHeader("Content-Type", CONTENT_TYPES[ext] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=86400");
    createReadStream(path).pipe(res);
  }
}
