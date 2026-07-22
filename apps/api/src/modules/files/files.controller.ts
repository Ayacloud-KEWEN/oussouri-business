import {
  BadRequestException, Controller, Get, NotFoundException, Param, Post, Res,
  UploadedFile, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { Public } from "../iam/jwt-auth.guard";
import { Roles } from "../iam/roles.guard";
import { StoragePort } from "./storage.port";

/**
 * 产品图片服务（公开读）。单证原件走 fulfillment 的私有通道，不经此接口。
 * 存储后端由 StoragePort 决定（本地磁盘 / S3，R1-3）。
 * 上传自动压缩：限宽 1600、转 WebP q78（手机原图 5-10MB → 通常 <200KB）。
 */
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 12 * 1024 * 1024; // 压缩前上限（手机原图）
const KEY_PATTERN = /^[0-9a-f-]{36}\.webp$/;

@Controller("files")
export class FilesController {
  constructor(private readonly storage: StoragePort) {}

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
    const key = `${randomUUID()}.webp`;
    await this.storage.put(key, output, "image/webp");
    return { key, url: `/api/v1/files/${key}`, originalBytes: file.size, storedBytes: output.length };
  }

  @Public()
  @Get(":key")
  async serve(@Param("key") key: string, @Res() res: Response) {
    if (!KEY_PATTERN.test(key)) throw new NotFoundException({ code: "NOT_FOUND", detail: "文件不存在" });
    const obj = await this.storage.get(key);
    if (!obj) throw new NotFoundException({ code: "NOT_FOUND", detail: "文件不存在" });
    res.setHeader("Content-Type", obj.contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.end(obj.body);
  }
}
