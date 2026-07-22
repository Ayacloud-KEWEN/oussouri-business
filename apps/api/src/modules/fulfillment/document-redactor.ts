import { Injectable, Logger } from "@nestjs/common";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import sharp from "sharp";

/**
 * 遮盖区域。坐标单位与原件一致：
 * - PDF：用户空间点（pt），**原点在页面左上角**（标注 UI 的直觉方向；渲染时换算成 PDF 的左下原点）
 * - 位图：像素，原点左上角
 * page 从 1 开始；位图恒为 1。
 */
export interface MaskRegion {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

export interface RedactionResult {
  body: Buffer;
  contentType: string;
  ext: string;
  /** 实际落到像素上的遮盖块数（用于审计与自检） */
  regionsApplied: number;
}

const WATERMARK_GRAY = rgb(0.55, 0.55, 0.55);

/**
 * 单证像素级打码（R1.6-3）。
 *
 * 元数据标记不构成脱敏——收件方拿到的字节里必须**不含**被遮盖内容。故此处对原件重新成像：
 * PDF 逐页盖实心黑块并铺平台水印；位图用 sharp 合成黑块与水印后重编码。
 * 注意：PDF 黑块是不透明矩形，覆盖其下的图形，但**不会删除文本层**——因此凡需遮盖的区域，
 * 上游必须确保原件是扫描件/图形章。文本型敏感字段请走"不外发原件、另出摘要"路径。
 */
@Injectable()
export class DocumentRedactor {
  private readonly logger = new Logger(DocumentRedactor.name);

  /** 能否对该扩展名做像素级打码 */
  static supports(ext: string): boolean {
    return ["pdf", "jpg", "jpeg", "png", "webp"].includes(ext.toLowerCase());
  }

  async redact(
    source: Buffer,
    ext: string,
    regions: MaskRegion[],
    watermark: string,
  ): Promise<RedactionResult> {
    const kind = ext.toLowerCase();
    if (kind === "pdf") return this.redactPdf(source, regions, watermark);
    return this.redactRaster(source, regions, watermark);
  }

  private async redactPdf(source: Buffer, regions: MaskRegion[], watermark: string): Promise<RedactionResult> {
    const pdf = await PDFDocument.load(source);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const pages = pdf.getPages();
    let applied = 0;

    for (const region of regions) {
      const page = pages[region.page - 1];
      if (!page) {
        this.logger.warn(`遮盖区域指向不存在的页 ${region.page}，已跳过`);
        continue;
      }
      const { height } = page.getSize();
      // 标注坐标以左上角为原点，PDF 以左下角为原点：翻转 y 并减去块高
      page.drawRectangle({
        x: region.x,
        y: height - region.y - region.h,
        width: region.w,
        height: region.h,
        color: rgb(0, 0, 0),
      });
      applied += 1;
    }

    // 水印铺全页（含未标注遮盖的页），副本可追溯到具体接收方
    for (const page of pages) {
      const { width, height } = page.getSize();
      page.drawText(watermark, {
        x: width * 0.08,
        y: height * 0.42,
        size: Math.max(10, Math.min(20, width / 32)),
        font,
        color: WATERMARK_GRAY,
        opacity: 0.35,
        rotate: degrees(30),
      });
      page.drawText(watermark, {
        x: 20,
        y: 14,
        size: 8,
        font,
        color: WATERMARK_GRAY,
        opacity: 0.8,
      });
    }

    const bytes = await pdf.save();
    return { body: Buffer.from(bytes), contentType: "application/pdf", ext: "pdf", regionsApplied: applied };
  }

  private async redactRaster(source: Buffer, regions: MaskRegion[], watermark: string): Promise<RedactionResult> {
    const image = sharp(source, { failOn: "none" });
    const meta = await image.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height) throw new Error("无法解析图片尺寸，拒绝外发未脱敏原件");

    const rects = regions
      .filter((r) => r.page === 1)
      .map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#000"/>`);
    const fontSize = Math.max(12, Math.round(width / 40));
    const overlay = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      ${rects.join("")}
      <text x="${Math.round(width * 0.06)}" y="${Math.round(height * 0.55)}" fill="#8c8c8c" fill-opacity="0.35"
            font-family="sans-serif" font-size="${fontSize * 1.4}"
            transform="rotate(-30 ${Math.round(width * 0.06)} ${Math.round(height * 0.55)})">${escapeXml(watermark)}</text>
      <text x="12" y="${height - 12}" fill="#8c8c8c" font-family="sans-serif" font-size="${fontSize}">${escapeXml(watermark)}</text>
    </svg>`;

    // 统一重编码为 PNG：抹掉原文件的 EXIF/XMP 等隐藏元数据，避免遮盖之外的泄露
    const body = await image
      .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
      .png()
      .toBuffer();
    return { body, contentType: "image/png", ext: "png", regionsApplied: rects.length };
  }
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}
