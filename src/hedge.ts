import { read } from './archive'
import type { Hour } from './dispatch'

/** What one future came to under one plan. */
export interface FutureCost {
  run: string
  future: string
  /** What running the fleet cost in this future, unserved demand included. */
  opex: number
  /** The build cost plus `opex`: what this plan cost if this future arrives. */
  total: number
  probability: number
  /** The probability the plan weighed this future with: `(1 - omega) * probability` plus the tail dual. */
  weight: number
  /** MWh of demand left unserved across the year. */
  unserved: number
}

/** One archive of the hedge that plans against every future: a weight on the tail, or the average plan tested. */
export interface Plan {
  run: string
  label: string
  /** The weight on the tail; `null` for the plan made against the average future. */
  omega: number | null
  optimal: boolean
  build: Map<string, number>
  /** What stands after the build, existing capacity included. */
  standing: Map<string, number>
  capex: number
  /** The probability-weighted total cost over the futures. */
  expected: number
  /** The expected total cost of the worst `1 - alpha` of the probability. */
  tail: number
  costs: FutureCost[]
}

export interface Hedge {
  /** The plans by rising weight on the tail, then the average plan. */
  plans: Plan[]
  neutral: Plan
  average: Plan
  /** What knowing the future in advance would save the risk-neutral plan, in expectation. */
  evpi: number
  /** What planning against every future saves over planning against the average one, in expectation. */
  vss: number
  alpha: number
  futures: string[]
  technologies: string[]
  bytes: number
}

type Row = Record<string, unknown> & { specsolve_run: string }

/**
 * The mean of the dearest `1 - alpha` of the probability mass: the conditional value at risk.
 *
 * Computed from the costs rather than read off the model's `cvar`, which is
 * arbitrary in a plan that puts no weight on the tail.
 */
export function tailMean(values: number[], probabilities: number[], alpha: number): number {
  const order = values.map((_, i) => i).sort((a, b) => values[b] - values[a])
  const mass = 1 - alpha
  let taken = 0
  let sum = 0
  for (const i of order) {
    const share = Math.min(probabilities[i], mass - taken)
    if (share <= 0) break
    sum += share * values[i]
    taken += share
  }
  return sum / taken
}

/**
 * Load the hedge off the published archives: ten small stacked files.
 *
 * An archive's kind is its name — `risk-…`, `perfect-…` and `average-tested`,
 * as the showcase names them — and a plan's weight on the tail is read off its
 * own `omega` source.
 */
export async function loadHedge(): Promise<Hedge> {
  const files = await Promise.all([
    read<Row>('hedge', 'answer/record.parquet', ['specsolve_run', 'termination_condition']),
    read<Row>('hedge', 'sources/omega.parquet', ['specsolve_run', 'value']),
    read<Row>('hedge', 'sources/alpha.parquet', ['specsolve_run', 'value']),
    read<Row>('hedge', 'sources/probability.parquet', ['specsolve_run', 'future', 'value']),
    read<Row>('hedge', 'answer/primal/build.parquet', ['specsolve_run', 'generator', 'value']),
    read<Row>('hedge', 'answer/primal/total.parquet', ['specsolve_run', 'generator', 'value']),
    read<Row>('hedge', 'answer/expression/capex.parquet', ['specsolve_run', 'generator', 'value']),
    read<Row>('hedge', 'answer/expression/opex.parquet', ['specsolve_run', 'future', 'value']),
    read<Row>('hedge', 'answer/expression/unserved.parquet', ['specsolve_run', 'future', 'value']),
    read<Row>('hedge', 'answer/dual/tail_excess.parquet', ['specsolve_run', 'future', 'value']),
  ])
  const [record, omega, alphas, probability, build, total, capex, opex, unserved, tailDual] = files.map((f) => f.rows)
  const byRun = (rows: Row[]) => {
    const map = new Map<string, Row[]>()
    for (const d of rows) map.set(d.specsolve_run, [...(map.get(d.specsolve_run) ?? []), d])
    return map
  }
  const keyed = (rows: Row[] | undefined, key: string) =>
    new Map((rows ?? []).map((d) => [String(d[key]), Number(d.value)]))
  const [omegas, probabilities, builds, totals, capexes, opexes, sheds, duals] = [
    omega,
    probability,
    build,
    total,
    capex,
    opex,
    unserved,
    tailDual,
  ].map(byRun)
  const alpha = Number(alphas[0].value)
  const optimal = new Map(record.map((d) => [d.specsolve_run, d.termination_condition === 'optimal']))

  const plan = (run: string): Plan => {
    const w = Number(omegas.get(run)![0].value)
    const p = keyed(probabilities.get(run), 'future')
    const dual = keyed(duals.get(run), 'future')
    const shed = keyed(sheds.get(run), 'future')
    const built = [...keyed(capexes.get(run), 'generator').values()].reduce((s, v) => s + v, 0)
    const costs = (opexes.get(run) ?? []).map((d) => {
      const future = String(d.future)
      return {
        run,
        future,
        opex: Number(d.value),
        total: built + Number(d.value),
        probability: p.get(future)!,
        weight: (1 - w) * p.get(future)! + (dual.get(future) ?? 0),
        unserved: shed.get(future) ?? 0,
      }
    })
    const values = costs.map((d) => d.total)
    const weights = costs.map((d) => d.probability)
    const average = run === 'average-tested'
    return {
      run,
      label: average ? 'average' : `ω ${w}`,
      omega: average ? null : w,
      optimal: optimal.get(run) ?? false,
      build: keyed(builds.get(run), 'generator'),
      standing: keyed(totals.get(run), 'generator'),
      capex: built,
      expected: costs.reduce((s, d) => s + d.probability * d.total, 0),
      tail: tailMean(values, weights, alpha),
      costs,
    }
  }

  const runs = [...omegas.keys()]
  const risk = runs
    .filter((r) => r.startsWith('risk-'))
    .map(plan)
    .sort((a, b) => a.omega! - b.omega!)
  const average = plan('average-tested')
  const neutral = risk[0]
  const perfect = runs.filter((r) => r.startsWith('perfect-')).map(plan)
  const foresight = neutral.costs.reduce((s, d) => {
    const own = perfect.find((q) => q.costs[0].future === d.future)!
    return s + d.probability * own.expected
  }, 0)
  return {
    plans: [...risk, average],
    neutral,
    average,
    evpi: neutral.expected - foresight,
    vss: average.expected - neutral.expected,
    alpha,
    futures: neutral.costs.map((d) => d.future).sort(),
    technologies: [...new Set(build.map((d) => String(d.generator)))].sort(),
    bytes: files.reduce((sum, f) => sum + f.bytes, 0),
  }
}

