import { useCallback, useEffect, useState } from 'react'

import { read } from './archive'
import { FleetChart } from './charts'
import { DataEditor, editedCells } from './DataEditor'
import { compact, plain } from './format'
import type { Standing } from './grid'
import { type Answer, type Columns, loadQuestion, type Question, rowsFrom, solve } from './solver'
import { Tile } from './Tile'

/** What one solve of the pathway came to, read off an archive whether it was published or written in this tab. */
interface Outcome {
  periods: { year: number; condition: string; objective: number }[]
  fleet: Standing[]
}

type RecordRow = { specsolve_run: string; slice: string; termination_condition: string; objective: number | null }
type TotalRow = { specsolve_run: string; year: bigint | number; generator: string; value: number }

const RECORD = ['specsolve_run', 'slice', 'termination_condition', 'objective']
const TOTAL = ['specsolve_run', 'year', 'generator', 'value']

function outcome(record: RecordRow[], total: TotalRow[]): Outcome {
  return {
    periods: record
      .map((d) => ({ year: Number(d.slice), condition: d.termination_condition, objective: Number(d.objective ?? NaN) }))
      .sort((a, b) => a.year - b.year),
    fleet: total.map((d) => ({ run: d.specsolve_run, year: Number(d.year), generator: d.generator, value: d.value })),
  }
}

/** Every published scenario's outcome, from the two stacked files of the `runs` directory. */
async function loadPublished(): Promise<Map<string, Outcome>> {
  const [record, total] = await Promise.all([
    read<RecordRow>('runs', 'answer/record.parquet', RECORD),
    read<TotalRow>('runs', 'answer/primal/total.parquet', TOTAL),
  ])
  const runs = [...new Set(record.rows.map((d) => d.specsolve_run))].sort()
  return new Map(
    runs.map((run) => [
      run,
      outcome(
        record.rows.filter((d) => d.specsolve_run === run),
        total.rows.filter((d) => d.specsolve_run === run),
      ),
    ]),
  )
}

/** The outcome of a solve in this tab; a spec edited to drop `total` leaves its fleet empty. */
function localOutcome(answer: Answer): Outcome {
  const record = rowsFrom(answer.record).map((d) => ({ ...d, specsolve_run: 'here', slice: String(d[answer.key]) }))
  const total = answer.primal.total ? rowsFrom(answer.primal.total).map((d) => ({ ...d, specsolve_run: 'here' })) : []
  return outcome(record as RecordRow[], total as TotalRow[])
}

export function Solve() {
  const [published, setPublished] = useState<Map<string, Outcome> | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    loadPublished().then(setPublished, (e: unknown) => setError(String(e)))
  }, [])
  if (error) return <p className="error">The archives did not load: {error}</p>
  if (!published) return <p className="muted">Reading the archives…</p>
  return <Page published={published} />
}

type Run =
  | { state: 'idle' }
  | { state: 'running'; stage: string; started: number }
  | { state: 'done'; local: Outcome; seconds: number; waited: number; edited: boolean }
  | { state: 'refused'; message: string }
  | { state: 'failed'; message: string }

