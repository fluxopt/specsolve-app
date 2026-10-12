import { syntaxTree } from '@codemirror/language'
import type { Range } from '@codemirror/state'
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

import { type Declared, MATH, names, SETS, WORDS } from './specNames'

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
function mathMarks(text: string, from: number, table: Map<string, Declared>, flagUnknown: boolean, out: Range<Decoration>[]) {
  for (const found of text.matchAll(TOKEN)) {
    const [, inf, name, keyword, number, quoted, operator] = found
    const at = from + found.index
    if (inf || number || quoted) out.push(marks.literal.range(at, at + found[0].length))
    else if (operator) out.push(marks.operator.range(at, at + operator.length))
    else if (name) {
      const kind = keyword || WORDS.has(name.toLowerCase()) ? 'word' : table.get(name)?.kind
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

function build(view: EditorView): DecorationSet {
  const table = view.state.field(names)
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
          mathMarks(text, start, table, key !== 'template', out)
        } else if (SETS.has(key)) {
          const items = scalar ? [value] : value.getChildren('Item').map((item) => item.firstChild).filter((n): n is SyntaxNode => !!n)
          for (const item of items) {
            const [text, start] = inner(view, item)
            out.push((table.get(text)?.kind === 'set' ? marks.set : marks.unknown).range(start, start + text.length))
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
 * name the file declares nowhere is underlined, outside a macro's template, whose own arguments are names too. The
 * names come from the editor's own table, [`names`](./specNames.ts), which completion and hover read too.
 */
export const specHighlight = [
  names,
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view)
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || syntaxTree(update.state) !== syntaxTree(update.startState))
          this.decorations = build(update.view)
      }
    },
    { decorations: (plugin) => plugin.decorations },
  ),
]
