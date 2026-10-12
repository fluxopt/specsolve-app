import { loadPyodide, type PyodideAPI, version } from 'pyodide'

import solvePy from './solve.py?raw'
import type { Answer, Question, Reply } from './solver'

/** The first specsolve that runs on Pyodide's polars, 1.33.1, and takes an archive's axis as the data it holds. */
const SPECSOLVE = 'specsolve>=0.9,<0.10'

let python: Promise<PyodideAPI> | null = null

const say = (stage: string) => postMessage({ kind: 'stage', stage } satisfies Reply)

/**
 * Pyodide with specsolve installed and `solve.py` imported, made once per worker.
 *
 * Pyodide's own packages come from the CDN at the version npm installed, and
 * micropip resolves specsolve against them, so a specsolve whose requirements
 * this Pyodide cannot meet fails here, by name, rather than at the first solve.
 */
async function ready(): Promise<PyodideAPI> {
  say('Loading Python')
  const pyodide = await loadPyodide({ indexURL: `https://cdn.jsdelivr.net/pyodide/v${version}/full/` })
  say('Installing specsolve')
  await pyodide.loadPackage('micropip')
  await pyodide.pyimport('micropip').install(SPECSOLVE)
  pyodide.FS.writeFile('/home/pyodide/solve.py', solvePy)
  pyodide.pyimport('solve')
  return pyodide
}

async function answer({ spec, sources, axis }: Question): Promise<Reply> {
  python ??= ready()
  const pyodide = await python
  say('Solving')
  const started = performance.now()
  const result = pyodide.pyimport('solve').solve(spec, pyodide.toPy(sources), axis)
  const seconds = (performance.now() - started) / 1000
  if (typeof result === 'string') return { kind: 'refused', message: result }
  const answered = result.toJs({ dict_converter: Object.fromEntries }) as Omit<Answer, 'seconds'>
  result.destroy()
  return { kind: 'answer', answer: { ...answered, seconds } }
}

onmessage = async (event: MessageEvent<Question>) => {
  try {
    postMessage(await answer(event.data))
  } catch (e) {
    python = null
    postMessage({ kind: 'failed', message: e instanceof Error ? e.message : String(e) } satisfies Reply)
  }
}
