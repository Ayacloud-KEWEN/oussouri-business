"use client";

import { useEffect, useState } from "react";
import type { Dictionary } from "@/lib/i18n";
import { api } from "@/lib/api";
import { INDUSTRY_INSIGHTS } from "@/lib/portal-data";

/**
 * 首页「产业与市场洞察」后台配置（R1.5-6）：
 * ConfigEntry(portal/industry-insights) JSON 覆盖内置默认值；清空恢复默认。
 */
export function PortalConfigEditor({ dict }: { dict: Dictionary }) {
  const t = dict.admin;
  const [text, setText] = useState("");
  const [hasOverride, setHasOverride] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    api<{ insights: object | null }>("GET", "/market/portal-config")
      .then((r) => {
        setHasOverride(Boolean(r.insights));
        setText(JSON.stringify(r.insights ?? INDUSTRY_INSIGHTS, null, 2));
      })
      .catch(() => setText(JSON.stringify(INDUSTRY_INSIGHTS, null, 2)));
  }, []);

  const save = async (value: object | null) => {
    setMessage(null);
    try {
      await api("PUT", "/market/portal-config", { insights: value });
      setHasOverride(Boolean(value));
      if (!value) setText(JSON.stringify(INDUSTRY_INSIGHTS, null, 2));
      setMessage(dict.common.success);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : dict.common.error);
    }
  };

  const onSave = () => {
    try {
      const parsed = JSON.parse(text) as object;
      if (typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not object");
      void save(parsed);
    } catch {
      setMessage(t.portalConfigInvalid);
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-3">
        <h2 className="font-medium" style={{ color: "var(--color-accent)" }}>{t.portalConfigTitle}</h2>
        <span className="text-xs" style={{ color: "var(--color-muted)" }}>
          {t.portalConfigHint} · {hasOverride ? t.portalConfigOverridden : t.portalConfigDefault}
        </span>
      </div>
      <textarea
        className="input h-64 w-full font-mono text-xs"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
      <div className="flex items-center gap-3">
        <button className="btn btn-primary" onClick={onSave}>{dict.common.save}</button>
        <button className="btn btn-outline" onClick={() => void save(null)}>{t.portalConfigReset}</button>
        {message && <span className="text-sm" style={{ color: "var(--color-muted)" }}>{message}</span>}
      </div>
    </section>
  );
}
