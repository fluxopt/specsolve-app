import { syntaxTree } from '@codemirror/language'
import type { Range } from '@codemirror/state'
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { parseDocument } from 'yaml'

/** What a name stands for, by the section of the file that declares it. */
type Kind = 'set' | 'data' | 'choice' | 'constraint' | 'word'

/** mathspec's convention, as its typesetter prints it: data upright, what the solver chooses italic, sets apart. */
const SECTIONS: Record<string, Kind> = {
  dimensions: 'set',
  parameters: 'data',
  relations: 'data',
  variables: 'choice',
  expressions: 'choice',
  constraints: 'constraint',
  macros: 'word',
}

/** The keys whose value is mathspec's expression or where language. */
const MATH = new Set(['expression', 'where', 'holds', 'when', 'lower', 'upper', 'template'])

/** The keys whose value names dimensions. */
const SETS = new Set(['dims', 'over', 'along'])

/** The language's own words: mathspec 0.2.1's built-ins, and what a where clause adds. Case does not matter. */
const WORDS = new Set(['sum', 'at', 'sum_back', 'shift', 'dual', 'count', 'and', 'or', 'not', 'true', 'false', 'inf'])

const TOKEN = /(\.?inf\b)|([A-Za-z_]\w*)(\s*=(?!=))?|(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+)|('[^']*'|"[^"]*")|(==|!=|<=|>=|\*\*|[<>+\-*/=])/g

const mark = (cls: string, title?: string) => Decoration.mark({ class: `cm-ms-${cls}`, attributes: title ? { title } : undefined })
const marks = {
  set: mark('set'),
  data: mark('data'),
  choice: mark('choice'),
  constraint: mark('constraint'),
  word: mark('word'),
  operator: mark('operator'),
  literal: mark('literal'),
  prose: mark('prose'),
  unknown: mark('unknown', 'declared nowhere in this file'),
}

/** Every name the file declares, with what it stands for; `given:` declares as its sections do. `null` while the YAML does not parse. */
function declared(text: string): Map<string, Kind> | null {
  const names = new Map<string, Kind>()
  const document = parseDocument(text)
  if (document.errors.length) return null
  const spec = document.toJS() as Record<string, unknown> | null
  if (!spec || typeof spec !== 'object') return names
  const add = (section: Record<string, unknown>) => {
    for (const [name, kind] of Object.entries(SECTIONS))
      if (section[name] && typeof section[name] === 'object') for (const key of Object.keys(section[name] as object)) names.set(key, kind)
  }
  add(spec)
  if (spec.given && typeof spec.given === 'object') add(spec.given as Record<string, unknown>)
  return names
}

const keyOf = (view: EditorView, pair: SyntaxNode) => {
  const key = pair.getChild('Key')
  return key ? view.state.doc.sliceString(key.from, key.to) : null
}

/** The value of *pair*: its last child, where that is not the key or the colon. */
const valueOf = (pair: SyntaxNode) => (pair.lastChild && !['Key', ':'].includes(pair.lastChild.name) ? pair.lastChild : null)

/** The key of the pair that holds the mapping *pair* sits in, such as `assumptions` for an assumption. */
const parentKey = (view: EditorView, pair: SyntaxNode) => {
  const outer = pair.parent?.parent
  return outer?.name === 'Pair' ? keyOf(view, outer) : null
}

/** Marks over one expression or where clause at *from*, each name by what it is declared as. */
function mathMarks(text: string, from: number, names: Map<string, Kind>, flagUnknown: boolean, out: Range<Decoration>[]) {
  for (const found of text.matchAll(TOKEN)) {
    const [, inf, name, keyword, number, quoted, operator] = found
    const at = from + found.index
    if (inf || number || quoted) out.push(marks.literal.range(at, at + found[0].length))
    else if (operator) out.push(marks.operator.range(at, at + operator.length))
    else if (name) {
      const kind = keyword || WORDS.has(name.toLowerCase()) ? 'word' : names.get(name)
      const decoration = kind ? marks[kind] : flagUnknown ? marks.unknown : null
      if (decoration) out.push(decoration.range(at, at + name.length))
    }
  }
}

/** The span of *node*'s text inside its quotes, if it has them. */
const inner = (view: EditorView, node: SyntaxNode): [string, number] => {
  const text = view.state.doc.sliceString(node.from, node.to)
  return node.name === 'QuotedLiteral' ? [text.slice(1, -1), node.from + 1] : [text, node.from]
}

function build(view: EditorView, names: Map<string, Kind>): DecorationSet {
  const out: Range<Decoration>[] = []
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (ref) => {
        if (ref.name !== 'Pair') return
        const pair = ref.node
        const key = keyOf(view, pair)
        const value = valueOf(pair)
        if (!key || !value) return
        const scalar = value.name === 'Literal' || value.name === 'QuotedLiteral'
        if (scalar && (MATH.has(key) || parentKey(view, pair) === 'assumptions')) {
          const [text, start] = inner(view, value)
          mathMarks(text, start, names, key !== 'template', out)
        } else if (SETS.has(key)) {
          const items = scalar ? [value] : value.getChildren('Item').map((item) => item.firstChild).filter((n): n is SyntaxNode => !!n)
          for (const item of items) {
            const [text, start] = inner(view, item)
            out.push((names.get(text) === 'set' ? marks.set : marks.unknown).range(start, start + text.length))
          }
        } else if (key === 'description') {
          out.push(marks.prose.range(value.from, value.to))
        } else if (value.name === 'Literal' && /^(-?\d+\.?\d*([eE][-+]?\d+)?|true|false|null|~|\.?inf)$/i.test(view.state.doc.sliceString(value.from, value.to))) {
          out.push(marks.literal.range(value.from, value.to))
        }
      },
    })
  }
  return Decoration.set(out, true)
}

/**
 * Colour a spec by meaning, beyond what YAML's grammar can tell: names in an expression or where clause by the section
 * that declares them, dimension lists, descriptions as prose, and plain numbers, booleans and nulls as literals. A
 * name the file declares nowhere is underlined, outside a macro's template, whose own arguments are names too. While
 * a half-typed line keeps the YAML from parsing, the names it last declared stand.
 */
export const specHighlight = ViewPlugin.fromClass(
  class {
    names: Map<string, Kind>
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.names = declared(view.state.doc.toString()) ?? new Map()
      this.decorations = build(view, this.names)
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.names = declared(update.state.doc.toString()) ?? this.names
      if (update.docChanged || update.viewportChanged || syntaxTree(update.state) !== syntaxTree(update.startState))
        this.decorations = build(update.view, this.names)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)
