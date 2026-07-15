/** 中国轮廓示意地图（内嵌 SVG，无外部依赖），origins 板块用；金点标注产区省份 */
export interface MapPin {
  x: number;
  y: number;
  label: string;
  align?: "left" | "right";
}

/** 预置产区坐标（与 portal-data ORIGINS 顺序对应：黑龙江/浙江/湖北/广东） */
export const ORIGIN_PINS: Omit<MapPin, "label">[] = [
  { x: 340, y: 72, align: "left" },   // 黑龙江
  { x: 306, y: 202, align: "right" }, // 浙江
  { x: 262, y: 194, align: "left" },  // 湖北
  { x: 258, y: 258, align: "left" },  // 广东
  { x: 248, y: 226, align: "left" },  // 湖南（资兴·东江湖）
  { x: 178, y: 248, align: "left" },  // 云南（会泽）
];

const OUTLINE =
  "M3,126 L19,113 L45,81 L77,65 L90,49 L110,58 L148,97 L181,101 L206,109 L245,93 " +
  "L284,69 L297,45 L319,14 L348,45 L374,59 L396,54 L374,81 L368,101 L355,109 L329,122 " +
  "L310,132 L287,134 L297,146 L319,143 L300,162 L315,194 L303,223 L284,255 L258,267 " +
  "L239,279 L226,271 L213,263 L200,261 L181,274 L158,251 L161,219 L135,211 L116,220 " +
  "L77,216 L39,194 L6,150 Z";

export function ChinaMap({ pins, colors }: { pins: MapPin[]; colors: { fill: string; stroke: string; pin: string; text: string } }) {
  return (
    <svg viewBox="0 0 400 310" role="img" aria-label="Origins map of China" className="h-auto w-full">
      <path d={OUTLINE} fill={colors.fill} stroke={colors.stroke} strokeWidth="1.5" strokeLinejoin="round" />
      {/* 海南 / 台湾 示意 */}
      <ellipse cx="240" cy="292" rx="9" ry="6" fill={colors.fill} stroke={colors.stroke} strokeWidth="1" />
      <ellipse cx="312" cy="250" rx="5" ry="9" fill={colors.fill} stroke={colors.stroke} strokeWidth="1" />
      {pins.map((p) => (
        <g key={p.label}>
          <circle cx={p.x} cy={p.y} r="10" fill={colors.pin} opacity="0.25" />
          <circle cx={p.x} cy={p.y} r="4.5" fill={colors.pin} />
          <text
            x={p.x + (p.align === "left" ? -10 : 10)}
            y={p.y + 4}
            textAnchor={p.align === "left" ? "end" : "start"}
            fontSize="13"
            fill={colors.text}
          >
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
