import { useEffect, useRef } from 'react'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { type Diagnostic, forceLinting, lintGutter, linter } from '@codemirror/lint'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, hoverTooltip, keymap, lineNumbers } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { yaml } from '@codemirror/lang-yaml'
import { parseDocument } from 'yaml'

import { completeFromSchema, hoverFromSchema, rangeAt, schemaDiagnostics } from './specSchema'

/** Colours from the stylesheet's own variables, so the editor follows light and dark mode with the page. */
const theme = EditorView.theme({
  '&': { color: 'var(--ink)', backgroundColor: 'var(--page)', fontSize: '0.82rem', border: '1px solid var(--rule)', borderRadius: '6px' },
  '&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '-1px' },
  '.cm-scroller': { fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace", lineHeight: '1.5', maxHeight: '70vh' },
  '.cm-content': { caretColor: 'var(--ink)', padding: '0.5rem 0' },
  '.cm-gutters': { backgroundColor: 'var(--surface)', color: 'var(--muted)', borderRight: '1px solid var(--rule)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 6%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--ink)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent) !important',
  },
  '.cm-tooltip': { backgroundColor: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--rule)', borderRadius: '6px', maxWidth: '36rem' },
  '.cm-tooltip-hover, .cm-tooltip-lint': { padding: '0.4rem 0.6rem', fontSize: '0.8rem', lineHeight: '1.45' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent)', color: '#fff' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--surface)', border: '1px solid var(--rule)', color: 'var(--muted)' },
})

const highlight = HighlightStyle.define([
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: 'var(--hue-blue)', fontWeight: '600' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--ink)' },
  { tag: [tags.number, tags.integer, tags.float], color: 'var(--hue-orange)' },
  { tag: [tags.bool, tags.null, tags.atom, tags.keyword], color: 'var(--hue-aqua)' },
  { tag: [tags.comment, tags.lineComment], color: 'var(--muted)', fontStyle: 'italic' },
  { tag: [tags.punctuation, tags.separator, tags.squareBracket, tags.brace, tags.meta], color: 'var(--muted)' },
])

const setRefusal = StateEffect.define<string | null>()

/** The refusal of the last solve as a diagnostic on the line it names; an edit clears it, since it was about the text before. */
const refusal = StateField.define<Diagnostic[]>({
  create: () => [],
  update(held, tr) {
    for (const effect of tr.effects) if (effect.is(setRefusal)) return effect.value === null ? [] : located(tr.state.doc.toString(), effect.value)
    return tr.docChanged ? [] : held
  },
})

/**
 * Where in *text* a refusal points: the node at the dotted path it opens with, such as `dimensions.hour.dtype`, or
 * for one that names a declaration, such as `Constraint 'balance': …`, that declaration's `expression:` where it has
 * one and its key where it does not. A refusal that names no place in the file gives no diagnostic; the page shows it
 * above the editor either way.
 */
function located(text: string, message: string): Diagnostic[] {
  const body = message.replace(/^[\w.]+(?:Error|Exception): /, '')
  const dotted = /^([A-Za-z_][\w]*(?:\.[\w-]+)+):/.exec(body)?.[1].split('.')
  const named = /\b(constraint|expression|variable|parameter|dimension) '([^']+)'/i.exec(body)
  const path = dotted ?? (named ? [`${named[1].toLowerCase()}s`, named[2], 'expression'] : null)
  if (!path) return []
  const range = rangeAt(parseDocument(text), path)
  return range ? [{ from: range[0], to: range[1], severity: 'error', source: 'specsolve', message: body }] : []
}

/**
 * The model's YAML in a code editor: highlighting, folding and search, with mathspec's own schema completing keys,
 * explaining them on hover and marking what it refuses as you type. *refused* is specsolve's refusal of the last
 * solve, marked on the line it names, scrolled into view, until the text changes.
 */
export function SpecEditor({
  value,
  onChange,
  readOnly,
  refused,
}: {
  value: string
  onChange: (value: string) => void
  readOnly: boolean
  refused: string | null
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const editable = useRef(new Compartment())
  const changed = useRef(onChange)
  changed.current = onChange

  useEffect(() => {
    view.current = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          foldGutter(),
          lintGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion({ override: [completeFromSchema] }),
          highlightActiveLine(),
          highlightSelectionMatches(),
          EditorState.tabSize.of(2),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab]),
          yaml(),
          refusal,
          linter((v) => [...schemaDiagnostics(v.state.doc.toString()), ...v.state.field(refusal)], {
            delay: 300,
            needsRefresh: (update) => update.transactions.some((tr) => tr.effects.some((e) => e.is(setRefusal))),
          }),
          hoverTooltip((v, pos) => hoverFromSchema(v.state.doc, pos)),
          syntaxHighlighting(highlight),
          theme,
          editable.current.of(EditorState.readOnly.of(readOnly)),
          EditorView.contentAttributes.of({ 'aria-label': 'The model, in YAML' }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changed.current(update.state.doc.toString())
          }),
        ],
      }),
    })
    return () => view.current?.destroy()
  }, []) // made once: the effects below keep it in step with the props

  useEffect(() => {
    const v = view.current!
    if (v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
  }, [value])

  useEffect(() => {
    view.current!.dispatch({ effects: editable.current.reconfigure(EditorState.readOnly.of(readOnly)) })
  }, [readOnly])

  useEffect(() => {
    const v = view.current!
    v.dispatch({ effects: setRefusal.of(refused) })
    const [marked] = v.state.field(refusal)
    if (marked) v.dispatch({ effects: EditorView.scrollIntoView(marked.from, { y: 'center' }) })
    forceLinting(v)
  }, [refused])

  return <div ref={host} className="spec-editor" />
}
