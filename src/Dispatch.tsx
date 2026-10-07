import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createChartCursor } from '@tanstack/charts/cursor'

import { type Dispatch as Data, loadDispatch } from './dispatch'
import { DurationChart, OutputChart, PriceChart, PriceSurface, type SlotCursor } from './dispatchCharts'
import { compact, percent, plain } from './format'
import { Tile } from './Tile'

/** How long each period holds while the pathway plays. */
const STEP_MS = 1400

export function Dispatch() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    loadDispatch().then(setData, (e: unknown) => setError(String(e)))
  }, [])
  if (error) return <p className="error">The archives did not load: {error}</p>
  if (!data) return <p className="muted">Reading the archives…</p>
  return <Page data={data} />
}

/** The hour every chart on the page points at, held in the charts' shared cursor. */
function useHoveredSlot(cursor: SlotCursor): number | null {
  return useSyncExternalStore(cursor.subscribe, () => cursor.getState()?.value?.x ?? null)
}

function Page({ data }: { data: Data }) {
  const [run, setRun] = useState(data.runs.includes('base') ? 'base' : data.runs[0])
  const [yearIndex, setYearIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const cursor = useMemo(() => createChartCursor<number, number>(), [])
  const hovered = useHoveredSlot(cursor)
  const year = data.years[yearIndex]

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      setYearIndex((i) => {
        if (i + 1 >= data.years.length) {
          setPlaying(false)
          return i
        }
        return i + 1
      })
    }, STEP_MS)
    return () => window.clearInterval(timer)
  }, [playing, data.years.length])

  const output = useMemo(() => data.output.filter((d) => d.run === run && d.year === year), [data, run, year])
  const load = useMemo(() => data.load.filter((d) => d.run === run && d.year === year), [data, run, year])
  const price = useMemo(() => data.price.filter((d) => d.run === run && d.year === year), [data, run, year])
  const surface = useMemo(() => data.price.filter((d) => d.run === run), [data, run])

  const clean = data.zeroCarbon.get(run) ?? new Set<string>()
  const energy = (rows: typeof output) => rows.reduce((s, d) => s + d.value * data.weight.get(d.day)!, 0)
  const cleanShare = energy(output.filter((d) => clean.has(d.generator))) / energy(output)
  const free = price.filter((d) => d.value < 1e-6).length
  const peak = price.reduce((top, d) => (d.value > top.value ? d : top), price[0])
  const atPeak = price.filter((d) => Math.abs(d.value - peak.value) < 1e-6).length
  const hoveredPrice = price.find((d) => d.slot === hovered)

  const play = () => {
    if (yearIndex === data.years.length - 1) setYearIndex(0)
    setPlaying(true)
  }
  // Redefining a chart that publishes its own hover re-reports its focus, so the same hour is not published twice.
  const publishHover = (slot: number | null) => {
    if (slot === (cursor.getState()?.value?.x ?? null)) return
    cursor.setState(slot === null ? null : { anchor: 'value', value: { x: slot }, source: 'programmatic', pinned: false })
  }

  return (
    <>
      <header className="intro">
        <h1>How the fleet runs, hour by hour</h1>
        <p>
          Each period is solved on {data.days.length} typical days of 24 hours. Here is what every technology produces in
          each of those hours, the demand it meets, and what one more MWh of demand would cost: the shadow price of the
          balance constraint, read straight out of the archive. Press play to watch the pathway unfold, or hover any hour
          — every chart follows.
        </p>
      </header>

      <section className="controls" aria-label="Scenario and period">
        <div className="segmented" role="radiogroup" aria-label="Scenario">
          {data.runs.map((r) => (
            <button key={r} role="radio" aria-checked={r === run} className={r === run ? 'on' : undefined} onClick={() => setRun(r)}>
              {r.replace('_', ' ')}
            </button>
          ))}
        </div>
        <div className="period">
          <button className="play" onClick={playing ? () => setPlaying(false) : play} aria-label={playing ? 'Pause' : 'Play the pathway'}>
            {playing ? '❚❚' : '▶'}
          </button>
          <div className="segmented" role="radiogroup" aria-label="Period">
            {data.years.map((y, i) => (
              <button
                key={y}
                role="radio"
                aria-checked={i === yearIndex}
                className={i === yearIndex ? 'on' : undefined}
                onClick={() => {
                  setPlaying(false)
                  setYearIndex(i)
                }}
              >
                {y}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="grid four">
        <Tile label="Zero-carbon energy" value={percent(cleanShare)} note={`of what is generated in ${year}, by ${[...clean].join(' and ')}`} />
        <Tile label="Free hours" value={`${free} of ${price.length}`} note="hours where one more MWh costs nothing: clean output is spare" />
        <Tile
          label="Dearest hour"
          value={`${compact(peak.value)} /MWh`}
          note={atPeak > 1 ? `${atPeak} hours at this price, the first ${peak.day}, ${peak.hour}:00` : `${peak.day}, ${peak.hour}:00`}
        />
        <Tile
          label={hoveredPrice ? `${hoveredPrice.day}, ${hoveredPrice.hour}:00` : 'Hover an hour'}
          value={hoveredPrice ? `${plain(hoveredPrice.value)} /MWh` : '—'}
          note={hoveredPrice ? 'the price in the hour every chart points at' : 'in any chart, to read one hour across all of them'}
        />
      </div>

      <div className="card">
        <h2>
          Output by hour, MW — {run.replace('_', ' ')}, {year}
        </h2>
        <p className="muted">Stacked by technology. Dashed: the demand the stack meets in every hour.</p>
        <OutputChart output={output} load={load} days={data.days} technologies={data.technologies} cursor={cursor} />
      </div>

      <div className="grid two wide-first">
        <div className="card">
          <h2>Price of one more MWh</h2>
          <p className="muted">The balance constraint's dual over the day's weight. It is zero where clean output is spare and jumps where the fleet runs short.</p>
          <PriceChart price={price} days={data.days} cursor={cursor} />
        </div>
        <div className="card">
          <h2>The same hours, dearest first</h2>
          <p className="muted">A price-duration curve. Hover it to find the hour on the left.</p>
          <DurationChart price={price} hovered={hovered} onHover={publishHover} />
        </div>
      </div>

      <div className="card">
        <h2>Price by hour and period — {run.replace('_', ' ')}</h2>
        <p className="muted">
          Every period at once: how the price structure moves as the fleet changes. The period shown above is drawn in
          full; select another row to show it.
        </p>
        <PriceSurface
          price={surface}
          days={data.days}
          years={data.years}
          year={year}
          hovered={hovered}
          onHover={publishHover}
          onPick={(y) => {
            setPlaying(false)
            setYearIndex(data.years.indexOf(y))
          }}
        />
      </div>
    </>
  )
}
