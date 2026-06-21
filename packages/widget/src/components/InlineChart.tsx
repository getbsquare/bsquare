import React from 'react';

type AnySpec = any;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function toPairsFromSpec(spec: AnySpec): { x: string; y: number }[] {
  if (Array.isArray(spec?.data)) {
    const xKey = spec?.xKey ?? 'x';
    const yKey = spec?.yKey ?? 'y';
    return spec.data.map((d: any) => ({ x: String(d[xKey]), y: Number(d[yKey]) || 0 }));
  }
  if (Array.isArray(spec?.labels) && Array.isArray(spec?.values)) {
    return spec.labels.map((x: any, i: number) => ({ x: String(x), y: Number(spec.values[i]) || 0 }));
  }
  if (Array.isArray(spec?.series) && spec.series[0]?.data) {
    const xKey = spec?.xKey ?? 'x';
    const yKey = spec?.yKey ?? 'y';
    return spec.series[0].data.map((d: any) => ({ x: String(d[xKey]), y: Number(d[yKey]) || 0 }));
  }
  return [];
}

export default function InlineChart({ spec }: { spec: AnySpec }) {
  const type = (spec?.type || 'bar').toLowerCase();
  const width = clamp(Number(spec?.width) || 460, 200, 1000);
  const height = clamp(Number(spec?.height) || 220, 150, 600);
  const margin = { top: 16, right: 16, bottom: 28, left: 40 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const data = toPairsFromSpec(spec);
  const n = data.length || 1;
  const maxY = Math.max(0, ...data.map(d => d.y));
  const safeMaxY = maxY === 0 ? 1 : maxY;

  const xPos = (i: number) => (innerW / n) * i + (type === 'bar' ? (innerW / n) * 0.1 : 0);
  const barW = type === 'bar' ? (innerW / n) * 0.8 : 0;
  const yPos = (v: number) => innerH - (v / safeMaxY) * innerH;

  const tickCount = 4;
  const yTicks = new Array(tickCount + 1).fill(0).map((_, i) => (safeMaxY / tickCount) * i);

  const labelStep = Math.ceil(n / 10);

  const polyPoints = type === 'line' && n > 0
    ? data.map((d, i) => `${xPos(i) + (innerW / n) * 0.4},${yPos(d.y)}`).join(' ')
    : '';

  return (
    <div style={{ width: '100%' }}>
      {spec?.title ? (
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: '4px 0 6px' }}>
          {spec.title}
        </div>
      ) : null}
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        <g transform={`translate(${margin.left},${margin.top})`}>
          <line x1={0} y1={innerH} x2={innerW} y2={innerH} stroke="var(--border-primary)" strokeWidth={1} />
          <line x1={0} y1={0} x2={0} y2={innerH} stroke="var(--border-primary)" strokeWidth={1} />

          {yTicks.map((t, i) => (
            <g key={`yt-${i}`}>
              <line x1={0} y1={yPos(t)} x2={innerW} y2={yPos(t)} stroke="var(--bg-secondary)" strokeWidth={1} />
              <text x={-8} y={yPos(t)} textAnchor="end" dy="0.32em" style={{ fill: 'var(--text-secondary)', fontSize: 10 }}>{Math.round(t)}</text>
            </g>
          ))}

          {type === 'bar' && data.map((d, i) => (
            <g key={`b-${i}`}>
              <rect x={xPos(i)} y={yPos(d.y)} width={barW} height={innerH - yPos(d.y)} fill="var(--accent-primary)" rx={3} />
            </g>
          ))}

          {type === 'line' && (
            <g>
              <polyline points={polyPoints} fill="none" stroke="var(--accent-primary)" strokeWidth={2} />
              {data.map((d, i) => (
                <circle key={`p-${i}`} cx={xPos(i) + (innerW / n) * 0.4} cy={yPos(d.y)} r={3} fill="var(--accent-primary)" />
              ))}
            </g>
          )}

          {data.map((d, i) => (
            i % labelStep === 0 ? (
              <text key={`xl-${i}`} x={xPos(i) + (type === 'bar' ? barW / 2 : (innerW / n) * 0.4)} y={innerH + 16} textAnchor="middle" style={{ fill: 'var(--text-secondary)', fontSize: 10 }}>{d.x}</text>
            ) : null
          ))}
        </g>
      </svg>
    </div>
  );
}
