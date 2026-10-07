import { useMemo, useState } from 'react'
import {
  barY,
  binX,
  boxY,
  colorGradientLegend,
  d3Curve,
  defineChart,
  differenceY,
  dot,
  lineY,
  linearRegressionY,
  normalize,
  rect,
  ridgelineY,
  ruleX,
  ruleY,
  text,
} from '@tanstack/charts'
import { controlledSignal } from '@tanstack/charts/interaction/signal'
import { interactiveColorLegend } from '@tanstack/charts/legend'
import { decorative } from '@tanstack/charts/mark/decorative'
import { Chart } from '@tanstack/charts/react'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { scaleOrdinal } from '@tanstack/charts/scales/ordinal'
import { scalePoint } from '@tanstack/charts/scales/point'
import { tooltip } from '@tanstack/charts/tooltip'
import { interpolateRgbBasis } from 'd3-interpolate'
import { scaleLog, scaleSequential } from 'd3-scale'
import { curveBasis } from 'd3-shape'

import { compact, percent, plain } from './format'
import type { Driver, FutureCost, Hours, Plan } from './hedge'
import { SEQUENTIAL, technologyColors } from './palette'

const svgAnimation = { duration: 380, easing: 'ease-in-out' as const }

/** How many bins the cost axis is cut into, evenly on its log scale. */
const BINS = 32

/**
 * Bin edges for total cost, shared by every distribution chart so a plan's profile and its histogram line up.
 *
 * Even on a log scale, because the plan made for the average future runs four
 * times the cost of the hedges in its worst futures, and a linear axis would
 * crush every hedge into a few bins.
 */
export function costEdges(plans: Plan[]): number[] {
  const totals = plans.flatMap((p) => p.costs.map((d) => d.total))
  const low = Math.min(...totals) * 0.97
  const high = Math.max(...totals) * 1.03
  return Array.from({ length: BINS + 1 }, (_, i) => low * (high / low) ** (i / BINS))
}

/** Ticks at 1, 2, 3 and 5 of each decade within the range: what a log axis of costs reads well with. */
function logTicks(low: number, high: number): number[] {
  const ticks = []
  for (let decade = 10 ** Math.floor(Math.log10(low)); decade <= high; decade *= 10) {
    for (const m of [1, 2, 3, 5]) if (m * decade >= low && m * decade <= high) ticks.push(m * decade)
  }
  return ticks
}

function logAxis(low: number, high: number, label: string) {
  return {
    scale: scaleLog().domain([low, high]),
    grid: true,
    axis: { label, ticks: { values: logTicks(low, high), format: compact } },
  }
}

interface Observed {
  run: string
  label: string
  total: number
}

export function CostRidgeline({
  plans,
  here,
  edges,
  onPick,
}: {
  plans: Plan[]
  here: Plan
  edges: number[]
  onPick: (plan: Plan) => void
}) {
  const definition = useMemo(() => {
    const labels = plans.map((p) => p.label)
    const observed: Observed[] = plans.flatMap((p) => p.costs.map((d) => ({ run: p.run, label: p.label, total: d.total })))
    const profiles = normalize(
      binX(observed, { value: 'total', by: 'label', thresholds: edges, outputs: { count: { reduce: 'count' } } }),
      { value: 'count', by: 'label', basis: 'max', as: 'height' },
    )
    const paint = (label: string) =>
      label === here.label ? 'var(--accent)' : label === 'average' ? 'var(--hue-red)' : 'var(--muted)'
    return defineChart({
      marks: [
        ridgelineY(profiles, {
          x: 'x',
          y: 'label',
          height: 'height',
          overlap: 1.6,
          color: 'label',
          key: (d) => `${d.label}|${d.x}`,
          fillOpacity: 0.32,
          strokeWidth: 1.5,
          curve: d3Curve(curveBasis),
        }),
        dot(plans, { x: 'expected', y: 'label', key: (d) => `expected|${d.run}`, r: 4, fill: 'var(--ink)', stroke: 'var(--surface)', strokeWidth: 1.5 }),
        dot(plans, { x: 'tail', y: 'label', key: (d) => `tail|${d.run}`, r: 4.5, fill: 'var(--surface)', stroke: 'var(--ink)', strokeWidth: 2 }),
      ],
      scales: {
        x: logAxis(edges[0], edges[edges.length - 1], 'total cost in a future, log scale'),
        y: { scale: scalePoint<string>().domain(labels).padding(0.9) },
      },
      color: { scale: scaleOrdinal<string, string>().domain(labels).range(labels.map(paint)) },
      focus: 'nearest',
      tooltip: {
        use: tooltip,
        content: ([p]) => {
          const plan = plans.find((q) => q.label === (p.datum as { label: string }).label)!
          return {
            title: plan.label === 'average' ? 'planned for the average' : plan.label,
            rows: [
              { label: 'expected', value: plain(plan.expected) },
              { label: 'value at risk', value: plain(plan.atRisk) },
              { label: 'worst tenth', value: plain(plan.tail) },
            ],
          }
        },
      },
      svgAnimation,
    })
  }, [plans, here, edges])
  return (
    <Chart
      definition={definition}
      height={460}
      className="pickable"
      ariaLabel="How total cost is spread over the futures, one profile per plan; select one to show that plan"
      onSelect={(p) => {
        const plan = p?.datum && plans.find((q) => q.label === (p.datum as { label?: string }).label)
        if (plan) onPick(plan)
      }}
    />
  )
}

