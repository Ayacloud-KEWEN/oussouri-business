import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * 从 src（本地开发）或 dist（生产镜像）加载应用模块。
 *
 * 生产镜像按 package.json 的 `files` 白名单只装 dist/prisma/scripts —— 源码不进镜像。
 * 脚本若直接 `import "../src/..."`，本地跑得好好的，进了容器就 MODULE_NOT_FOUND
 * （2026-07-23 check-ledger 在 VPS 上就是这么挂的）。
 *
 * @param relPath 相对 apps/api 的模块路径，不带扩展名，如 "modules/settlement/ledger-invariants"
 */
export async function loadAppModule<T>(relPath: string): Promise<T> {
  const apiRoot = resolve(__dirname, "..", "..");
  const srcPath = resolve(apiRoot, "src", `${relPath}.ts`);
  const distPath = resolve(apiRoot, "dist", `${relPath}.js`);

  // 必须转 file:// URL：Windows 下把 `C:\...` 直接喂给动态 import 会报
  // ERR_UNSUPPORTED_ESM_URL_SCHEME（盘符被当成协议名）
  if (existsSync(srcPath)) return (await import(pathToFileURL(srcPath).href)) as T;
  if (existsSync(distPath)) return (await import(pathToFileURL(distPath).href)) as T;
  throw new Error(
    `找不到模块 ${relPath}：src 与 dist 下都没有。` +
      `容器内请确认镜像已构建（dist 存在）；本地请确认路径拼写。`,
  );
}
