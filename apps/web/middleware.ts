import { NextRequest, NextResponse } from "next/server";

const LOCALES = ["zh-CN", "en", "fr"];
const DEFAULT_LOCALE = "en";

function pickLocale(req: NextRequest): string {
  const header = req.headers.get("accept-language") ?? "";
  if (header.toLowerCase().startsWith("zh")) return "zh-CN";
  if (header.toLowerCase().startsWith("fr")) return "fr";
  return DEFAULT_LOCALE;
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const hasLocale = LOCALES.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`));
  if (hasLocale) return NextResponse.next();
  const locale = pickLocale(req);
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}${pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|.*\\.).*)"],
};
