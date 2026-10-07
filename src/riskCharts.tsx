import { useMemo } from 'react'
import { areaY, barY, colorLegend, defineChart, dot, lineY, rect, ruleY, text } from '@tanstack/charts'
import { decorative } from '@tanstack/charts/mark/decorative'
import { Chart } from '@tanstack/charts/react'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { scaleOrdinal } from '@tanstack/charts/scales/ordinal'
import { tooltip } from '@tanstack/charts/tooltip'

import { dayMarks, hourAxis } from './dispatchCharts'
import { compact, percent, plain } from './format'
import type { FutureCost, Hours, Plan } from './hedge'
import { technologyColors } from './palette'

const svgAnimation = { duration: 380, easing: 'ease-in-out' as const }

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
  const definition = useMemo(() => {
    const bars: Built[] = plans.flatMap((p) =>
      technologies.map((generator) => ({ run: p.run, label: p.label, generator, value: p.build.get(generator) ?? 0 })),
    )
    const top = Math.max(...plans.map((p) => [...p.build.values()].reduce((s, v) => s + v, 0)))
    const marker = [{ label: here.label, top: [...here.build.values()].reduce((s, v) => s + v, 0) }]
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
        decorative(text(marker, { x: 'label', y: 'top', key: () => 'here', text: () => '▼', dy: -10, fill: 'var(--ink)' })),
        ruleY([0], { strokeOpacity: 0.6 }),
      ],
      scales: {
        x: {
          scale: scaleBand<string>().domain(plans.map((p) => p.label)).padding(0.25),
          axis: { label: 'weight on the worst futures →' },
        },
        y: {
          scale: scaleLinear().domain([0, top * 1.12]),
          grid: true,
          axis: { label: 'MW built', ticks: { format: compact } },
        },
      },
      color: {
        scale: scaleOrdinal<string, string>().domain(technologies).range(technologyColors(technologies)),
        legend: colorLegend({ placement: 'bottom' }),
      },
      focus: 'group-x',
      tooltip,
      svgAnimation,
    })
  }, [plans, here, technologies])
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

