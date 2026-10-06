import { useMemo } from 'react'
import {
  barY,
  cell,
  colorGradientLegend,
  colorLegend,
  defineChart,
  dot,
  lineY,
  ruleY,
  text,
  tickY,
} from '@tanstack/charts'
import { Chart } from '@tanstack/charts/react'
import { decorative } from '@tanstack/charts/mark/decorative'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { scaleOrdinal } from '@tanstack/charts/scales/ordinal'
import { tooltip } from '@tanstack/charts/tooltip'
import { interpolateRgbBasis } from 'd3-interpolate'
import { scaleSequential, scaleSequentialSqrt } from 'd3-scale'

import { compact, plain } from './format'
import type { Emitted, Grid, Point, Standing } from './grid'
import { SEQUENTIAL, technologyColors } from './palette'

/** Updates glide from the old geometry to the new one; the first paint does not animate. */
const svgAnimation = { duration: 320, easing: 'ease-in-out' as const }
const year = (d: number) => String(d)

export function FleetChart({ fleet, technologies }: { fleet: Standing[]; technologies: string[] }) {
  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          barY(fleet, {
            x: 'year',
            y: 'value',
            color: 'generator',
            key: (d) => `${d.year}|${d.generator}`,
            stroke: 'var(--surface)',
            strokeWidth: 2,
            radius: { end: 4, stack: 'outer' },
          }),
          ruleY([0], { strokeOpacity: 0.6 }),
        ],
        scales: {
          x: { scale: () => scaleBand<number>().padding(0.3), axis: { ticks: { format: year } } },
          y: { scale: scaleLinear, nice: true, grid: true, axis: { label: 'MW', ticks: { format: compact } } },
        },
        color: {
          scale: scaleOrdinal<string, string>().domain(technologies).range(technologyColors(technologies)),
          legend: colorLegend({ placement: 'bottom' }),
        },
        focus: 'group-x',
        tooltip,
        svgAnimation,
      }),
    [fleet, technologies],
  )
  return <Chart definition={definition} height={300} ariaLabel="Standing capacity by period, MW, by technology" />
}

interface Series extends Emitted {
  series: 'this point' | 'no cap'
}

export function EmissionsChart({
  here,
  uncapped,
  emissions,
  years,
  reach,
}: {
  here: Point
  uncapped: Point
  emissions: Emitted[]
  years: number[]
  reach: number
}) {
  const definition = useMemo(() => {
    const last = years[years.length - 1]
    const of = (run: string, series: Series['series']) =>
      emissions.filter((d) => d.run === run).map((d) => ({ ...d, series }))
    const baseline = of(uncapped.run, 'no cap')
    const point = here === uncapped ? [] : of(here.run, 'this point')
    const cap = here.cap <= reach ? [{ year: last, value: here.cap, label: 'cap' }] : []
    return defineChart({
      marks: [
        lineY(baseline, { x: 'year', y: 'value', color: 'series', strokeWidth: 2, strokeDasharray: '4 3' }),
        lineY(point, { x: 'year', y: 'value', color: 'series', strokeWidth: 2 }),
        dot([...baseline, ...point], {
          x: 'year',
          y: 'value',
          color: 'series',
          key: (d) => `${d.series}|${d.year}`,
          r: 4.5,
          stroke: 'var(--surface)',
          strokeWidth: 2,
        }),
        decorative(tickY(cap, { x: 'year', y: 'value', stroke: 'var(--ink)', strokeWidth: 2, length: 22 })),
        decorative(text(cap, { x: 'year', y: 'value', text: 'label', anchor: 'end', dx: -16, fill: 'var(--muted)' })),
        ruleY([0], { strokeOpacity: 0.6 }),
      ],
      scales: {
        x: { scale: scaleLinear, axis: { ticks: { values: years, format: year } } },
        y: { scale: scaleLinear, nice: true, grid: true, axis: { label: 'tonnes', ticks: { format: compact } } },
      },
      color: {
        scale: scaleOrdinal<string, string>().domain(['this point', 'no cap']).range(['var(--accent)', 'var(--muted)']),
        legend: point.length ? colorLegend({ placement: 'bottom' }) : undefined,
      },
      margin: { right: 24 },
      focus: 'group-x',
      tooltip,
      svgAnimation,
    })
  }, [here, uncapped, emissions, years, reach])
  return <Chart definition={definition} height={300} ariaLabel="CO2 per period, this point against no cap" />
}

