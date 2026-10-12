import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { StateField, type Text } from '@codemirror/state'
import type { EditorView, Tooltip } from '@codemirror/view'
import { parseDocument } from 'yaml'

/** What a name stands for, by the section of the file that declares it. */
export type Kind = 'set' | 'data' | 'choice' | 'constraint' | 'word'

/** One declared name: what it stands for, the section and dimensions it is declared with, and its description. */
export interface Declared {
  kind: Kind
  section: string
  dims: string[]
  description?: string
}

/** mathspec's convention, as its typesetter prints it: data upright, what the solver chooses italic, sets apart. */
const SECTIONS: Record<string, [Kind, string]> = {
  dimensions: ['set', 'dimension'],
  parameters: ['data', 'parameter'],
  relations: ['data', 'relation'],
  variables: ['choice', 'variable'],
  expressions: ['choice', 'expression'],
  constraints: ['constraint', 'constraint'],
  macros: ['word', 'macro'],
}

/** The keys whose value is mathspec's expression or where language. */
export const MATH = new Set(['expression', 'where', 'holds', 'when', 'lower', 'upper', 'template'])

/** The keys whose value names dimensions. */
export const SETS = new Set(['dims', 'over', 'along'])

/** The language's own words: mathspec 0.2.1's built-ins, and what a where clause adds. Case does not matter. */
export const WORDS = new Set(['sum', 'at', 'sum_back', 'shift', 'dual', 'count', 'and', 'or', 'not', 'true', 'false', 'inf'])

/** The built-ins a completion offers, in the spelling the language documents. */
const BUILTINS = ['sum', 'at', 'sum_back', 'shift', 'dual', 'count', 'AND', 'OR', 'NOT', 'inf']

/** Every name *text* declares; `given:` declares as its sections do. `null` while the YAML does not parse. */
function declared(text: string): Map<string, Declared> | null {
  const table = new Map<string, Declared>()
  const document = parseDocument(text)
  if (document.errors.length) return null
  const spec = document.toJS() as Record<string, unknown> | null
  if (!spec || typeof spec !== 'object') return table
  const add = (sections: Record<string, unknown>) => {
    for (const [name, [kind, section]] of Object.entries(SECTIONS)) {
      const block = sections[name]
      if (!block || typeof block !== 'object') continue
      for (const [key, body] of Object.entries(block as Record<string, unknown>)) {
        const fields = body && typeof body === 'object' ? (body as { dims?: unknown; description?: unknown }) : {}
        table.set(key, {
          kind,
          section,
          dims: Array.isArray(fields.dims) ? fields.dims.map(String) : [],
          description: typeof fields.description === 'string' ? fields.description : undefined,
        })
      }
    }
  }
  add(spec)
  if (spec.given && typeof spec.given === 'object') add(spec.given as Record<string, unknown>)
  return table
}

/** The file's names, rebuilt on each edit; while a half-typed line keeps the YAML from parsing, the last table stands. */
export const names = StateField.define<Map<string, Declared>>({
  create: (state) => declared(state.doc.toString()) ?? new Map(),
  update: (held, tr) => (tr.docChanged ? (declared(tr.state.doc.toString()) ?? held) : held),
})

/** One line on a declaration: what it is, what it is over, and what the file says of it. */
function describe(entry: Declared): string {
  const over = entry.dims.length ? ` over ${entry.dims.join(' × ')}` : ''
  return `${entry.section}${over}${entry.description ? ` — ${entry.description}` : ''}`
}

const TYPES: Record<Kind, string> = { set: 'type', data: 'constant', choice: 'variable', constraint: 'property', word: 'function' }

const option = ([name, entry]: [string, Declared]): Completion => ({ label: name, type: TYPES[entry.kind], detail: entry.section, info: describe(entry) })

/**
 * The key that owns the block list line *lineNumber* is an item of, and every item of that list: the nearest line
 * above that is not an item, if it opens a key and nothing else.
 */
