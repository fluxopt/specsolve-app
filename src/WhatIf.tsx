import { useEffect, useMemo, useState } from 'react'

import { EmissionsChart, FleetChart, FrontierChart, Heatmap } from './charts'
import { compact, percent, plain } from './format'
import { type Grid, type Point, loadGrid } from './grid'

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="card tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      <div className="tile-note">{note}</div>
    </div>
  )
}

function Slider({
  label,
  values,
  index,
  format,
  onChange,
}: {
  label: string
  values: number[]
  index: number
  format: (v: number) => string
  onChange: (index: number) => void
}) {
  return (
    <label className="slider">
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={values.length - 1}
        step={1}
        value={index}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output>{format(values[index])}</output>
    </label>
  )
}

export function WhatIf() {
  const [grid, setGrid] = useState<Grid | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    loadGrid().then(setGrid, (e: unknown) => setError(String(e)))
  }, [])
  if (error) return <p className="error">The archives did not load: {error}</p>
  if (!grid) return <p className="muted">Reading the archives…</p>
  return <Page grid={grid} />
}

function Page({ grid }: { grid: Grid }) {
  const [capIndex, setCapIndex] = useState(Math.floor(grid.caps.length / 2))
  const [solarIndex, setSolarIndex] = useState(Math.floor(grid.solars.length / 2))
  const lookup = useMemo(() => new Map(grid.points.map((d) => [`${d.cap}|${d.solar}`, d])), [grid])
  const here = lookup.get(`${grid.caps[capIndex]}|${grid.solars[solarIndex]}`)!
  const uncapped = lookup.get(`${grid.caps[0]}|${here.solar}`)!
  const last = grid.years[grid.years.length - 1]
  const fleet = useMemo(() => grid.fleets.filter((d) => d.run === here.run), [grid, here])
  const standing = fleet.filter((d) => d.year === last)
  const total = standing.reduce((s, d) => s + d.value, 0)
  const clean = standing.filter((d) => grid.zeroCarbon.has(d.generator)).reduce((s, d) => s + d.value, 0)
  const premium = here.cost / uncapped.cost - 1
  const capLabel = (c: number) => (c > grid.reach ? 'no cap' : `${compact(c)} t`)
  const pick = (d: Point) => {
    setCapIndex(grid.caps.indexOf(d.cap))
    setSolarIndex(grid.solars.indexOf(d.solar))
  }

  return (
    <>
      <header className="intro">
        <h1>What if the cap were tighter, or solar cheaper?</h1>
        <p>
          Two sliders, and every position of them is a pathway the solve job has already solved and archived. Nothing
          solves in your browser: moving a slider looks up one of {grid.points.length} archives,{' '}
          {grid.points.length * grid.years.length} solves in all, which reach this page as{' '}
          {compact(grid.bytes / 1024)} KB of parquet read straight from the published archive.
        </p>
      </header>

      <section className="controls" aria-label="The two questions">
        <Slider label={`CO₂ cap in ${last}`} values={grid.caps} index={capIndex} format={capLabel} onChange={setCapIndex} />
        <Slider
          label={`Solar build cost in ${last}, per MW`}
          values={grid.solars}
          index={solarIndex}
          format={plain}
          onChange={setSolarIndex}
        />
        <p className="picked">
          Showing the archive <code>{here.run}</code>
        </p>
      </section>

      <div className="grid four">
        <Tile
          label="Pathway cost"
          value={compact(here.cost)}
          note={here === uncapped ? 'annualised, summed over the periods' : `${percent(premium)} more than with no cap, at this solar cost`}
        />
        <Tile
          label={`CO₂ in ${last}`}
          value={`${compact(here.co2)} t`}
          note={here === uncapped ? 'what the cheapest fleet emits' : `against ${compact(uncapped.co2)} t with no cap`}
        />
        <Tile
          label="Carbon price"
          value={`${plain(here.price)} /t`}
          note={here.price > 1e-6 ? 'the dual of the cap: what one tonne less would cost' : 'the cap does not bind, so a tonne is free'}
        />
        <Tile label="Zero-carbon fleet" value={percent(clean / total)} note={`share of capacity standing in ${last}`} />
      </div>

      <div className="grid two">
        <div className="card">
          <h2>Standing capacity, MW</h2>
          <p className="muted">The fleet this point builds, period by period. Only the last period is capped, so it is the one that changes.</p>
          <FleetChart fleet={fleet} technologies={grid.technologies} />
        </div>
        <div className="card">
          <h2>CO₂ per period, t</h2>
          <p className="muted">This point, against the same solar cost with no cap. The mark in {last} is the cap.</p>
          <EmissionsChart here={here} uncapped={uncapped} emissions={grid.emissions} years={grid.years} reach={grid.reach} />
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <h2>Pathway cost, over the whole grid</h2>
          <p className="muted">Every archive at once. Select a cell to move the sliders to it.</p>
          <Heatmap grid={grid} here={here} field="cost" label="pathway cost" onPick={pick} />
        </div>
        <div className="card">
          <h2>Carbon price in {last}, over the whole grid</h2>
          <p className="muted">The dual of the cap, per tonne. It is zero wherever the cap does not bind, and climbs steeply for the last tonnes.</p>
          <Heatmap grid={grid} here={here} field="price" label="carbon price" sqrt onPick={pick} />
        </div>
      </div>

      <div className="card">
        <h2>What cutting the last tonnes costs</h2>
        <p className="muted">
          Pathway cost against CO₂ in {last}, one curve per solar cost; the one you picked is drawn, the others are grey.
          The dashed line through the point has the carbon price as its slope, and it touches the curve: the dual the
          solver returns is the rate at which cost rises as the cap tightens, read off one solve rather than two.
        </p>
        <FrontierChart grid={grid} here={here} />
      </div>

      <details className="card">
        <summary>Every point, as a table</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>cap</th>
                <th>solar cost</th>
                <th>pathway cost</th>
                <th>CO₂ in {last}</th>
                <th>carbon price</th>
                <th>optimal</th>
              </tr>
            </thead>
            <tbody>
              {grid.points.map((d) => (
                <tr key={d.run} className={d === here ? 'here' : undefined} onClick={() => pick(d)}>
                  <td>{d.capLabel}</td>
                  <td>{plain(d.solar)}</td>
                  <td>{plain(d.cost)}</td>
                  <td>{plain(d.co2)}</td>
                  <td>{plain(d.price)}</td>
                  <td>{d.optimal ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  )
}
