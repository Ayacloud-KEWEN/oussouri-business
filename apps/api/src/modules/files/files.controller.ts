import {
  BadRequestException, Controller, Get, NotFoundException, Param, Post, Res,
  UploadedFile, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { Public } from "../iam/jwt-auth.guard";
import { Roles } from "../iam/roles.guard";

/**
 * 文件服务（演示版：本地磁盘卷存储；R1-3 切换 OVH S3 预签名直传时保留同一 key 语义）。
 * 仅允许图片（产品照片场景）；单证原件走独立私有通道（不经此公开读接口）。
 * 上传自动压缩：限宽 1600、转 WebP q78（手机原图 5-10MB → 通常 <200KB）。
 */
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), "uploads");
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 12 * 1024 * 1024; // 压缩前上限（手机原图）
const KEY_PATTERN = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;
const CONTENT_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

@Controller("files")
export class FilesController {
  @Roles("SUPPLIER", "ADMIN", "BROKER")
  @Post("upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_BYTES } }))
  async upload(@UploadedFile() file: { mimetype: string; buffer: Buffer; size: number } | undefined) {
    if (!file) throw new BadRequestException({ code: "VALIDATION_FAILED", detail: "缺少文件（form 字段名 file）" });
    if (!ALLOWED.has(file.mimetype)) {
      throw new BadRequestException({ code: "VALIDATION_FAILED", detail: "仅支持 JPG/PNG/WebP 图片" });
    }
    let output: Buffer;
    try {
      output = await sharp(file.buffer)
        .rotate() // 按 EXIF 转正（手机竖拍）
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer();
    } catch {
      throw new BadRequestException({ code: "VALIDATION_FAILED", detail: "图片解析失败，请更换文件" });
    }
    if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
    const key = `${randomUUID()}.webp`;
    writeFileSync(join(UPLOAD_DIR, key), output);
    return { key, url: `/api/v1/files/${key}`, originalBytes: file.size, storedBytes: output.length };
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
