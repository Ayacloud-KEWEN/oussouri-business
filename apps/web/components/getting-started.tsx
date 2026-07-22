"use client";

import Link from "next/link";
import { useState } from "react";
import type { Dictionary } from "@/lib/i18n";

export interface GuideStep {
  /** 步骤标题 */
  title: string;
  /** 这一步要做什么、在哪里做 */
  hint: string;
  /** 是否已完成（由页面按真实数据判定） */
  done: boolean;
  /** 当前步骤的行动入口（站内路径）；无则只显示提示 */
  href?: string;
  /** 行动按钮文案 */
  cta?: string;
}

/**
 * 工作台新手引导（按真实数据状态动态显示进度）。
 * 全部完成后默认折叠——老用户不受打扰，新用户始终知道下一步点哪里。
 */
export function GettingStarted({ dict, steps }: { dict: Dictionary; steps: GuideStep[] }) {
  const t = dict.guide;
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  const [open, setOpen] = useState(!allDone);
  // 当前该做的一步：第一个未完成项
  const currentIndex = steps.findIndex((s) => !s.done);

  return (
    <section className="card space-y-3" style={{ borderColor: "var(--color-accent)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium" style={{ color: "var(--color-accent)" }}>
          🧭 {t.title}
          <span className="ml-2 text-xs font-normal" style={{ color: "var(--color-muted)" }}>
            {doneCount}/{steps.length} {allDone ? t.allDone : ""}
          </span>
        </h2>
        <button className="btn btn-outline text-xs" onClick={() => setOpen((v) => !v)}>
          {open ? t.collapse : t.expand}
        </button>
      </div>

      {/* 进度条 */}
      <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--color-border)" }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${(doneCount / steps.length) * 100}%`, background: "var(--color-accent)" }}
        />
      </div>

      {open && (
        <ol className="space-y-2.5">
          {steps.map((s, i) => {
            const isCurrent = i === currentIndex;
            return (
              <li
                key={s.title}
                className="flex gap-3 rounded-md p-2.5"
                style={isCurrent ? { background: "var(--color-accent-soft)" } : undefined}
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                  style={
                    s.done
                      ? { background: "var(--color-accent)", color: "var(--color-primary-foreground)" }
                      : { border: "1px solid var(--color-border)", color: "var(--color-muted)" }
                  }
                  aria-hidden
                >
                  {s.done ? "✓" : i + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-medium" style={s.done ? { color: "var(--color-muted)" } : undefined}>
                    {s.title}
                    {isCurrent && (
                      <span className="ml-2 rounded px-1.5 py-0.5 text-[10px]" style={{ background: "var(--color-accent)", color: "var(--color-primary-foreground)" }}>
                        {t.youAreHere}
                      </span>
                    )}
                  </p>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--color-muted)" }}>{s.hint}</p>
                  {isCurrent && s.href && s.cta && (
                    <Link href={s.href} className="btn btn-primary mt-1 inline-block text-xs">{s.cta} ›</Link>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