function Page({ published }: { published: Map<string, Outcome> }) {
  const scenarios = [...published.keys()]
  const [scenario, setScenario] = useState(scenarios.includes('base') ? 'base' : scenarios[0])
  const [question, setQuestion] = useState<Question | null>(null)
  const [spec, setSpec] = useState('')
  const [sources, setSources] = useState<Record<string, Columns>>({})
  const [run, setRun] = useState<Run>({ state: 'idle' })

  useEffect(() => {
    let current = true
    setQuestion(null)
    setRun({ state: 'idle' })
    loadQuestion(`runs/${scenario}`).then(
      (q) => {
        if (!current) return
        setQuestion(q)
        setSpec(q.spec)
        setSources(q.sources)
      },
      (e: unknown) => current && setRun({ state: 'failed', message: String(e) }),
    )
    return () => {
      current = false
    }
  }, [scenario])

  const edit = useCallback(
    (name: string, changes: Map<number, number>) =>
      setSources((now) => ({ ...now, [name]: { ...now[name], value: now[name].value.map((v, i) => changes.get(i) ?? v) } })),
    [],
  )

  const go = async () => {
    if (!question) return
    const started = performance.now()
    setRun({ state: 'running', stage: 'Starting', started })
    try {
      const answer = await solve({ ...question, spec, sources }, (stage) => setRun({ state: 'running', stage, started }))
      if ('refused' in answer) return setRun({ state: 'refused', message: answer.refused })
      const local = localOutcome(answer)
      setRun({ state: 'done', local, seconds: answer.seconds, waited: (performance.now() - started) / 1000, edited })
    } catch (e) {
      setRun({ state: 'failed', message: e instanceof Error ? e.message : String(e) })
    }
  }

  const reference = published.get(scenario)!
  const specEdited = question !== null && spec !== question.spec
  const cellsEdited = question === null ? 0 : Object.values(editedCells(sources, question.sources)).reduce((a, b) => a + b, 0)
  const edited = specEdited || cellsEdited > 0
  const busy = run.state === 'running'

  return (
    <>
      <header className="intro">
        <h1>Solve it yourself, in this tab</h1>
        <p>
          Every other page reads answers the showcase solved ahead of time. This one asks the question again. It loads Python
          and specsolve into your browser, takes a scenario's model and data straight out of its published archive, and
          solves the pathway here with HiGHS. Change the data or the model, solve again, and compare what comes back with
          what was published. The first solve downloads Python and its packages, which takes a while; nothing leaves your machine.
        </p>
      </header>

      <section className="controls" aria-label="Scenario">
        <div className="segmented" role="radiogroup" aria-label="Scenario">
          {scenarios.map((r) => (
            <button key={r} role="radio" aria-checked={r === scenario} className={r === scenario ? 'on' : undefined} onClick={() => setScenario(r)} disabled={busy}>
              {r.replace('_', ' ')}
            </button>
          ))}
        </div>
        <div className="solve-actions">
          <button className="action" onClick={go} disabled={!question || busy}>
            {busy ? `${run.stage}…` : 'Solve in this tab'}
          </button>
          {question && edited && (
            <button
              className="link"
              onClick={() => {
                setSpec(question.spec)
                setSources(question.sources)
              }}
              disabled={busy}
            >
              Undo my edits
            </button>
          )}
        </div>
      </section>

      {run.state === 'refused' && (
        <div className="card refused" role="alert">
          <h2>specsolve refused the model</h2>
          <pre>{run.message}</pre>
        </div>
      )}
      {run.state === 'failed' && (
        <p className="error" role="alert">
          The solve did not run: {run.message}
        </p>
      )}
      {run.state === 'done' && <Compare scenario={scenario} local={run.local} reference={reference} seconds={run.seconds} waited={run.waited} edited={run.edited} />}

      {question && <DataEditor key={scenario} sources={sources} published={question.sources} onEdit={edit} disabled={busy} />}

      <div className="card">
        <h2>The model{specEdited ? ', as you edited it' : ''}</h2>
        <p className="muted">
          <code>spec.yaml</code> of <code>runs/{scenario}</code>: one investment period, which the archive's axis runs once per
          year, each year inheriting the fleet the last one left.
        </p>
        <textarea
          className="spec"
          aria-label="The model, in YAML"
          spellCheck={false}
          wrap="off"
          value={question ? spec : 'Reading the archive…'}
          onChange={(e) => setSpec(e.target.value)}
          readOnly={!question || busy}
          rows={28}
        />
      </div>
    </>
  )
}

function Compare({
  scenario,
  local,
  reference,
  seconds,
  waited,
  edited,
}: {
  scenario: string
  local: Outcome
  reference: Outcome
  seconds: number
  waited: number
  edited: boolean
}) {
  const cost = (o: Outcome) => o.periods.reduce((s, d) => s + d.objective, 0)
  const optimal = local.periods.filter((d) => d.condition === 'optimal').length
  const technologies = [...new Set([...reference.fleet, ...local.fleet].map((d) => d.generator))].sort()
  const published = new Map(reference.periods.map((d) => [d.year, d.objective]))
  return (
    <>
      <div className="grid four">
        <Tile label="Cost of the pathway" value={compact(cost(local))} note={`published for ${scenario.replace('_', ' ')}: ${compact(cost(reference))}`} />
        <Tile label="Periods solved to optimality" value={`${optimal} of ${local.periods.length}`} note="each period is one solve, run in order" />
        <Tile label="Solving" value={`${seconds.toFixed(1)} s`} note="building and solving every period, in this tab" />
        <Tile label="Waiting" value={`${waited.toFixed(1)} s`} note="from the click, Python's download included on a first solve" />
      </div>
      <div className="grid two">
        <div className="card">
          <h2>Solved here{edited ? ', with your edits' : ''}</h2>
          <p className="muted">Standing capacity by period, as specsolve returned it in this tab.</p>
          {local.fleet.length > 0 ? <FleetChart fleet={local.fleet} technologies={technologies} /> : <p>The model no longer names a variable called <code>total</code>.</p>}
        </div>
        <div className="card">
          <h2>Published</h2>
          <p className="muted">The same, from the archive the showcase's solve job wrote.</p>
          <FleetChart fleet={reference.fleet} technologies={technologies} />
        </div>
      </div>
      <div className="card">
        <h2>Each period</h2>
        <div className="table-wrap">
          <table className="periods">
            <thead>
              <tr>
                <th>Period</th>
                <th>Termination</th>
                <th>Cost, solved here</th>
                <th>Cost, published</th>
                <th>Difference</th>
              </tr>
            </thead>
            <tbody>
              {local.periods.map((d) => {
                const then = published.get(d.year)
                return (
                  <tr key={d.year}>
                    <td>{d.year}</td>
                    <td>{d.condition}</td>
                    <td>{plain(d.objective)}</td>
                    <td>{then === undefined ? '—' : plain(then)}</td>
                    <td>{then === undefined ? '—' : plain(Math.round(d.objective - then) + 0)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
