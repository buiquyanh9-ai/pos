import { useState } from 'react';
import { money, moneyShort } from '@shopflow/shared';

// Single-series charts: one hue (--chart), thin bars with rounded data-ends, recessive grid,
// hover/tap tooltip on every bar. Text uses text tokens, never the series color.

export interface BarDatum {
  key: string;
  label: string; // axis label
  value: number;
  detail?: string; // second tooltip line
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

export function BarChart({ data, height = 180, labelEvery = 1, title }: { data: BarDatum[]; height?: number; labelEvery?: number; title: string }) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const W = 100; // viewBox width in %, bars laid out evenly
  const slot = W / Math.max(1, data.length);
  const barW = Math.max(0.8, Math.min(slot * 0.62, 6));
  const ticks = [0, 0.5, 1].map((t) => t * max);
  const a = active !== null ? data[active] : null;
  return (
    <figure className="chart" aria-label={title}>
      <div className="chart-plot" style={{ height }} onMouseLeave={() => setActive(null)}>
        <div className="chart-y">
          {ticks
            .slice()
            .reverse()
            .map((t) => (
              <span key={t}>{moneyShort(t)}</span>
            ))}
        </div>
        <svg viewBox={`0 0 ${W} 100`} preserveAspectRatio="none" role="img" aria-label={title}>
          {ticks.map((t) => (
            <line key={t} x1="0" x2={W} y1={100 - (t / max) * 100} y2={100 - (t / max) * 100} className="grid" vectorEffect="non-scaling-stroke" />
          ))}
          {data.map((d, i) => {
            const h = d.value > 0 ? Math.max(0.8, (d.value / max) * 100) : 0;
            const x = i * slot + (slot - barW) / 2;
            return (
              <g key={d.key}>
                {h > 0 && <rect x={x} y={100 - h} width={barW} height={h} rx={Math.min(barW / 2, 1.2)} className={active === i ? 'bar on' : 'bar'} />}
                {/* hit target wider than the mark */}
                <rect x={i * slot} y={0} width={slot} height={100} fill="transparent" onMouseEnter={() => setActive(i)} onClick={() => setActive(i)} />
              </g>
            );
          })}
        </svg>
        {a && (
          <div className="tooltip" style={{ left: `calc(${((active! + 0.5) / data.length) * 100}% )` }}>
            <strong>{a.label}</strong>
            <span>{money(a.value)}</span>
            {a.detail && <span className="muted">{a.detail}</span>}
          </div>
        )}
      </div>
      <div className="chart-x">
        {data.map((d, i) => (
          <span key={d.key} style={{ width: `${100 / data.length}%` }}>
            {i % labelEvery === 0 ? d.label : ''}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** Ranked horizontal bars with direct labels: categories, top products, payment methods. */
export function RankBars({ rows, valueLabel }: { rows: { key: string; name: string; value: number; sub?: string }[]; valueLabel?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((s, r) => s + Math.max(0, r.value), 0) || 1;
  const fmt = valueLabel ?? money;
  if (!rows.length) return <p className="empty">Chưa có dữ liệu</p>;
  return (
    <ul className="rank">
      {rows.map((r) => (
        <li key={r.key} title={`${r.name}: ${fmt(r.value)}`}>
          <div className="rank-head">
            <span className="rank-name">{r.name}</span>
            <span className="rank-value">{fmt(r.value)}</span>
          </div>
          <div className="rank-track">
            <div className="rank-bar" style={{ width: `${(Math.max(0, r.value) / max) * 100}%` }} />
          </div>
          <div className="rank-sub muted">
            {r.sub ? `${r.sub} · ` : ''}
            {Math.round((Math.max(0, r.value) / total) * 1000) / 10}%
          </div>
        </li>
      ))}
    </ul>
  );
}
