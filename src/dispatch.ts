import { read } from './archive'

/** One hour of one typical day, numbered across the days so a chart can run them end to end. */
export interface Hour {
  day: string
  hour: number
  slot: number
}

/** An hour of one period of one scenario. */
export interface Slot extends Hour {
  run: string
  year: number
}

export interface Output extends Slot {
  generator: string
  value: number
}

export interface Hourly extends Slot {
  value: number
}

export interface Dispatch {
  output: Output[]
  load: Hourly[]
  /** The balance dual over the day's weight: what one more MWh of load costs in that hour. */
  price: Hourly[]
  runs: string[]
  years: number[]
  days: string[]
  technologies: string[]
  zeroCarbon: Map<string, Set<string>>
  weight: Map<string, number>
}

type Row = Record<string, unknown> & { specsolve_run: string }

/**
 * Load hourly dispatch off the published scenario archives: five stacked files.
 *
 * The days run in the order the weight table lists them, which is the order
 * the scenarios supply them in.
 */
export async function loadDispatch(): Promise<Dispatch> {
  const [p, balance, load, weight, rate] = (
    await Promise.all([
      read<Row>('runs', 'answer/primal/p.parquet', ['specsolve_run', 'year', 'day', 'hour', 'generator', 'value']),
      read<Row>('runs', 'answer/dual/balance.parquet', ['specsolve_run', 'year', 'day', 'hour', 'value']),
      read<Row>('runs', 'sources/load.parquet', ['specsolve_run', 'year', 'day', 'hour', 'value']),
      read<Row>('runs', 'sources/weight.parquet', ['specsolve_run', 'day', 'value']),
      read<Row>('runs', 'sources/rate.parquet', ['specsolve_run', 'generator', 'value']),
    ])
  ).map((f) => f.rows)
  const days = [...new Set(weight.map((d) => String(d.day)))]
  const weights = new Map(weight.map((d) => [String(d.day), Number(d.value)]))
  const slot = (d: Row): Slot => ({
    run: d.specsolve_run,
    year: Number(d.year),
    day: String(d.day),
    hour: Number(d.hour),
    slot: days.indexOf(String(d.day)) * 24 + Number(d.hour),
  })
  const bySlot = <T extends Slot>(a: T, b: T) => a.slot - b.slot
  const zeroCarbon = new Map<string, Set<string>>()
  for (const d of rate.filter((d) => Number(d.value) === 0)) {
    zeroCarbon.set(d.specsolve_run, (zeroCarbon.get(d.specsolve_run) ?? new Set()).add(String(d.generator)))
  }
  const output = p.map((d) => ({ ...slot(d), generator: String(d.generator), value: Number(d.value) })).sort(bySlot)
  return {
    output,
    load: load.map((d) => ({ ...slot(d), value: Number(d.value) })).sort(bySlot),
    price: balance
      .map((d) => ({ ...slot(d), value: Number(d.value) / weights.get(String(d.day))! + 0 }))
      .sort(bySlot),
    runs: [...new Set(output.map((d) => d.run))].sort(),
    years: [...new Set(output.map((d) => d.year))].sort((a, b) => a - b),
    days,
    technologies: [...new Set(output.map((d) => d.generator))].sort(),
    zeroCarbon,
    weight: weights,
  }
}