export function FrontierChart({
  plans,
  here,
  onPick,
}: {
  plans: Plan[]
  here: Plan
  onPick: (plan: Plan) => void
}) {
  const definition = useMemo(() => {
    const hedges = plans.filter((p) => p.omega !== null)
    return defineChart({
      marks: [
        decorative(lineY(hedges, { x: 'tail', y: 'expected', key: () => 'frontier', stroke: 'var(--accent)', strokeWidth: 2 })),
        dot(hedges, { x: 'tail', y: 'expected', key: (d) => d.run, r: 4.5, fill: 'var(--accent)', stroke: 'var(--surface)', strokeWidth: 2 }),
        decorative(
          text(hedges, { x: 'tail', y: 'expected', key: (d) => `label|${d.run}`, text: 'label', dx: 10, anchor: 'start', fill: 'var(--muted)' }),
        ),
        decorative(dot(here.omega === null ? [] : [here], { x: 'tail', y: 'expected', key: () => 'here', r: 9, fill: 'none', stroke: 'var(--ink)', strokeWidth: 2 })),
      ],
      margin: { right: 48 },
      scales: {
        x: { scale: scaleLinear, nice: true, grid: true, axis: { label: 'cost in the worst futures', ticks: { format: compact } } },
        y: { scale: scaleLinear, nice: true, grid: true, axis: { label: 'expected cost', ticks: { format: compact } } },
      },
      tooltip: {
        use: tooltip,
        items: [
          { field: 'label', label: 'plan' },
          { field: 'expected', label: 'expected', text: (p) => plain(p.datum.expected) },
          { field: 'tail', label: 'worst futures', text: (p) => plain(p.datum.tail) },
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
      ariaLabel="Expected cost against the cost in the worst futures, one dot per plan; select one to show it"
      onSelect={(p) => p?.datum && onPick(p.datum as Plan)}
    />
  )
}

interface Ranked extends FutureCost {
  rank: number
  plan: string
}

/** The futures of one plan from dearest to cheapest, each at the middle of the probability it carries. */
function ranked(plan: Plan, name: string): Ranked[] {
  let mass = 0
  return [...plan.costs]
    .sort((a, b) => b.total - a.total)
    .map((d) => {
      const rank = mass + d.probability / 2
      mass += d.probability
      return { ...d, rank, plan: name }
    })
}

export function CostCurve({
  here,
  neutral,
  average,
  alpha,
  future,
  onPickFuture,
}: {
  here: Plan
  neutral: Plan
  average: Plan
  alpha: number
  future: string
  onPickFuture: (future: string) => void
}) {
  const definition = useMemo(() => {
    const curves = [
      ...(here === average ? [] : ranked(here, 'this plan')),
      ...(here === neutral ? [] : ranked(neutral, 'risk-neutral')),
      ...ranked(average, 'planned for the average'),
    ]
    const series = [...new Set(curves.map((d) => d.plan))]
    const top = Math.max(...curves.map((d) => d.total)) * 1.05
    const picked = curves.filter((d) => d.future === future && d.plan === series[0])
    return defineChart({
      marks: [
        decorative(rect([{ x1: 0, x2: 1 - alpha, y1: 0, y2: top }], { x1: 'x1', x2: 'x2', y1: 'y1', y2: 'y2', fill: 'var(--faint)', fillOpacity: 0.35 })),
        decorative(text([{ x: 1 - alpha, y: top }], { x: 'x', y: 'y', text: () => 'the tail', anchor: 'start', dx: 6, dy: 14, fill: 'var(--muted)' })),
        lineY(curves, { x: 'rank', y: 'total', color: 'plan', key: (d) => `${d.plan}|${d.future}`, strokeWidth: 2 }),
        decorative(dot(picked, { x: 'rank', y: 'total', key: () => 'picked', r: 6, fill: 'var(--ink)', stroke: 'var(--surface)', strokeWidth: 2 })),
        ruleY([0], { strokeOpacity: 0.6 }),
      ],
      scales: {
        x: { scale: scaleLinear().domain([0, 1]), axis: { label: 'futures, dearest first, by probability', ticks: { format: percent } } },
        y: { scale: scaleLinear().domain([0, top]), grid: true, axis: { label: 'total cost', ticks: { format: compact } } },
      },
      color: {
        scale: scaleOrdinal<string, string>()
          .domain(['this plan', 'risk-neutral', 'planned for the average'])
          .range(['var(--accent)', 'var(--muted)', 'var(--hue-red)']),
        legend: colorLegend({ placement: 'bottom' }),
      },
      focus: 'nearest',
      tooltip: {
        use: tooltip,
        content: ([p]) => ({
          title: `${p.datum.future}, ${p.datum.plan}`,
          rows: [
            { label: 'total cost', value: plain(p.datum.total) },
            { label: 'unserved', value: `${plain(p.datum.unserved)} MWh` },
          ],
        }),
      },
      svgAnimation,
    })
  }, [here, neutral, average, alpha, future])
  return (
    <Chart
      definition={definition}
      height={300}
      className="pickable"
      ariaLabel="Total cost in every future, dearest first, for this plan, the risk-neutral plan and the average plan; select a future to show its hours"
      onSelect={(p) => p?.datum && onPickFuture((p.datum as Ranked).future)}
    />
  )
}

interface Weighed extends FutureCost {
  side: 'in the tail' | 'outside it'
}

export function WeightChart({
  here,
  future,
  onPickFuture,
}: {
  here: Plan
  future: string
  onPickFuture: (future: string) => void
}) {
  const definition = useMemo(() => {
    const bars: Weighed[] = [...here.costs]
      .sort((a, b) => b.total - a.total)
      .map((d) => ({ ...d, side: d.weight > d.probability * (1 + 1e-6) ? 'in the tail' : 'outside it' }))
    const top = Math.max(...bars.map((d) => d.weight)) * 1.15
    const picked = bars.filter((d) => d.future === future)
    return defineChart({
      marks: [
        barY(bars, { x: 'future', y: 'weight', color: 'side', key: (d) => d.future }),
        decorative(text(picked, { x: 'future', y: 'weight', key: () => 'picked', text: () => '▼', dy: -10, fill: 'var(--ink)' })),
        decorative(ruleY([bars[0].probability], { stroke: 'var(--ink)', strokeDasharray: '4 3' })),
        ruleY([0], { strokeOpacity: 0.6 }),
      ],
      scales: {
        x: {
          scale: scaleBand<string>().domain(bars.map((d) => d.future)).padding(0.15),
          axis: { label: 'futures, dearest first under this plan', ticks: { values: [] } },
        },
        y: { scale: scaleLinear().domain([0, top]), grid: true, axis: { label: 'weight', ticks: { format: (v: number) => `${(v * 100).toFixed(1)}%` } } },
      },
      color: {
        scale: scaleOrdinal<string, string>().domain(['in the tail', 'outside it']).range(['var(--accent)', 'var(--faint)']),
        legend: colorLegend({ placement: 'bottom' }),
      },
      tooltip: {
        use: tooltip,
        content: ([p]) => ({
          title: p.datum.future,
          rows: [
            { label: 'weighed at', value: `${(p.datum.weight * 100).toFixed(2)}%` },
            { label: 'probability', value: `${(p.datum.probability * 100).toFixed(2)}%` },
            { label: 'total cost', value: plain(p.datum.total) },
          ],
        }),
      },
      svgAnimation,
    })
  }, [here, future])
  return (
    <Chart
      definition={definition}
      height={260}
      className="pickable"
      ariaLabel="The weight the plan puts on each future against its probability; select a future to show its hours"
      onSelect={(p) => p?.datum && onPickFuture((p.datum as Weighed).future)}
    />
  )
}

interface Band {
  slot: number
  low: number
  q10: number
  q50: number
  q90: number
  high: number
}

function quantile(sorted: number[], q: number): number {
  const at = (sorted.length - 1) * q
  const below = Math.floor(at)
  return sorted[below] + (sorted[Math.min(below + 1, sorted.length - 1)] - sorted[below]) * (at - below)
}

/** The demand gas, the peaker and shedding cover in each hour, across every future: what wind and solar left. */
export function FanChart({
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
    const residual = new Map<string, number>()
    for (const d of hours.output) {
      if (renewables.has(d.generator)) continue
      const key = `${d.future}|${d.slot}`
      residual.set(key, (residual.get(key) ?? 0) + d.value)
    }
    const slots = [...new Set(hours.load.map((d) => d.slot))].sort((a, b) => a - b)
    const futures = [...new Set(hours.load.map((d) => d.future))]
    const bands: Band[] = slots.map((slot) => {
      const values = futures.map((f) => residual.get(`${f}|${slot}`) ?? 0).sort((a, b) => a - b)
      return { slot, low: values[0], q10: quantile(values, 0.1), q50: quantile(values, 0.5), q90: quantile(values, 0.9), high: values[values.length - 1] }
    })
    const line = slots.map((slot) => ({ slot, value: residual.get(`${future}|${slot}`) ?? 0 }))
    const top = Math.max(firm, ...bands.map((d) => d.high)) * 1.12
    return defineChart({
      marks: [
        decorative(areaY(bands, { x: 'slot', y1: 'low', y2: 'high', key: () => 'range', fill: 'var(--accent)', fillOpacity: 0.12 })),
        decorative(areaY(bands, { x: 'slot', y1: 'q10', y2: 'q90', key: () => 'middle', fill: 'var(--accent)', fillOpacity: 0.25 })),
        decorative(lineY(bands, { x: 'slot', y: 'q50', key: () => 'median', stroke: 'var(--accent)', strokeWidth: 1.5, strokeDasharray: '4 3' })),
        lineY(line, { x: 'slot', y: 'value', key: () => 'picked', stroke: 'var(--ink)', strokeWidth: 2 }),
        decorative(ruleY([firm], { stroke: 'var(--hue-red)', strokeWidth: 2 })),
        decorative(text([{ slot: slots[slots.length - 1], firm }], { x: 'slot', y: 'firm', text: () => 'firm capacity', anchor: 'end', dy: -8, fill: 'var(--hue-red)' })),
        ...dayMarks(hours.days, top),
        ruleY([0], { strokeOpacity: 0.6 }),
      ],
      scales: {
        x: hourAxis(hours.days),
        y: { scale: scaleLinear().domain([0, top]), grid: true, axis: { label: 'MW', ticks: { format: compact } } },
      },
      focus: 'nearest-x',
      maxFocusDistance: Number.POSITIVE_INFINITY,
      tooltip: {
        use: tooltip,
        content: ([p]) => ({ title: `${future}, hour ${p.datum.slot % 24}`, rows: [{ label: 'left for firm output', value: `${plain(p.datum.value)} MW` }] }),
      },
      svgAnimation,
    })
  }, [hours, future, firm, renewables])
  return <Chart definition={definition} height={300} ariaLabel="Demand left after wind and solar in every hour, across all futures, with the picked future drawn" />
}
