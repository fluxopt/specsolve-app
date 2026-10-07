import { useCallback, useDeferredValue, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
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
import { Visible } from './Visible'

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

/**
 * One plan's hours, and the last plan's while they load.
 *
 * Holding the last hours keeps the hourly charts mounted, so a new plan
 * updates them in place and the page does not jump while it loads.
 */
function useHours(plan: Plan): { hours: Hours | null; stale: boolean; error: string | null } {
  const [hours, setHours] = useState<Hours | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    loadHours(plan).then(
      (h) => current && setHours(h),
      (e: unknown) => current && setError(String(e)),
    )
    return () => {
      current = false
    }
  }, [plan])
  return { hours, stale: hours !== null && hours.run !== plan.run, error }
}

function Page({ hedge }: { hedge: Hedge }) {
  const hedges = useMemo(() => hedge.plans.filter((p) => p.omega !== null), [hedge])
  const [index, setIndex] = useState(0)
  const [average, setAverage] = useState(false)
  const chosen = average ? hedge.average : hedges[index]
  const here = useDeferredValue(chosen)
  const dearest = useMemo(
    () => [...hedge.neutral.costs].sort((a, b) => b.total - a.total)[0].future,
    [hedge],
  )
  const [picked, setFuture] = useState(dearest)
  const future = useDeferredValue(picked)
  const edges = useMemo(() => costEdges(hedge.plans), [hedge])
  const hedging = here.omega === null ? hedges[index] : here
  const { hours, stale, error } = useHours(here)
  const cursor = useMemo<SlotCursor>(() => createChartCursor<number, number>(), [])
  const hovered = useSyncExternalStore(cursor.subscribe, () => cursor.getState()?.value?.x ?? null)

  const pick = useCallback(
    (plan: Plan) => {
      setAverage(plan.omega === null)
      if (plan.omega !== null) setIndex(hedges.indexOf(plan))
    },
    [hedges],
  )
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
          Showing the archive <code>{chosen.run}</code>
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
        <Visible height={460}>
          <CostRidgeline plans={hedge.plans} here={here} edges={edges} onPick={pick} />
        </Visible>
      </div>

      <div className="grid two">
        <div className="card">
          <h2>The tail of {here.omega === null ? 'the average plan' : `the hedge at ${here.label}`}</h2>
          <p className="muted">
            How many futures fall at each cost. The value at risk is where the worst tenth begins, and the blue bars, from
            the one that holds it on, hold the tail whose average the plan weighs.
          </p>
          <Visible height={300}>
            <CostHistogram here={here} edges={edges} />
          </Visible>
        </div>
        <div className="card">
          <h2>Where the hedge at {hedging.label} pays, future by future</h2>
          <p className="muted">
            Each future's cost under the hedge, in blue, against the plan made for the average, in red. Green is what the
            hedge saves; orange is the premium it pays in the futures that turn out mild. Select a future to show its
            hours.
          </p>
          <Visible height={300}>
            <SavingsChart hedge={hedging} average={hedge.average} future={future} onPickFuture={setFuture} />
          </Visible>
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <h2>What each plan builds, MW</h2>
          <p className="muted">
            The more a plan weighs the worst futures, the more it builds. The peaker is the insurance: cheap to build, dear
            to run, and idle in most futures. Select a bar to show that plan; the legend hides a technology.
          </p>
          <Visible height={300}>
            <BuildChart plans={hedge.plans} here={here} technologies={hedge.technologies} onPick={pick} />
          </Visible>
        </div>
        <div className="card">
          <h2>What the insurance costs</h2>
          <p className="muted">
            Expected cost against the average cost of the worst {tailCount} futures, one dot per weight on the tail. The
            plan made for the average future is off the chart, worse on both: {compact(hedge.average.expected)} expected,{' '}
            {compact(hedge.average.tail)} in the worst futures.
          </p>
          <Visible height={300}>
            <FrontierChart plans={hedge.plans} here={here} onPick={pick} />
          </Visible>
        </div>
      </div>

      <div className="card">
        <h2>What makes a future dear</h2>
        <p className="muted">
          Each future's operating cost under this plan against the gas price it drew, coloured by how hard the wind blew
          in winter; dark is a lull. The futures in the tail are ringed. The dashed fit's slope is the plan's exposure to
          gas, and it flattens as the weight on the tail buys wind and solar. Select a future to show its hours.
        </p>
        <Visible height={340}>
          <DriverChart here={here} drivers={hedge.drivers} future={future} onPickFuture={setFuture} />
        </Visible>
      </div>

      <div className={stale ? 'card stale' : 'card'} aria-busy={stale}>
        <h2>
          The hours of {future}, which costs {compact(cost.total)} under this plan
        </h2>
        <p className="muted">
          Output by technology, with demand the fleet could not serve stacked on top in red. Pick another future in the
          charts above, or here:{' '}
          <select className="future" value={picked} onChange={(e) => setFuture(e.target.value)} aria-label="Future">
            {hedge.futures.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </p>
        {error && <p className="error">This plan's hours did not load: {error}</p>}
        {hours ? (
          <Visible height={340}>
            <OutputChart output={output} load={load} days={hours.days} technologies={technologies} cursor={cursor} />
          </Visible>
        ) : (
          !error && <p className="muted">Reading this plan's hours…</p>
        )}
      </div>

      {hours && (
        <div className={stale ? 'card stale' : 'card'} aria-busy={stale}>
          <h2>
            Price of one more MWh in {future}
            {hoveredPrice && ` — ${hoveredPrice.day}, ${hoveredPrice.hour}:00: ${plain(hoveredPrice.value)} /MWh`}
          </h2>
          <p className="muted">
            The balance dual over the day's weight and the future's weight in the plan. It reaches the value of lost load
            where demand is shed. Hover either chart to read one hour across both.
          </p>
          <Visible height={220}>
            <PriceChart price={price} days={hours.days} cursor={cursor} />
          </Visible>
        </div>
      )}

      {hours && (
        <div className={stale ? 'card stale' : 'card'} aria-busy={stale}>
          <h2>What wind and solar leave, in every future</h2>
          <p className="muted">
            The demand that gas, the peaker and shedding cover in each hour, as a box over all {n} futures: the middle
            half, whiskers to the last future within 1.5 times its spread, and the futures past that as dots. On most winter
            hours the wind leaves nothing in most futures, so the box sits at zero and the dots above it are the lulls. The
            line is {future}. Above the red line, firm capacity runs out and demand is shed.
          </p>
          <Visible height={320}>
            <ResidualBoxes hours={hours} future={future} firm={firm} renewables={RENEWABLES} />
          </Visible>
        </div>
      )}
    </>
  )
}