export function CostHistogram({ here, edges }: { here: Plan; edges: number[] }) {
  const definition = useMemo(() => {
    const bins = binX(here.costs, { value: 'total', thresholds: edges, outputs: { count: { reduce: 'count' } } })
    const top = Math.max(...bins.map((d) => d.count)) * 1.35
    const markers = [
      { x: here.expected, label: 'expected', paint: 'var(--ink)', dy: 12 },
      { x: here.atRisk, label: 'value at risk', paint: 'var(--muted)', dy: 28 },
      { x: here.tail, label: 'worst tenth', paint: 'var(--accent)', dy: 44 },
    ]
    return defineChart({
      marks: [
        ...[false, true].map((tail) =>
          rect(
            bins.filter((d) => (d.x2 > here.atRisk) === tail),
            { x1: 'x1', x2: 'x2', y1: () => 0, y2: 'count', key: (d) => d.x1, inset: 1, fill: tail ? 'var(--accent)' : 'var(--faint)' },
          ),
        ),
        ...markers.map((m) =>
          decorative(ruleX([m.x], { stroke: m.paint, strokeWidth: 2, strokeDasharray: m.label === 'value at risk' ? '4 3' : undefined })),
        ),
        decorative(text(markers, { x: 'x', y: () => top, key: (d) => d.label, text: 'label', dy: (d) => d.dy, dx: 5, anchor: 'start', fill: (d) => d.paint, fontWeight: 600 })),
        ruleY([0], { strokeOpacity: 0.6 }),
      ],
      scales: {
        x: { ...logAxis(edges[0], edges[edges.length - 1], 'total cost in a future, log scale'), grid: false },
        y: { scale: scaleLinear().domain([0, top]), grid: true, axis: { label: 'futures', ticks: { format: plain } } },
      },
      tooltip: {
        use: tooltip,
        content: ([p]) => ({
          title: `${compact(p.datum.x1)} – ${compact(p.datum.x2)}`,
          rows: [{ label: 'futures', value: String(p.datum.count) }],
        }),
      },
      svgAnimation,
    })
  }, [here, edges])
  return (
    <Chart
      definition={definition}
      height={300}
      ariaLabel="How many futures fall at each total cost under this plan, with its expected cost, value at risk and worst-tenth average marked"
    />
  )
}

interface Paired {
  future: string
  rank: number
  average: number
  hedge: number
}

