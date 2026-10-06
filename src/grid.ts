import { read } from './archive'

/** One archive of the what-if grid: where it sits on the two sliders, and what it came to. */
export interface Point {
  run: string
  cap: number
  solar: number
  cost: number
  optimal: boolean
  co2: number
  price: number
  capLabel: string
  solarLabel: string
}

export interface Standing {
  run: string
  year: number
  generator: string
  value: number
}

export interface Emitted {
  run: string
  year: number
  value: number
}

export interface Grid {
  points: Point[]
  fleets: Standing[]
  emissions: Emitted[]
  caps: number[]
  solars: number[]
  years: number[]
  technologies: string[]
  zeroCarbon: Set<string>
  /** A cap above this no fleet in the grid reaches, so it binds nowhere and reads as "no cap". */
  reach: number
  bytes: number
}

type Row = Record<string, unknown> & { specsolve_run: string }

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

/**
 * Load the what-if grid off the published archives: seven stacked files.
 *
 * A point's sliders are read off its own inputs — the cap and the solar build
 * cost in the last period — so the grid's shape is whatever the solve job
 * wrote, not a list kept here.
 */
export async function loadGrid(): Promise<Grid> {
  const files = await Promise.all([
    read<Row>('grid', 'answer/record.parquet', ['specsolve_run', 'slice', 'objective', 'termination_condition']),
    read<Row>('grid', 'answer/primal/total.parquet', ['specsolve_run', 'year', 'generator', 'value']),
    read<Row>('grid', 'answer/expression/emissions.parquet', ['specsolve_run', 'year', 'value']),
    read<Row>('grid', 'answer/dual/carbon.parquet', ['specsolve_run', 'year', 'value']),
    read<Row>('grid', 'sources/cap.parquet', ['specsolve_run', 'year', 'value']),
    read<Row>('grid', 'sources/invest.parquet', ['specsolve_run', 'year', 'generator', 'value']),
    read<Row>('grid', 'sources/rate.parquet', ['specsolve_run', 'generator', 'value']),
  ])
  const [record, total, emitted, carbon, cap, invest, rate] = files.map((f) => f.rows)
  const years = [...new Set(emitted.map((d) => Number(d.year)))].sort((a, b) => a - b)
  const last = years[years.length - 1]
  const at = (rows: Row[], run: string, extra: (d: Row) => boolean = () => true) =>
    Number(rows.find((d) => d.specsolve_run === run && Number(d.year) === last && extra(d))?.value)

  const runs = [...new Set(record.map((d) => d.specsolve_run))].sort()
  const points = runs.map((run) => {
    const periods = record.filter((d) => d.specsolve_run === run)
    return {
      run,
      cap: at(cap, run),
      solar: at(invest, run, (d) => d.generator === 'solar'),
      cost: periods.reduce((sum, d) => sum + Number(d.objective), 0),
      optimal: periods.every((d) => d.termination_condition === 'optimal'),
      co2: at(emitted, run),
      price: -at(carbon, run) + 0,
      capLabel: '',
      solarLabel: '',
    }
  })
  const reach = 10 * Math.max(...points.map((d) => d.co2))
  for (const d of points) {
    d.capLabel = d.cap > reach ? 'no cap' : `${compact.format(d.cap)} t`
    d.solarLabel = compact.format(d.solar)
  }
  const fleets = total.map((d) => ({
    run: d.specsolve_run,
    year: Number(d.year),
    generator: String(d.generator),
    value: Number(d.value),
  }))
  return {
    points,
    fleets,
    emissions: emitted.map((d) => ({ run: d.specsolve_run, year: Number(d.year), value: Number(d.value) })),
    caps: [...new Set(points.map((d) => d.cap))].sort((a, b) => b - a),
    solars: [...new Set(points.map((d) => d.solar))].sort((a, b) => a - b),
    years,
    technologies: [...new Set(fleets.map((d) => d.generator))].sort(),
    zeroCarbon: new Set(rate.filter((d) => Number(d.value) === 0).map((d) => String(d.generator))),
    reach,
    bytes: files.reduce((sum, f) => sum + f.bytes, 0),
  }
}
