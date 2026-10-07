import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createChartCursor } from '@tanstack/charts/cursor'

import { OutputChart, PriceChart, type SlotCursor } from './dispatchCharts'
import { compact, percent, plain } from './format'
import { type Hedge, type Hours, type Plan, loadHedge, loadHours } from './hedge'
import {
  BuildChart,
  CostHistogram,
  CostRidgeline,
  DriverChart,
  FrontierChart,
  ResidualBoxes,
  SavingsChart,
  costEdges,
} from './riskCharts'
import { Tile } from './Tile'

/** What the page leaves to wind and solar when it draws what the rest of the fleet must cover. */
const RENEWABLES = new Set(['solar', 'wind'])

export function Risk() {
  const [hedge, setHedge] = useState<Hedge | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    loadHedge().then(setHedge, (e: unknown) => setError(String(e)))
  }, [])
  if (error) return <p className="error">The archives did not load: {error}</p>
  if (!hedge) return <p className="muted">Reading the archives…</p>
  return <Page hedge={hedge} />
}

/** One plan's hours, read when the plan is first shown and kept for the visit. */
function useHours(plan: Plan): { hours: Hours | null; error: string | null } {
  const cache = useMemo(() => new Map<string, Promise<Hours>>(), [])
  const [hours, setHours] = useState<Hours | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    if (!cache.has(plan.run)) cache.set(plan.run, loadHours(plan))
    cache.get(plan.run)!.then(
      (h) => current && setHours(h),
      (e: unknown) => current && setError(String(e)),
    )
    return () => {
      current = false
    }
  }, [cache, plan])
  return { hours: hours?.run === plan.run ? hours : null, error }
}