export function SavingsChart({
  hedge,
  average,
  future,
  onPickFuture,
}: {
  hedge: Plan
  average: Plan
  future: string
  onPickFuture: (future: string) => void
}) {
  const definition = useMemo(() => {
    const own = new Map(hedge.costs.map((d) => [d.future, d.total]))
    let mass = 0
    const rows: Paired[] = [...average.costs]
      .sort((a, b) => b.total - a.total)
      .map((d) => {
        const rank = mass + d.probability / 2
        mass += d.probability
        return { future: d.future, rank, average: d.total, hedge: own.get(d.future)! }
      })
    const picked = rows.filter((d) => d.future === future)
    const all = rows.flatMap((d) => [d.average, d.hedge])
    return defineChart({
      marks: [
        differenceY(rows, {
          x: 'rank',
          y1: 'average',
          y2: 'hedge',
          key: (d) => d.future,
          positiveFill: 'var(--hue-orange)',
          negativeFill: 'var(--hue-aqua)',
          fillOpacity: 0.35,
          stroke: 'var(--accent)',
          strokeWidth: 2,
          comparisonStroke: 'var(--hue-red)',
          comparisonStrokeWidth: 2,
        }),
        decorative(dot(picked, { x: 'rank', y: 'hedge', key: () => 'picked', r: 6, fill: 'var(--ink)', stroke: 'var(--surface)', strokeWidth: 2 })),
      ],
      scales: {
        x: {
          scale: scaleLinear().domain([0, 1]),
          axis: { label: 'futures, dearest first under the average plan, by probability', ticks: { format: percent } },
        },
        y: logAxis(Math.min(...all) * 0.95, Math.max(...all) * 1.05, 'total cost, log scale'),
      },
      focus: 'nearest-x',
      maxFocusDistance: Number.POSITIVE_INFINITY,
      tooltip: {
        use: tooltip,
        content: (points) => {
          const d = points.map((p) => p.datum).find((x): x is Paired => 'future' in (x as object))
          if (!d) return { title: '', rows: [] }
          return {
            title: d.future,
            rows: [
              { label: 'planned for the average', value: plain(d.average) },
              { label: `hedge at ${hedge.label}`, value: plain(d.hedge) },
              { label: d.hedge < d.average ? 'the hedge saves' : 'the hedge costs', value: plain(Math.abs(d.average - d.hedge)) },
            ],
          }
        },
      },
      svgAnimation,
    })
  }, [hedge, average, future])
  return (
    <Chart
      definition={definition}
      height={300}
      className="pickable"
      ariaLabel="Total cost in every future under the hedge and under the average plan, with the gap between them shaded; select a future to show its hours"
      onSelect={(p) => {
        const d = p?.datum as Partial<Paired> | undefined
        if (d?.future) onPickFuture(d.future)
      }}
    />
  )
}

interface Exposure extends FutureCost, Driver {
  inTail: boolean
}

export function DriverChart({
  here,
  drivers,
  future,
  onPickFuture,
}: {
  here: Plan
  drivers: Map<string, Driver>
  future: string
  onPickFuture: (future: string) => void
}) {
  const definition = useMemo(() => {
    const points: Exposure[] = here.costs.map((d) => ({ ...d, ...drivers.get(d.future)!, inTail: d.total >= here.atRisk }))
    const winds = points.map((d) => d.winterWind)
    const gas = points.map((d) => d.gas)
    return defineChart({
      marks: [
        decorative(linearRegressionY(points, { x: 'gas', y: 'opex', stroke: 'var(--muted)', strokeWidth: 2, strokeDasharray: '5 4' })),
        dot(points, { x: 'gas', y: 'opex', key: (d) => d.future, color: 'winterWind', r: 6, stroke: 'var(--surface)', strokeWidth: 1.5 }),
        decorative(
          dot(
            points.filter((d) => d.inTail),
            { x: 'gas', y: 'opex', key: (d) => `tail|${d.future}`, r: 10, fill: 'none', stroke: 'var(--accent)', strokeWidth: 2 },
          ),
        ),
        decorative(
          dot(
            points.filter((d) => d.future === future),
            { x: 'gas', y: 'opex', key: () => 'picked', r: 13, fill: 'none', stroke: 'var(--ink)', strokeWidth: 2 },
          ),
        ),
      ],
      scales: {
        x: {
          scale: scaleLinear().domain([Math.min(...gas) * 0.9, Math.max(...gas) * 1.05]),
          nice: true,
          grid: true,
          axis: { label: 'gas price, per MWh', ticks: { format: plain } },
        },
        y: { scale: scaleLinear, nice: true, grid: true, axis: { label: 'operating cost in the future', ticks: { format: compact } } },
      },
      color: {
        scale: scaleSequential(interpolateRgbBasis([...SEQUENTIAL].reverse())).domain([Math.min(...winds), Math.max(...winds)]),
        legend: colorGradientLegend({ label: 'winter wind, mean capacity factor', format: (v: number) => v.toFixed(2) }),
      },
      focus: 'nearest',
      tooltip: {
        use: tooltip,
        content: ([p]) => {
          const d = p.datum as Exposure
          return {
            title: `${d.future}${d.inTail ? ', in the tail' : ''}`,
            rows: [
              { label: 'gas price', value: `${plain(d.gas)} /MWh` },
              { label: 'winter wind', value: d.winterWind.toFixed(2) },
              { label: 'peak demand', value: `${plain(d.peak)} MW` },
              { label: 'operating cost', value: plain(d.opex) },
              { label: 'unserved', value: `${plain(d.unserved)} MWh` },
            ],
          }
        },
      },
      svgAnimation,
    })
  }, [here, drivers, future])
  return (
    <Chart
      definition={definition}
      height={340}
      className="pickable"
      ariaLabel="Operating cost in each future against its gas price, coloured by winter wind, with the tail ringed; select a future to show its hours"
      onSelect={(p) => {
        const d = p?.datum as Partial<Exposure> | undefined
        if (d?.future) onPickFuture(d.future)
      }}
    />
  )
}

