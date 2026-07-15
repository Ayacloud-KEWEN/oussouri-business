"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { getSession } from "@/lib/api";

/**
 * 首页「发布采购需求」CTA：按登录状态智能路由。
 * 买家 → 采购工作台（RFQ 表单）；其他已登录角色 → 首页 RFQ 版块；未登录 → 注册入驻。
 */
export function RfqCta({ locale, label, style }: { locale: string; label: string; style?: CSSProperties }) {
  const [href, setHref] = useState(`/${locale}/register`);

  useEffect(() => {
    const sync = () => {
      const session = getSession();
      if (session?.roles?.includes("BUYER")) setHref(`/${locale}/buyer`);
      else if (session) setHref(`/${locale}#rfq`);
      else setHref(`/${locale}/register`);
    };
    sync();
    window.addEventListener("oussouri:session", sync);
    return () => window.removeEventListener("oussouri:session", sync);
  }, [locale]);

  return (
    <Link href={href} className="btn" style={style}>
      {label}
    </Link>
  );
}
