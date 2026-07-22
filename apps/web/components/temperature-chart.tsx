"use client";

interface TempPoint { recordedAt: string; tempC: string; breached: boolean; source: string }

/**
 * 冷链温度曲线（纯 SVG，无图表依赖）。
 * 鱼子酱要求 -2℃~0℃，超标点标红——买家一眼看出全程是否守住冷链。
 */
export function TemperatureChart({ data, title, unitLabel }: { data: TempPoint[]; title: string; unitLabel: string }) {
  if (data.length === 0) return null;

  const temps = data.map((d) => Number(d.tempC));
  const min = Math.min(...temps, -3);
  const max = Math.max(...temps, 1);
  const span = max - min || 1;
  const W = 640;
  const H = 140;
  const padX = 8;
  const padY = 12;
  const x = (i: number) => padX + (i / Math.max(data.length - 1, 1)) * (W - padX * 2);
  const y = (v: number) => padY + (1 - (v - min) / span) * (H - padY * 2);

  const line = temps.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  // 合规区间 -2℃~0℃ 的背景带
  const bandTop = y(0);
  const bandBottom = y(-2);

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium">{title}</p>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 320 }} role="img" aria-label={title}>
          <rect
            x={padX}
            y={bandTop}
            width={W - padX * 2}
            height={Math.max(bandBottom - bandTop, 1)}
            fill="var(--color-accent)"
            opacity="0.12"
          />
          <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" />
          {data.map((d, i) => (
            <circle
              key={i}
              cx={x(i)}
              cy={y(Number(d.tempC))}
              r={d.breached ? 3.5 : 2}
              fill={d.breached ? "var(--color-warning)" : "var(--color-accent)"}
            >
              <title>{`${d.recordedAt.slice(0, 16).replace("T", " ")} · ${d.tempC}${unitLabel}`}</title>
            </circle>
          ))}
        </svg>
      </div>
      <div className="flex justify-between text-[10px]" style={{ color: "var(--color-muted)" }}>
        <span>{data[0]!.recordedAt.slice(0, 10)}</span>
        <span>{min.toFixed(1)}{unitLabel} ~ {max.toFixed(1)}{unitLabel}</span>
        <span>{data[data.length - 1]!.recordedAt.slice(0, 10)}</span>
      </div>
    </div>
  );
}