interface Built {
  run: string
  label: string
  generator: string
  value: number
}

export function BuildChart({
  plans,
  here,
  technologies,
  onPick,
}: {
  plans: Plan[]
  here: Plan
  technologies: string[]
  onPick: (plan: Plan) => void
}) {
  const [visible, setVisible] = useState<readonly string[]>(technologies)
  const definition = useMemo(() => {
    const bars: Built[] = plans.flatMap((p) =>
      technologies.map((generator) => ({ run: p.run, label: p.label, generator, value: p.build.get(generator) ?? 0 })),
    )
    const shown = technologies.filter((g) => visible.includes(g)).reduce((s, g) => s + (here.build.get(g) ?? 0), 0)
    const top = Math.max(...plans.map((p) => [...p.build.values()].reduce((s, v) => s + v, 0)))
    return defineChart({
      marks: [
        barY(bars, {
          x: 'label',
          y: 'value',
          color: 'generator',
          key: (d) => `${d.run}|${d.generator}`,
          stroke: 'var(--surface)',
          strokeWidth: 2,
          radius: { end: 4, stack: 'outer' },
        }),
        decorative(text([{ label: here.label, top: shown }], { x: 'label', y: 'top', key: () => 'here', text: () => '▼', dy: -10, fill: 'var(--ink)' })),
        ruleY([0], { strokeOpacity: 0.6 }),
      ],
      scales: {
        x: {
          scale: scaleBand<string>().domain(plans.map((p) => p.label)).padding(0.25),
          axis: { label: 'weight on the worst futures →' },
        },
        y: { scale: scaleLinear().domain([0, top * 1.12]), grid: true, axis: { label: 'MW built', ticks: { format: compact } } },
      },
      color: {
        scale: scaleOrdinal<string, string>().domain(technologies).range(technologyColors(technologies)),
        legend: interactiveColorLegend({
          visible: controlledSignal(visible, setVisible),
          placement: 'bottom',
          hover: 'series',
          ariaLabel: 'Technologies shown',
        }),
      },
      focus: 'group-x',
      tooltip,
      svgAnimation,
    })
  }, [plans, here, technologies, visible])
  return (
    <Chart
      definition={definition}
      height={300}
      className="pickable"
      ariaLabel="Capacity each plan builds, MW, by technology; select a bar to show that plan"
      onSelect={(p) => {
        const plan = p?.datum && plans.find((q) => q.run === (p.datum as Built).run)
        if (plan) onPick(plan)
      }}
    />
  )
}

export function FrontierChart({ plans, here, onPick }: { plans: Plan[]; here: Plan; onPick: (plan: Plan) => void }) {
  const definition = useMemo(() => {
    const hedges = plans.filter((p) => p.omega !== null)
    return defineChart({
      marks: [
        decorative(lineY(hedges, { x: 'tail', y: 'expected', key: () => 'frontier', stroke: 'var(--accent)', strokeWidth: 2 })),
        dot(hedges, { x: 'tail', y: 'expected', key: (d) => d.run, r: 4.5, fill: 'var(--accent)', stroke: 'var(--surface)', strokeWidth: 2 }),
        decorative(text(hedges, { x: 'tail', y: 'expected', key: (d) => `label|${d.run}`, text: 'label', dx: 10, anchor: 'start', fill: 'var(--muted)' })),
        decorative(dot(here.omega === null ? [] : [here], { x: 'tail', y: 'expected', key: () => 'here', r: 9, fill: 'none', stroke: 'var(--ink)', strokeWidth: 2 })),
      ],
      margin: { right: 48 },
      scales: {
        x: { scale: scaleLinear, nice: true, grid: true, axis: { label: 'average cost of the worst tenth', ticks: { format: compact } } },
        y: { scale: scaleLinear, nice: true, grid: true, axis: { label: 'expected cost', ticks: { format: compact } } },
      },
      tooltip: {
        use: tooltip,
        items: [
          { field: 'label', label: 'plan' },
          { field: 'expected', label: 'expected', text: (p) => plain(p.datum.expected) },
          { field: 'tail', label: 'worst tenth', text: (p) => plain(p.datum.tail) },
        ],
      },
      svgAnimation,
    })
  }, [plans, here])
  return (
    <Chart
      definition={definition}
      height={300}
      className="pickable"
      ariaLabel="Expected cost against the average cost of the worst tenth, one dot per plan; select one to show it"
      onSelect={(p) => p?.datum && onPick(p.datum as Plan)}
    />
  )
}

