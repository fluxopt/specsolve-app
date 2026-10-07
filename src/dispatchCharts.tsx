import { useMemo } from 'react'
import { areaY, colorLegend, d3Curve, defineChart, dot, lineY, ruleX, ruleY, text } from '@tanstack/charts'
import { crosshair } from '@tanstack/charts/crosshair'
import type { ChartCursorController } from '@tanstack/charts/cursor'
import { cursorHost } from '@tanstack/charts/cursor'
import { decorative } from '@tanstack/charts/mark/decorative'
import { Chart } from '@tanstack/charts/react'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { scaleOrdinal } from '@tanstack/charts/scales/ordinal'
import { tooltip } from '@tanstack/charts/tooltip'
import { curveStepAfter } from 'd3-shape'

import type { Hourly, Output } from './dispatch'
import { compact, plain } from './format'
import { technologyColors } from './palette'

/** A period or scenario change glides the stack from the old fleet to the new one. */
const svgAnimation = { duration: 450, easing: 'ease-in-out' as const }

/** The hour axis: every typical day end to end, ticked every six hours, with the day's name over its middle. */
function hourAxis(days: string[]) {
  const values = days.flatMap((_, i) => [0, 6, 12, 18].map((h) => i * 24 + h))
  return {
    scale: scaleLinear().domain([0, days.length * 24 - 1]),
    axis: { ticks: { values, format: (v: number) => `${v % 24}h` } },
  }
}

function dayMarks(days: string[], top: number) {
  const bounds = days.slice(1).map((_, i) => (i + 1) * 24 - 0.5)
  return [
    decorative(ruleX(bounds, { strokeOpacity: 0.35, strokeDasharray: '3 3' })),
    decorative(
      text(
        days.map((day, i) => ({ day, slot: i * 24 + 11.5, top })),
        { x: 'slot', y: 'top', text: 'day', fill: 'var(--muted)', fontWeight: 600, dy: -6 },
      ),
    ),
  ]
}

export type SlotCursor = ChartCursorController<number, number>

export function OutputChart({
  output,
  load,
  days,
  technologies,
  cursor,
}: {
  output: Output[]
  load: Hourly[]
  days: string[]
  technologies: string[]
  cursor: SlotCursor
}) {
  const definition = useMemo(() => {
    const top = Math.max(...load.map((d) => d.value)) * 1.12
    return defineChart({
      marks: [
        areaY(output, { x: 'slot', y: 'value', color: 'generator', fillOpacity: 0.88, stroke: 'var(--surface)' }),
        decorative(lineY(load, { x: 'slot', y: 'value', stroke: 'var(--ink)', strokeWidth: 2, strokeDasharray: '5 3' })),
        ...dayMarks(days, top),
        ruleY([0], { strokeOpacity: 0.6 }),
        crosshair({ x: { label: false }, y: false }),
      ],
      scales: {
        x: hourAxis(days),
        y: { scale: scaleLinear().domain([0, top]), grid: true, axis: { label: 'MW', ticks: { format: compact } } },
      },
      color: {
        scale: scaleOrdinal<string, string>().domain(technologies).range(technologyColors(technologies)),
        legend: colorLegend({ placement: 'bottom' }),
      },
      focus: 'group-x',
      maxFocusDistance: Number.POSITIVE_INFINITY,
      tooltip: {
        use: tooltip,
        content: (points) => ({
          title: `${points[0].datum.day}, ${points[0].datum.hour}:00`,
          rows: points.map((p) => ({ label: p.datum.generator, value: `${plain(Math.max(0, p.datum.value))} MW` })),
        }),
      },
      cursor: { use: cursorHost, controller: cursor, mode: 'focus' as const, match: 'x' as const },
      svgAnimation,
    })
  }, [output, load, days, technologies, cursor])
  return <Chart definition={definition} height={340} ariaLabel="Output by technology in every hour of the typical days, MW" />
}

export function PriceChart({ price, days, cursor }: { price: Hourly[]; days: string[]; cursor: SlotCursor }) {
  const definition = useMemo(() => {
    const top = Math.max(1, ...price.map((d) => d.value)) * 1.15
    return defineChart({
      marks: [
        lineY(price, { x: 'slot', y: 'value', stroke: 'var(--accent)', strokeWidth: 2, curve: d3Curve(curveStepAfter) }),
        ...dayMarks(days, top),
        ruleY([0], { strokeOpacity: 0.6 }),
        crosshair({ x: { label: false }, y: false }),
      ],
      scales: {
        x: hourAxis(days),
        y: { scale: scaleLinear().domain([0, top]), grid: true, axis: { label: 'per MWh', ticks: { format: compact } } },
      },
      focus: 'nearest-x',
      maxFocusDistance: Number.POSITIVE_INFINITY,
      tooltip: {
        use: tooltip,
        content: ([p]) => ({ title: `${p.datum.day}, ${p.datum.hour}:00`, rows: [{ label: 'price', value: `${plain(p.datum.value)} /MWh` }] }),
      },
      cursor: { use: cursorHost, controller: cursor, mode: 'focus' as const, match: 'x' as const },
      svgAnimation,
    })
  }, [price, days, cursor])
  return <Chart definition={definition} height={220} ariaLabel="Price of one more MWh of load in every hour" />
}

interface Ranked extends Hourly {
  rank: number
}

export function DurationChart({
  price,
  hovered,
  onHover,
}: {
  price: Hourly[]
  hovered: number | null
  onHover: (slot: number | null) => void
}) {
  const ranked = useMemo<Ranked[]>(
    () => [...price].sort((a, b) => b.value - a.value || a.slot - b.slot).map((d, rank) => ({ ...d, rank })),
    [price],
  )
  const definition = useMemo(() => {
    const at = ranked.filter((d) => d.slot === hovered)
    return defineChart({
      marks: [
        lineY(ranked, { x: 'rank', y: 'value', stroke: 'var(--accent)', strokeWidth: 2, key: (d) => d.rank }),
        decorative(dot(at, { x: 'rank', y: 'value', key: () => 'hovered', r: 6, fill: 'var(--accent)', stroke: 'var(--surface)', strokeWidth: 2 })),
        ruleY([0], { strokeOpacity: 0.6 }),
      ],
      scales: {
        x: { scale: scaleLinear().domain([0, ranked.length - 1]), axis: { label: 'hours, dearest first', ticks: { format: (v: number) => String(v + 1) } } },
        y: { scale: scaleLinear, nice: true, grid: true, axis: { label: 'per MWh', ticks: { format: compact } } },
      },
      focus: 'nearest-x',
      maxFocusDistance: Number.POSITIVE_INFINITY,
      tooltip: {
        use: tooltip,
        content: ([p]) => ({
          title: `${p.datum.day}, ${p.datum.hour}:00`,
          rows: [{ label: `rank ${p.datum.rank + 1}`, value: `${plain(p.datum.value)} /MWh` }],
        }),
      },
      svgAnimation,
    })
  }, [ranked, hovered])
  return (
    <Chart
      definition={definition}
      height={260}
      ariaLabel="Price duration curve: the hours sorted from dearest to cheapest"
      onFocusChange={(p) => onHover(p ? p.datum.slot : null)}
    />
  )
}