function listOwner(doc: Text, lineNumber: number): { key: string; items: string[] } | null {
  const items: string[] = []
  const item = (n: number) => /^\s*-\s*([\w-]*)\s*$/.exec(doc.line(n).text)?.[1]
  let n = lineNumber - 1
  for (; n >= 1 && item(n) !== undefined; n--) items.push(item(n)!)
  const owner = n >= 1 ? /^\s*(?:-\s+)?([\w-]+):\s*$/.exec(doc.line(n).text) : null
  if (!owner) return null
  for (let below = lineNumber + 1; below <= doc.lines && item(below) !== undefined; below++) items.push(item(below)!)
  return { key: owner[1], items }
}

/** The dimensions the file declares, but those in *present*, from *from*. */
function dimensionsFrom(table: Map<string, Declared>, present: string[], from: number): CompletionResult | null {
  const options = [...table].filter(([name, entry]) => entry.kind === 'set' && !present.includes(name)).map(option)
  return options.length ? { from, options, validFor: /^[\w-]*$/ } : null
}

/**
 * Names the file declares, where a name goes: under `dims:`, `over:` or `along:` the dimensions not yet listed there,
 * after `over=` the dimensions, and in an expression or where clause every declared name and the language's own words.
 */
export function completeNames(context: CompletionContext): CompletionResult | null {
  const table = context.state.field(names, false)
  if (!table) return null
  const line = context.state.doc.lineAt(context.pos)
  const before = line.text.slice(0, context.pos - line.from)

  const item = /^\s*-\s*([\w-]*)$/.exec(before)
  if (item) {
    const owner = listOwner(context.state.doc, line.number)
    return owner && SETS.has(owner.key) ? dimensionsFrom(table, owner.items, context.pos - item[1].length) : null
  }
  const flow = /^\s*(?:-\s+)?([\w-]+):\s*\[([^\]]*)$/.exec(before)
  if (flow && SETS.has(flow[1])) {
    const written = flow[2].split(',').map((s) => s.trim())
    const prefix = written.pop() ?? ''
    return dimensionsFrom(table, written, context.pos - prefix.length)
  }
  const value = /^\s*(?:-\s+)?([\w-]+):\s*(.*)$/.exec(before)
  if (!value) return null
  if (SETS.has(value[1]) && /^[\w-]*$/.test(value[2])) return dimensionsFrom(table, [], context.pos - value[2].length)
  if (!MATH.has(value[1])) return null
  const word = context.matchBefore(/[A-Za-z_]\w*/)
  if (!word && !context.explicit) return null
  const from = word?.from ?? context.pos
  if (/\bover\s*=\s*$/.test(line.text.slice(0, from - line.from))) return dimensionsFrom(table, [], from)
  const words: Completion[] = BUILTINS.map((label) => ({ label, type: 'keyword', detail: 'mathspec' }))
  return { from, options: [...[...table].map(option), ...words], validFor: /^\w*$/ }
}

/** The declaration of the name under the cursor, where it sits in an expression, a where clause or a list of dimensions. */
export function hoverName(view: EditorView, pos: number): Tooltip | null {
  const table = view.state.field(names, false)
  if (!table) return null
  const line = view.state.doc.lineAt(pos)
  const opened = /^\s*(?:-\s+)?([\w-]+):/.exec(line.text)
  const inValue = opened && (MATH.has(opened[1]) || SETS.has(opened[1])) && pos - line.from >= opened[0].length
  const inItem = !opened && /^\s*-\s/.test(line.text) && SETS.has(listOwner(view.state.doc, line.number)?.key ?? '')
  if (!inValue && !inItem) return null
  for (const found of line.text.matchAll(/[A-Za-z_]\w*/g)) {
    const from = line.from + found.index
    const entry = table.get(found[0])
    if (pos < from || pos > from + found[0].length || !entry) continue
    return {
      pos: from,
      end: from + found[0].length,
      above: true,
      create: () => {
        const dom = document.createElement('div')
        dom.className = 'cm-schema-hover'
        dom.textContent = `${found[0]}: ${describe(entry)}`
        return { dom }
      },
    }
  }
  return null
}