function Page({ hedge }: { hedge: Hedge }) {
  const hedges = hedge.plans.filter((p) => p.omega !== null)
  const [index, setIndex] = useState(0)
  const [average, setAverage] = useState(false)
  const here = average ? hedge.average : hedges[index]
  const dearest = useMemo(
    () => [...hedge.neutral.costs].sort((a, b) => b.total - a.total)[0].future,
    [hedge],
  )
  const [future, setFuture] = useState(dearest)
  const edges = useMemo(() => costEdges(hedge.plans), [hedge])
  const hedging = hedges[index]
  const { hours, error } = useHours(here)
  const cursor = useMemo<SlotCursor>(() => createChartCursor<number, number>(), [])
  const hovered = useSyncExternalStore(cursor.subscribe, () => cursor.getState()?.value?.x ?? null)

  const pick = (plan: Plan) => {
    if (plan.omega === null) return setAverage(true)
    setAverage(false)
    setIndex(hedges.indexOf(plan))
  }
  const short = here.costs.filter((d) => d.unserved > 1e-6)
  const cost = here.costs.find((d) => d.future === future)!
  const firm = [...here.standing].filter(([g]) => !RENEWABLES.has(g)).reduce((s, [, v]) => s + v, 0)
  const output = hours?.output.filter((d) => d.future === future) ?? []
  const load = hours?.load.filter((d) => d.future === future) ?? []
  const price = hours?.price.filter((d) => d.future === future) ?? []
  const hoveredPrice = price.find((d) => d.slot === hovered)
  const technologies = [...hedge.technologies, 'unserved']
  const n = hedge.futures.length
  const tailCount = Math.round(n * (1 - hedge.alpha))

  return (
    <>
      <header className="intro">
        <h1>How much insurance is a fleet worth?</h1>
        <p>
          One investment period, planned once against {n} futures: each draws its own demand, weather and gas price,
          and the fleet is built before anyone knows which one arrives. Each plan weighs what the fleet is expected to
          cost against what it costs in the worst tenth of the futures. Every plan was solved ahead of time; this page
          reads {compact(hedge.bytes / 1024)} KB of parquet for the summary, and each plan's hours as you pick it.
        </p>
      </header>

      <section className="controls" aria-label="The plan">
        <div className="segmented sentence" role="radiogroup" aria-label="Plan">
          <button role="radio" aria-checked={!average} className={average ? undefined : 'on'} onClick={() => setAverage(false)}>
            Hedge every future
          </button>
          <button role="radio" aria-checked={average} className={average ? 'on' : undefined} onClick={() => setAverage(true)}>
            Plan for the average
          </button>
        </div>
        <label className="slider">
          <span>Weight on the worst tenth</span>
          <input
            type="range"
            min={0}
            max={hedges.length - 1}
            step={1}
            value={index}
            disabled={average}
            onChange={(e) => {
              setAverage(false)
              setIndex(Number(e.target.value))
            }}
          />
          <output>{average ? '—' : percent(hedges[index].omega!)}</output>
        </label>
        <p className="picked">
          Showing the archive <code>{here.run}</code>
        </p>
      </section>

      <div className="grid four">
        <Tile
          label="Expected cost"
          value={compact(here.expected)}
          note={here === hedge.neutral ? 'the least any plan expects to pay' : `${percent(here.expected / hedge.neutral.expected - 1)} over the risk-neutral plan`}
        />
        <Tile
          label={`Cost in the worst ${tailCount} futures`}
          value={compact(here.tail)}
          note={here === hedge.neutral ? 'their average, under the risk-neutral plan' : `${percent(here.tail / hedge.neutral.tail - 1)} against the risk-neutral plan`}
        />
        <Tile
          label="Futures that shed demand"
          value={`${short.length} of ${n}`}
          note={short.length ? `${plain(short.reduce((s, d) => s + d.unserved, 0) / short.length)} MWh unserved in each, on average` : 'every future is served in full'}
        />
        <Tile
          label="What planning for every future saves"
          value={compact(hedge.vss)}
          note={`over the plan made for the average future. Perfect foresight would save ${compact(hedge.evpi)} more`}
        />
      </div>

      <div className="card">
        <h2>How each plan's cost is spread over the {n} futures</h2>
        <p className="muted">
          One profile per plan: how many futures land at each total cost, on a log scale. The filled dot is the expected
          cost, the ring the average of the worst {tailCount}. As the weight on the tail rises the right edge pulls in;
          the plan made for the average future, in red, trails a tail four times as long. Select a profile to show that
          plan.
        </p>
        <CostRidgeline plans={hedge.plans} here={here} edges={edges} onPick={pick} />
      </div>

      <div className="grid two">
        <div className="card">
          <h2>The tail of {here.omega === null ? 'the average plan' : `the hedge at ${here.label}`}</h2>
          <p className="muted">
            How many futures fall at each cost. The value at risk is where the worst tenth begins, and the blue bars, from
            the one that holds it on, hold the tail whose average the plan weighs.
          </p>
          <CostHistogram here={here} edges={edges} />
        </div>
        <div className="card">
          <h2>Where the hedge at {hedging.label} pays, future by future</h2>
          <p className="muted">
            Each future's cost under the hedge, in blue, against the plan made for the average, in red. Green is what the
            hedge saves; orange is the premium it pays in the futures that turn out mild. Select a future to show its
            hours.
          </p>
          <SavingsChart hedge={hedging} average={hedge.average} future={future} onPickFuture={setFuture} />
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <h2>What each plan builds, MW</h2>
          <p className="muted">
            The more a plan weighs the worst futures, the more it builds. The peaker is the insurance: cheap to build, dear
            to run, and idle in most futures. Select a bar to show that plan; the legend hides a technology.
          </p>
          <BuildChart plans={hedge.plans} here={here} technologies={hedge.technologies} onPick={pick} />
        </div>
        <div className="card">
          <h2>What the insurance costs</h2>
          <p className="muted">
            Expected cost against the average cost of the worst {tailCount} futures, one dot per weight on the tail. The
            plan made for the average future is off the chart, worse on both: {compact(hedge.average.expected)} expected,{' '}
            {compact(hedge.average.tail)} in the worst futures.
          </p>
          <FrontierChart plans={hedge.plans} here={here} onPick={pick} />
        </div>
      </div>

      <div className="card">
        <h2>What makes a future dear</h2>
        <p className="muted">
          Each future's operating cost under this plan against the gas price it drew, coloured by how hard the wind blew
          in winter; dark is a lull. The futures in the tail are ringed. The dashed fit's slope is the plan's exposure to
          gas, and it flattens as the weight on the tail buys wind and solar. Select a future to show its hours.
        </p>
        <DriverChart here={here} drivers={hedge.drivers} future={future} onPickFuture={setFuture} />
      </div>

      <div className="card">
        <h2>
          The hours of {future}, which costs {compact(cost.total)} under this plan
        </h2>
        <p className="muted">
          Output by technology, with demand the fleet could not serve stacked on top in red. Pick another future in the
          charts above, or here:{' '}
          <select className="future" value={future} onChange={(e) => setFuture(e.target.value)} aria-label="Future">
            {hedge.futures.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </p>
        {error && <p className="error">This plan's hours did not load: {error}</p>}
        {hours ? (
          <OutputChart output={output} load={load} days={hours.days} technologies={technologies} cursor={cursor} />
        ) : (
          !error && <p className="muted">Reading this plan's hours…</p>
        )}
      </div>

      {hours && (
        <div className="card">
          <h2>
            Price of one more MWh in {future}
            {hoveredPrice && ` — ${hoveredPrice.day}, ${hoveredPrice.hour}:00: ${plain(hoveredPrice.value)} /MWh`}
          </h2>
          <p className="muted">
            The balance dual over the day's weight and the future's weight in the plan. It reaches the value of lost load
            where demand is shed. Hover either chart to read one hour across both.
          </p>
          <PriceChart price={price} days={hours.days} cursor={cursor} />
        </div>
      )}

      {hours && (
        <div className="card">
          <h2>What wind and solar leave, in every future</h2>
          <p className="muted">
            The demand that gas, the peaker and shedding cover in each hour, as a box over all {n} futures: the middle
            half, whiskers to the last future within 1.5 times its spread, and the futures past that as dots. On most winter
            hours the wind leaves nothing in most futures, so the box sits at zero and the dots above it are the lulls. The
            line is {future}. Above the red line, firm capacity runs out and demand is shed.
          </p>
          <ResidualBoxes hours={hours} future={future} firm={firm} renewables={RENEWABLES} />
        </div>
      )}
    </>
  )
}