interface Left {
  future: string
  slot: number
  value: number
}

/** The demand gas, the peaker and shedding cover in each hour, across every future: what wind and solar left. */
export function ResidualBoxes({
  hours,
  future,
  firm,
  renewables,
}: {
  hours: Hours
  future: string
  firm: number
  renewables: Set<string>
}) {
  const definition = useMemo(() => {
    const residual = new Map<string, Left>()
    for (const d of hours.output) {
      if (renewables.has(d.generator)) continue
      const key = `${d.future}|${d.slot}`
      const row = residual.get(key) ?? { future: d.future, slot: d.slot, value: 0 }
      row.value += d.value
      residual.set(key, row)
    }
    const rows = [...residual.values()].sort((a, b) => a.slot - b.slot)
    const slots = [...new Set(rows.map((d) => d.slot))]
    const line = rows.filter((d) => d.future === future)
    const top = Math.max(firm, ...rows.map((d) => d.value)) * 1.1
    return defineChart({
      marks: [
        boxY(rows, {
          x: 'slot',
          y: 'value',
          key: (d) => `${d.future}|${d.slot}`,
          fill: 'var(--accent)',
          fillOpacity: 0.25,
          stroke: 'var(--accent)',
          strokeWidth: 1,
          inset: 1,
          r: 2,
        }),
        decorative(lineY(line, { x: 'slot', y: 'value', key: () => 'picked', stroke: 'var(--ink)', strokeWidth: 2 })),
        decorative(ruleY([firm], { stroke: 'var(--hue-red)', strokeWidth: 2 })),
        decorative(
          text([{ slot: slots[slots.length - 1], firm }], {
            x: 'slot',
            y: 'firm',
            text: () => 'firm capacity',
            anchor: 'end',
            dy: -8,
            fill: 'var(--hue-red)',
            fontWeight: 600,
          }),
        ),
        ruleY([0], { strokeOpacity: 0.6 }),
      ],
      scales: {
        x: {
          scale: scaleBand<number>().domain(slots).padding(0.1),
          axis: { ticks: { values: hours.days.map((_, i) => i * 24 + 12), format: (v: number) => hours.days[Math.floor(v / 24)] } },
        },
        y: { scale: scaleLinear().domain([0, top]), grid: true, axis: { label: 'MW', ticks: { format: compact } } },
      },
      tooltip: {
        use: tooltip,
        content: ([p]) => {
          const d = p.datum as { kind?: string; category?: number; median?: number; q1?: number; q3?: number; value?: number; source?: readonly Left[] }
          const slot = d.category ?? 0
          const at = `${hours.days[Math.floor(slot / 24)]}, ${slot % 24}:00`
          return d.kind === 'outlier'
            ? { title: at, rows: [{ label: d.source?.[0]?.future ?? 'outlier', value: `${plain(d.value ?? 0)} MW` }] }
            : {
                title: at,
                rows: [
                  { label: 'median', value: `${plain(d.median ?? 0)} MW` },
                  { label: 'middle half', value: `${plain(d.q1 ?? 0)} – ${plain(d.q3 ?? 0)} MW` },
                ],
              }
        },
      },
      svgAnimation,
    })
  }, [hours, future, firm, renewables])
  return (
    <Chart
      definition={definition}
      height={320}
      ariaLabel="Demand left after wind and solar in every hour, as a box plot across all futures, with the picked future drawn"
    />
  )
}