export function Heatmap({
  grid,
  here,
  field,
  label,
  sqrt = false,
  onPick,
}: {
  grid: Grid
  here: Point
  field: 'cost' | 'price'
  label: string
  sqrt?: boolean
  onPick: (point: Point) => void
}) {
  const definition = useMemo(() => {
    const values = grid.points.map((d) => d[field])
    const domain: [number, number] = [Math.min(...values), Math.max(...values)]
    const ramp = interpolateRgbBasis(SEQUENTIAL)
    const color = sqrt ? scaleSequentialSqrt(ramp).domain(domain) : scaleSequential(ramp).domain(domain)
    const capOrder = grid.caps.map((c) => grid.points.find((d) => d.cap === c)!.capLabel)
    const solarOrder = grid.solars.map((s) => grid.points.find((d) => d.solar === s)!.solarLabel)
    return defineChart({
      marks: [
        cell(grid.points, { x: 'capLabel', y: 'solarLabel', color: field, key: (d) => d.run, inset: 1 }),
        decorative(
          cell([here], {
            x: 'capLabel',
            y: 'solarLabel',
            key: () => 'here',
            fill: 'none',
            stroke: 'var(--ink)',
            strokeWidth: 2.5,
            inset: 0,
          }),
        ),
      ],
      scales: {
        x: {
          scale: scaleBand<string>().domain(capOrder),
          axis: { label: 'CO₂ cap in the last period, tighter →', tickLabels: { rotate: -35 } },
        },
        y: {
          scale: scaleBand<string>().domain(solarOrder),
          reverse: true,
          axis: { label: 'solar build cost, per MW' },
        },
      },
      color: { scale: color, legend: colorGradientLegend({ label, format: compact }) },
      tooltip: {
        use: tooltip,
        items: [
          { field: 'capLabel', label: 'cap' },
          { field: 'solarLabel', label: 'solar cost' },
          { field, label, text: (p) => plain(p.datum[field]) },
        ],
      },
      svgAnimation,
    })
  }, [grid, here, field, label, sqrt])
  return (
    <Chart
      definition={definition}
      height={380}
      className="heatmap"
      ariaLabel={`${label} over the whole grid; select a cell to move the sliders to it`}
      onSelect={(p) => p?.datum && onPick(p.datum as Point)}
    />
  )
}

export function FrontierChart({ grid, here }: { grid: Grid; here: Point }) {
  const definition = useMemo(() => {
    const byCo2 = [...grid.points].sort((a, b) => a.co2 - b.co2)
    const line = byCo2.filter((d) => d.solar === here.solar)
    const xs = grid.points.map((d) => d.co2)
    const span = (Math.max(...xs) - Math.min(...xs)) / 4
    const tangent = [
      { co2: here.co2 - span, cost: here.cost + here.price * span },
      { co2: here.co2 + span, cost: here.cost - here.price * span },
    ]
    return defineChart({
      marks: [
        decorative(
          lineY(byCo2, { x: 'co2', y: 'cost', z: 'solarLabel', stroke: 'var(--faint)', strokeWidth: 1.5 }),
        ),
        decorative(lineY(line, { x: 'co2', y: 'cost', key: () => 'picked', stroke: 'var(--accent)', strokeWidth: 2 })),
        decorative(
          lineY(tangent, { x: 'co2', y: 'cost', key: () => 'tangent', stroke: 'var(--ink)', strokeWidth: 2, strokeDasharray: '5 4' }),
        ),
        dot(line, { x: 'co2', y: 'cost', key: (d) => d.run, r: 4.5, fill: 'var(--accent)', stroke: 'var(--surface)', strokeWidth: 2 }),
        decorative(dot([here], { x: 'co2', y: 'cost', key: () => 'here', r: 9, fill: 'none', stroke: 'var(--ink)', strokeWidth: 2 })),
        decorative(
          text([here], {
            x: 'co2',
            y: 'cost',
            key: () => 'here',
            text: (d) => `${d.capLabel}: ${plain(d.price)} /t`,
            dy: -18,
            fill: 'var(--ink)',
            fontWeight: 600,
          }),
        ),
      ],
      scales: {
        x: {
          scale: scaleLinear().domain([Math.min(...xs), Math.max(...xs)]),
          nice: true,
          reverse: true,
          grid: true,
          axis: { label: 'CO₂ in the last period, t', ticks: { format: compact } },
        },
        y: { scale: scaleLinear, nice: true, grid: true, axis: { label: 'pathway cost', ticks: { format: compact } } },
      },
      clip: true,
      tooltip: {
        use: tooltip,
        items: [
          { field: 'capLabel', label: 'cap' },
          { field: 'co2', label: 'CO₂', text: (p) => plain(p.datum.co2) },
          { field: 'cost', label: 'cost', text: (p) => plain(p.datum.cost) },
          { field: 'price', label: 'carbon price', text: (p) => plain(p.datum.price) },
        ],
      },
      svgAnimation,
    })
  }, [grid, here])
  return <Chart definition={definition} height={400} ariaLabel="Pathway cost against CO2, one curve per solar cost" />
}