/** One hour of one typical day of one future. */
export interface FutureHour extends Hour {
  future: string
  value: number
}

export interface FutureOutput extends FutureHour {
  generator: string
}

/** Every hour of every future under one plan. */
export interface Hours {
  run: string
  /** Output by technology, with demand left unserved as one more technology, `unserved`. */
  output: FutureOutput[]
  load: FutureHour[]
  /** The balance dual over the day's weight and the future's weight in the plan: what one more MWh costs in that hour. */
  price: FutureHour[]
  days: string[]
}

/**
 * Load one plan's hours off its own archive, which the publish step copies whole: five files, about 70 KB.
 *
 * The stacked file of every plan's output holds over a million rows, so a
 * page reads the plan it shows rather than all of them.
 */
export async function loadHours(plan: Plan): Promise<Hours> {
  const directory = `hedge/${plan.run}`
  const [p, shed, balance, load, weight] = (
    await Promise.all([
      read<Row>(directory, 'answer/primal/p.parquet', ['future', 'day', 'hour', 'generator', 'value']),
      read<Row>(directory, 'answer/primal/shed.parquet', ['future', 'day', 'hour', 'value']),
      read<Row>(directory, 'answer/dual/balance.parquet', ['future', 'day', 'hour', 'value']),
      read<Row>(directory, 'sources/load.parquet', ['future', 'day', 'hour', 'value']),
      read<Row>(directory, 'sources/weight.parquet', ['day', 'value']),
    ])
  ).map((f) => f.rows)
  const days = [...new Set(weight.map((d) => String(d.day)))]
  const weights = new Map(weight.map((d) => [String(d.day), Number(d.value)]))
  const weightOf = new Map(plan.costs.map((d) => [d.future, d.weight]))
  const hour = (d: Row): FutureHour => ({
    future: String(d.future),
    day: String(d.day),
    hour: Number(d.hour),
    slot: days.indexOf(String(d.day)) * 24 + Number(d.hour),
    value: Number(d.value),
  })
  const bySlot = <T extends Hour>(a: T, b: T) => a.slot - b.slot
  return {
    run: plan.run,
    output: [
      ...p.map((d) => ({ ...hour(d), generator: String(d.generator) })),
      ...shed.map((d) => ({ ...hour(d), generator: 'unserved' })),
    ].sort(bySlot),
    load: load.map(hour).sort(bySlot),
    price: balance
      .map((d) => {
        const h = hour(d)
        return { ...h, value: h.value / (weights.get(h.day)! * weightOf.get(h.future)!) + 0 }
      })
      .sort(bySlot),
    days,
  }
}
