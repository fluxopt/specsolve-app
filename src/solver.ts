import { ARCHIVE, rowsOf } from './archive'

/** A table as `{column: values}`, the shape it crosses into Python and back. */
export type Columns = Record<string, unknown[]>

/**
 * What a sweep's archive holds as its inputs: the spec, every source by name, and the text of `axis.json`.
 *
 * With `archive`, the solve also writes the run as a specsolve archive, which
 * loads pyarrow into the worker the first time it is asked for.
 */
export interface Question {
  spec: string
  sources: Record<string, Columns>
  axis: string
  archive: boolean
}

/**
 * What a solve in the tab came to: the sweep's key column, its record, every variable's values, and the time it took.
 *
 * The record holds the key, `termination_condition` and `objective`, one row per slice. `archive` is the run as
 * a zip, where the question asked for it.
 */
export interface Answer {
  key: string
  record: Columns
  primal: Record<string, Columns>
  archive?: Uint8Array
  seconds: number
}

/** What the page asks the worker: to solve a question, or to typeset a spec. */
export type Ask = { kind: 'solve'; question: Question } | { kind: 'typeset'; spec: string }

/** What the worker posts: a stage while it works, then one answer, typeset model, refusal or failure. */
export type Reply =
  | { kind: 'stage'; stage: string }
  | { kind: 'answer'; answer: Answer }
  | { kind: 'typeset'; markdown: string }
  | { kind: 'refused'; message: string }
  | { kind: 'failed'; message: string }

let worker: Worker | null = null
let queue: Promise<unknown> = Promise.resolve()

/**
 * Send *ask* to the worker, which loads Python and specsolve on its first ask, and resolve to its final reply.
 *
 * Asks run one at a time, in the order asked. *onStage* hears what the worker
 * is doing. Rejects if Python itself failed.
 */
function asked(ask: Ask, onStage: (stage: string) => void): Promise<Exclude<Reply, { kind: 'stage' | 'failed' }>> {
  worker ??= new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' })
  const running = worker
  const reply = queue.then(
    () =>
      new Promise<Exclude<Reply, { kind: 'stage' | 'failed' }>>((resolve, reject) => {
        running.onmessage = ({ data }: MessageEvent<Reply>) => {
          if (data.kind === 'stage') onStage(data.stage)
          else if (data.kind === 'failed') reject(new Error(data.message))
          else resolve(data)
        }
        running.onerror = (event) => reject(new Error(event.message || 'the solver worker failed to start'))
        running.postMessage(ask)
      }),
  )
  queue = reply.catch(() => undefined)
  return reply
}

/**
 * Solve *question* in the worker. Resolves to the answer, or to the message specsolve gave where it refused the spec
 * or its data; rejects if Python itself failed.
 */
export async function solve(question: Question, onStage: (stage: string) => void): Promise<Answer | { refused: string }> {
  const reply = await asked({ kind: 'solve', question }, onStage)
  if (reply.kind === 'answer') return reply.answer
  if (reply.kind === 'refused') return { refused: reply.message }
  throw new Error(`the worker answered a solve with ${reply.kind}`)
}

/**
 * Typeset *spec* in the worker as mathspec does: Markdown with its math in LaTeX. Resolves to the text, or to the
 * message mathspec gave where it refused the spec; rejects if Python itself failed.
 */
export async function typeset(spec: string, onStage: (stage: string) => void): Promise<{ markdown: string } | { refused: string }> {
  const reply = await asked({ kind: 'typeset', spec }, onStage)
  if (reply.kind === 'typeset') return { markdown: reply.markdown }
  if (reply.kind === 'refused') return { refused: reply.message }
  throw new Error(`the worker answered a typeset with ${reply.kind}`)
}

/**
 * The inputs of one published sweep, such as `runs/base`: its spec, its sources as columns, and its axis.
 *
 * The sources are the `sources/<name>.parquet` paths the archive's own
 * `catalog.parquet` lists, since a static host cannot list a directory. The
 * `specsolve_run` column every archived file carries is left out, as
 * specsolve leaves it out reading an archive back.
 */
export async function loadQuestion(archive: string): Promise<Question> {
  const catalog = (await rowsOf(await fetchFile(archive, 'catalog.parquet').then((r) => r.arrayBuffer()), ['path'])) as { path: string }[]
  const names = [...new Set(catalog.map((d) => d.path).filter((p) => p.startsWith('sources/')))].map((p) => p.slice('sources/'.length, -'.parquet'.length))
  const [spec, axis, tables] = await Promise.all([
    fetchFile(archive, 'spec.yaml').then((r) => r.text()),
    fetchFile(archive, 'axis.json').then((r) => r.text()),
    Promise.all(names.map((name) => fetchFile(archive, `sources/${name}.parquet`).then(async (r) => rowsOf(await r.arrayBuffer())))),
  ])
  return { spec, axis, archive: false, sources: Object.fromEntries(names.map((name, i) => [name, columnsOf(tables[i] as Record<string, unknown>[])])) }
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
