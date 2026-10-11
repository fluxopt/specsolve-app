import { ARCHIVE, rowsOf } from './archive'

/** A table as `{column: values}`, the shape it crosses into Python and back. */
export type Columns = Record<string, unknown[]>

/** What a sweep's archive holds as its inputs: the spec, every source by name, and the text of `axis.json`. */
export interface Question {
  spec: string
  sources: Record<string, Columns>
  axis: string
}

/**
 * What a solve in the tab came to: the sweep's key column, its record, every variable's values, and the time it took.
 *
 * The record holds the key, `termination_condition` and `objective`, one row per slice.
 */
export interface Answer {
  key: string
  record: Columns
  primal: Record<string, Columns>
  seconds: number
}

/** What the worker posts: a stage while it works, then one answer, refusal or failure. */
export type Reply =
  | { kind: 'stage'; stage: string }
  | { kind: 'answer'; answer: Answer }
  | { kind: 'refused'; message: string }
  | { kind: 'failed'; message: string }

let worker: Worker | null = null
let queue: Promise<unknown> = Promise.resolve()

/**
 * Solve *question* in the worker, which loads Python and specsolve on its first solve.
 *
 * Solves run one at a time, in the order asked. *onStage* hears what the
 * worker is doing. Resolves to the answer, or to the message specsolve gave
 * where it refused the spec or its data; rejects if Python itself failed.
 */
export function solve(question: Question, onStage: (stage: string) => void): Promise<Answer | { refused: string }> {
  worker ??= new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' })
  const running = worker
  const asked = queue.then(
    () =>
      new Promise<Answer | { refused: string }>((resolve, reject) => {
        running.onmessage = ({ data }: MessageEvent<Reply>) => {
          if (data.kind === 'stage') onStage(data.stage)
          else if (data.kind === 'answer') resolve(data.answer)
          else if (data.kind === 'refused') resolve({ refused: data.message })
          else reject(new Error(data.message))
        }
        running.onerror = (event) => reject(new Error(event.message || 'the solver worker failed to start'))
        running.postMessage(question)
      }),
  )
  queue = asked.catch(() => undefined)
  return asked
}

/**
 * The inputs of one published sweep, such as `runs/base`: its spec, its sources as columns, and its axis.
 *
 * The sources are named by the archive's own `sources.parquet`, since a
 * static host cannot list a directory. The `specsolve_run` column every
 * archived file carries is left out, as specsolve leaves it out reading an
 * archive back.
 */
export async function loadQuestion(archive: string): Promise<Question> {
  const names = (await rowsOf(await fetchFile(archive, 'sources.parquet').then((r) => r.arrayBuffer()), ['source'])) as { source: string }[]
  const [spec, axis, tables] = await Promise.all([
    fetchFile(archive, 'spec.yaml').then((r) => r.text()),
    fetchFile(archive, 'axis.json').then((r) => r.text()),
    Promise.all(names.map((d) => fetchFile(archive, `sources/${d.source}.parquet`).then(async (r) => rowsOf(await r.arrayBuffer())))),
  ])
  return { spec, axis, sources: Object.fromEntries(names.map((d, i) => [d.source, columnsOf(tables[i] as Record<string, unknown>[])])) }
}

function columnsOf(rows: Record<string, unknown>[]): Columns {
  const names = Object.keys(rows[0] ?? {}).filter((c) => c !== 'specsolve_run')
  return Object.fromEntries(names.map((c) => [c, rows.map((d) => d[c])]))
}

/** One table of an answer as rows, the shape the charts take. */
export function rowsFrom(columns: Columns): Record<string, unknown>[] {
  const names = Object.keys(columns)
  return (columns[names[0]] ?? []).map((_, i) => Object.fromEntries(names.map((c) => [c, columns[c][i]])))
}

async function fetchFile(archive: string, path: string): Promise<Response> {
  const url = new URL(`${ARCHIVE}/${archive}/${path}`, window.location.href).href
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response
}
