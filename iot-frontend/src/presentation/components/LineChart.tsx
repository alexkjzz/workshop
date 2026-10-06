import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { TimedValue } from '../../domain/telemetry';
import './LineChart.css';

type ChartPoint = TimedValue;

interface LineChartProps {
  points: ChartPoint[];
  label: string;
  formatValue: (value: number) => string;
  // Discrete states (presence): stepped line on a fixed domain with named ticks.
  steps?: { value: number; label: string }[];
}

const HEIGHT = 128;
const PADDING = { top: 10, right: 10, bottom: 22, left: 40 };
// Readings arrive every 2 s; a longer silence means the box was offline.
const GAP_MS = 10_000;

const timeFormat = new Intl.DateTimeFormat('fr-FR', { timeStyle: 'medium' });

function niceTicks(min: number, max: number, count: number) {
  const span = max - min || Math.abs(max) || 1;
  const rough = span / (count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((s) => s >= rough) ?? rough;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let tick = start; tick <= end + step / 2; tick += step) ticks.push(Number(tick.toFixed(10)));
  return ticks;
}

export function LineChart({ points, label, formatValue, steps }: LineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  if (points.length === 0) {
    return (
      <div ref={containerRef} className="chart chart--empty">
        En attente de données
      </div>
    );
  }

  const plotWidth = Math.max(width - PADDING.left - PADDING.right, 1);
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const firstTime = points[0].time;
  const lastTime = points[points.length - 1].time;
  const timeSpan = lastTime - firstTime || 1;

  const values = points.map((point) => point.value);
  const ticks = steps
    ? steps.map((step) => step.value)
    : niceTicks(Math.min(...values), Math.max(...values), 3);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1] === yMin ? yMin + 1 : ticks[ticks.length - 1];

  const x = (time: number) => PADDING.left + ((time - firstTime) / timeSpan) * plotWidth;
  const y = (value: number) => PADDING.top + (1 - (value - yMin) / (yMax - yMin)) * plotHeight;
  const baseline = PADDING.top + plotHeight;

  // One path per continuous run of readings.
  const runs: ChartPoint[][] = [];
  points.forEach((point, index) => {
    if (index === 0 || point.time - points[index - 1].time > GAP_MS) runs.push([]);
    runs[runs.length - 1].push(point);
  });
  const linePath = (run: ChartPoint[]) =>
    run
      .map((point, index) => {
        if (index === 0) return `M${x(point.time)},${y(point.value)}`;
        return steps
          ? `H${x(point.time)}V${y(point.value)}`
          : `L${x(point.time)},${y(point.value)}`;
      })
      .join('');
  const areaPath = (run: ChartPoint[]) =>
    `${linePath(run)}V${baseline}H${x(run[0].time)}Z`;

  const last = points[points.length - 1];
  const active = hovered === null ? null : points[hovered];

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const time = firstTime + ((event.clientX - bounds.left - PADDING.left) / plotWidth) * timeSpan;
    let nearest = 0;
    points.forEach((point, index) => {
      if (Math.abs(point.time - time) < Math.abs(points[nearest].time - time)) nearest = index;
    });
    setHovered(nearest);
  };

  const tickLabel = (value: number) =>
    steps?.find((step) => step.value === value)?.label ?? formatValue(value);

  return (
    <div ref={containerRef} className="chart">
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`${label} : ${points.length} mesures, dernière valeur ${formatValue(last.value)}`}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHovered(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line className="chart-grid" x1={PADDING.left} x2={width - PADDING.right} y1={y(tick)} y2={y(tick)} />
              <text className="chart-tick" x={PADDING.left - 6} y={y(tick)} textAnchor="end" dominantBaseline="middle">
                {tickLabel(tick)}
              </text>
            </g>
          ))}
          <text className="chart-tick" x={PADDING.left} y={HEIGHT - 4}>
            {timeFormat.format(firstTime)}
          </text>
          <text className="chart-tick" x={width - PADDING.right} y={HEIGHT - 4} textAnchor="end">
            {timeFormat.format(lastTime)}
          </text>

          {runs.map((run) =>
            run.length === 1 ? (
              // An isolated reading (e.g. replayed after an outage) has no line to draw.
              <circle key={run[0].time} className="chart-point" cx={x(run[0].time)} cy={y(run[0].value)} r={2.5} />
            ) : (
              <g key={run[0].time}>
                <path className="chart-area" d={areaPath(run)} />
                <path className="chart-line" d={linePath(run)} />
              </g>
            ),
          )}
          <circle className="chart-dot" cx={x(last.time)} cy={y(last.value)} r={4} />

          {active && (
            <g>
              <line className="chart-crosshair" x1={x(active.time)} x2={x(active.time)} y1={PADDING.top} y2={baseline} />
              <circle className="chart-dot" cx={x(active.time)} cy={y(active.value)} r={4} />
            </g>
          )}
        </svg>
      )}
      {active && (
        <div
          className="chart-tooltip"
          style={{
            left: Math.min(Math.max(x(active.time), 60), width - 60),
          }}
        >
          <span>{timeFormat.format(active.time)}</span>
          <strong>{steps ? tickLabel(active.value) : formatValue(active.value)}</strong>
        </div>
      )}
    </div>
  );
}
