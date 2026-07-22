import sharp from "sharp";
import { PDFDocument, rgb } from "pdf-lib";
import { DocumentRedactor } from "./document-redactor";

const redactor = new DocumentRedactor();

/** 200×100 纯红底图：遮盖生效则对应像素必须变黑 */
async function redImage(): Promise<Buffer> {
  return sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer();
}

async function pixelAt(png: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return [data[offset]!, data[offset + 1]!, data[offset + 2]!];
}

describe("DocumentRedactor 位图打码", () => {
  it("遮盖区域内的像素被涂黑，区域外保持原样", async () => {
    const result = await redactor.redact(await redImage(), "png", [{ page: 1, x: 10, y: 10, w: 40, h: 20, label: "公章" }], "TRK-TEST");
    expect(result.regionsApplied).toBe(1);
    expect(await pixelAt(result.body, 20, 15)).toEqual([0, 0, 0]);
    expect(await pixelAt(result.body, 150, 15)).toEqual([255, 0, 0]);
  });

  it("非首页的区域不落到位图上", async () => {
    const result = await redactor.redact(await redImage(), "png", [{ page: 2, x: 0, y: 0, w: 50, h: 50, label: "第二页" }], "TRK-TEST");
    expect(result.regionsApplied).toBe(0);
    expect(await pixelAt(result.body, 10, 10)).toEqual([255, 0, 0]);
  });
});

describe("DocumentRedactor PDF 打码", () => {
  async function onePagePdf(): Promise<Buffer> {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([300, 400]);
    page.drawRectangle({ x: 0, y: 0, width: 300, height: 400, color: rgb(1, 0, 0) });
    return Buffer.from(await pdf.save());
  }

  it("产出仍是合法 PDF 且遮盖块被计入", async () => {
    const result = await redactor.redact(await onePagePdf(), "pdf", [{ page: 1, x: 20, y: 30, w: 100, h: 40, label: "公章" }], "TRK-TEST");
    expect(result.contentType).toBe("application/pdf");
    expect(result.regionsApplied).toBe(1);
    const reloaded = await PDFDocument.load(result.body);
    expect(reloaded.getPageCount()).toBe(1);
  });

  it("指向不存在页的区域被跳过而非报错", async () => {
    const result = await redactor.redact(await onePagePdf(), "pdf", [{ page: 9, x: 0, y: 0, w: 10, h: 10, label: "越界" }], "TRK-TEST");
    expect(result.regionsApplied).toBe(0);
  });

  it("支持的格式白名单", () => {
    expect(DocumentRedactor.supports("PDF")).toBe(true);
    expect(DocumentRedactor.supports("jpeg")).toBe(true);
    expect(DocumentRedactor.supports("docx")).toBe(false);
  });
});
