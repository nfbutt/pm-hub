// Small SVG charts drawn to one scale, colored from theme tokens. No chart library.
// Each chart measures its container and draws at real pixel width, so text never stretches.
import { useEffect, useRef, useState } from "react";

function useWidth(fallback = 760) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => { const cw = Math.round(e!.contentRect.width); if (cw > 0) setW(cw); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function niceTicks(max: number, target = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(s => s * mag).find(s => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v * 1e6) / 1e6);
  if (out[out.length - 1]! < max) out.push(out[out.length - 1]! + step);
  return out;
}

const shortDate = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

export interface Series { name: string; color: string; values: (number | null)[]; dashed?: boolean; area?: boolean }

/** Lines over a shared x axis of week-start dates. */
export function LineChart({ x, series, height = 240, label, markers = [] }: {
  x: string[]; series: Series[]; height?: number; label: string; markers?: { at: number; label: string; color: string }[];
}) {
  const [ref, W] = useWidth();
  const H = height, L = 40, R = 16, T = 14, B = 26;
  const max = Math.max(1, ...series.flatMap(s => s.values.filter((v): v is number => v !== null)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const px = (i: number) => L + (x.length <= 1 ? 0 : (i / (x.length - 1)) * (W - L - R));
  const py = (v: number) => T + (1 - v / top) * (H - T - B);
  const every = Math.max(1, Math.ceil(x.length / Math.max(2, Math.floor(W / 90))));
  const path = (vals: (number | null)[]) => {
    let d = "", pen = false;
    vals.forEach((v, i) => { if (v === null) { pen = false; return; } d += `${pen ? "L" : "M"}${px(i).toFixed(1)},${py(v).toFixed(1)}`; pen = true; });
    return d;
  };
  return (
    <div ref={ref} className="chartbox"><svg className="chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {ticks.map(t => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={py(t)} y2={py(t)} className="grid" />
          <text x={L - 6} y={py(t) + 3} textAnchor="end" className="tick">{t}</text>
        </g>
      ))}
      {x.map((d, i) => i % every === 0 ? <text key={i} x={px(i)} y={H - 8} textAnchor="middle" className="tick">{shortDate(d)}</text> : null)}
      {markers.map(mk => (
        <g key={mk.label}>
          <line x1={px(mk.at)} x2={px(mk.at)} y1={T} y2={H - B} stroke={mk.color} strokeDasharray="4 3" strokeWidth={1.5} />
          <text x={px(mk.at) + 4} y={T + 10} className="tick" fill={mk.color} style={{ fill: mk.color }}>{mk.label}</text>
        </g>
      ))}
      {series.map(s => (
        <g key={s.name}>
          {s.area && <path d={`${path(s.values)}L${px(s.values.length - 1)},${py(0)}L${px(s.values.findIndex(v => v !== null))},${py(0)}Z`} fill={s.color} opacity={0.1} />}
          <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2.2} strokeDasharray={s.dashed ? "6 4" : undefined} strokeLinejoin="round" />
          {(() => { const i = s.values.map((v, k) => (v === null ? -1 : k)).filter(k => k >= 0).pop(); return i === undefined ? null : <circle cx={px(i)} cy={py(s.values[i]!)} r={3.5} fill={s.color} />; })()}
        </g>
      ))}
    </svg></div>
  );
}

/** Vertical bars with value labels. */
export function BarChart({ labels, values, color, height = 160, label, highlightFrom }: {
  labels: string[]; values: number[]; color: string; height?: number; label: string; highlightFrom?: number;
}) {
  const [ref, W] = useWidth();
  const H = height, L = 32, R = 8, T = 16, B = 24;
  const ticks = niceTicks(Math.max(1, ...values), 3);
  const top = ticks[ticks.length - 1]!;
  const bw = (W - L - R) / Math.max(1, values.length);
  const every = Math.max(1, Math.ceil(values.length / Math.max(2, Math.floor(W / 70))));
  return (
    <div ref={ref} className="chartbox"><svg className="chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {ticks.map(t => (
        <g key={t}><line x1={L} x2={W - R} y1={T + (1 - t / top) * (H - T - B)} y2={T + (1 - t / top) * (H - T - B)} className="grid" />
          <text x={L - 6} y={T + (1 - t / top) * (H - T - B) + 3} textAnchor="end" className="tick">{t}</text></g>
      ))}
      {values.map((v, i) => {
        const h = (v / top) * (H - T - B);
        const x = L + i * bw + bw * 0.15;
        return (
          <g key={i}>
            <rect x={x} y={H - B - h} width={bw * 0.7} height={Math.max(0, h)} rx={2} fill={color} opacity={highlightFrom !== undefined && i < highlightFrom ? 0.35 : 1} />
            {v > 0 && <text x={x + bw * 0.35} y={H - B - h - 4} textAnchor="middle" className="tick strong">{v}</text>}
            {i % every === 0 && <text x={x + bw * 0.35} y={H - 8} textAnchor="middle" className="tick">{labels[i]}</text>}
          </g>
        );
      })}
    </svg></div>
  );
}
