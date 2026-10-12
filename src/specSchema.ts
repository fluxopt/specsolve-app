import { Ajv2020, type ErrorObject } from 'ajv/dist/2020'
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import type { Diagnostic } from '@codemirror/lint'
import type { Text } from '@codemirror/state'
import type { Tooltip } from '@codemirror/view'
import { type Document, isMap, isScalar, parseDocument } from 'yaml'

import schema from './mathspec.schema.json'

/** The part of a JSON schema this file reads: mathspec's uses no other keywords that shape a document. */
interface Node {
  $ref?: string
  type?: string | string[]
  title?: string
  description?: string
  enum?: unknown[]
  properties?: Record<string, Node>
  additionalProperties?: Node | boolean
  items?: Node
  anyOf?: Node[]
}

const root = schema as Node & { $defs: Record<string, Node> }
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema)

const deref = (node: Node): Node => (node.$ref ? deref(root.$defs[node.$ref.replace('#/$defs/', '')]) : node)

/** *node* and every branch of its `anyOf`, dereferenced: the shapes a value there may take. */
function shapes(node: Node): Node[] {
  const here = deref(node)
  return [here, ...(here.anyOf ?? []).flatMap(shapes)]
}

/** The schema at *path*, a key path from the top of the file; `undefined` where the schema allows nothing there. */
function at(path: string[]): Node | undefined {
  let node: Node | undefined = root
  for (const key of path) {
    const options: Node[] = shapes(node!)
    node =
      options.map((n) => n.properties?.[key]).find(Boolean) ??
      options.map((n) => (typeof n.additionalProperties === 'object' ? n.additionalProperties : undefined)).find(Boolean)
    if (!node) return undefined
  }
  return node
}

/** The keys the schema names at *path*, each with the schema it leads to. */
function keysAt(path: string[]): [string, Node][] {
  const node = at(path)
  return node ? shapes(node).flatMap((n) => Object.entries(n.properties ?? {})) : []
}

/** The values the schema allows at *path* where it lists them, such as a dimension's `dtype`. */
function choicesAt(path: string[]): unknown[] {
  const node = at(path)
  return node ? [...new Set(shapes(node).flatMap((n) => n.enum ?? []))] : []
}

/** What the schema says about *node*: its title, its first paragraph of description, and what it takes. */
function explain(node: Node): string {
  const all = shapes(node)
  const title = all.map((n) => n.title).find(Boolean)
  const description = all.map((n) => n.description).find(Boolean)?.split('\n\n')[0].replace(/\s+/g, ' ')
  const choices = all.flatMap((n) => n.enum ?? [])
  const types = [...new Set(all.flatMap((n) => (n.type ? [n.type].flat() : [])).filter((t) => t !== 'null'))]
  const takes = choices.length ? `one of ${choices.join(', ')}` : types.join(' or ')
  return [title, description && plain(description), takes && `Takes ${takes}.`].filter(Boolean).join('\n')
}

/** Docstring markup as plain text: ``code`` and [`name`][] become the name alone. */
const plain = (text: string) => text.replace(/\[`([^`]+)`\]\[[^\]]*\]/g, '$1').replace(/``([^`]+)``/g, '$1')

/**
 * The key path of the block a line at *indent* sits in, read off the lines above it: each nearer line with less
 * indent that opens a key is one level up. List items are skipped, since the schema keys no list by position here.
 */
function pathAbove(doc: Text, lineNumber: number, indent: number): string[] {
  const path: string[] = []
  let limit = indent
  for (let n = lineNumber - 1; n >= 1 && limit > 0; n--) {
    const opened = /^(\s*)([\w-]+):/.exec(doc.line(n).text)
    if (opened && opened[1].length < limit) {
      path.unshift(opened[2])
      limit = opened[1].length
    }
  }
  return path
}

/** The range of the node at *path* in *document*: its value where that fits on one line, else its key. */
export function rangeAt(document: Document, path: (string | number)[]): [number, number] | undefined {
  for (let end = path.length; end > 0; end--) {
    const node = document.getIn(path.slice(0, end), true)
    if (isScalar(node) && node.range) return [node.range[0], Math.max(node.range[1], node.range[0] + 1)]
    const parent = end === 1 ? document.contents : document.getIn(path.slice(0, end - 1), true)
    const pair = isMap(parent) ? parent.items.find((item) => isScalar(item.key) && item.key.value === path[end - 1]) : undefined
    if (pair && isScalar(pair.key) && pair.key.range) return [pair.key.range[0], pair.key.range[1]]
  }
  return undefined
}

/** One schema error as the sentence it shows, with the path it names in the file's terms. */
function sentence(error: ErrorObject, path: string[]): string {
  const where = path.join('.') || 'the file'
  if (error.keyword === 'additionalProperties') return `${where}: ${error.params.additionalProperty} is not a key mathspec reads here`
  if (error.keyword === 'enum') return `${where}: must be one of ${(error.params.allowedValues as unknown[]).join(', ')}`
  return `${where}: ${error.message}`
}

/**
 * What is wrong with *text* before any data meets it: YAML that does not parse, and keys or values mathspec's schema
 * refuses. A `null` branch of an `anyOf` refusing a value says nothing a reader needs, so it is left out.
 */
export function schemaDiagnostics(text: string): Diagnostic[] {
  const document = parseDocument(text)
  if (document.errors.length)
    return document.errors.map((e) => ({ from: e.pos[0], to: Math.max(e.pos[1], e.pos[0] + 1), severity: 'error', source: 'YAML', message: e.message.split('\n')[0] }))
  if (validate(document.toJS())) return []
  const seen = new Set<string>()
  return (validate.errors ?? []).flatMap((error) => {
    if (error.keyword === 'anyOf' || (error.keyword === 'type' && error.params.type === 'null')) return []
    const path = error.instancePath.split('/').slice(1)
    const named = error.keyword === 'additionalProperties' ? [...path, error.params.additionalProperty as string] : path
    const message = sentence(error, path)
    const range = rangeAt(document, named)
    if (!range || seen.has(message)) return []
    seen.add(message)
    return [{ from: range[0], to: range[1], severity: 'error' as const, source: 'mathspec schema', message }]
  })
}

/** Keys the schema names for the block the cursor is in, or the values it allows for the key the cursor follows. */
export function completeFromSchema(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos)
  const before = line.text.slice(0, context.pos - line.from)
  const value = /^(\s*)([\w-]+):\s+(\S*)$/.exec(before)
  if (value) {
    const choices = choicesAt([...pathAbove(context.state.doc, line.number, value[1].length), value[2]])
    return choices.length ? { from: context.pos - value[3].length, options: choices.map((c) => ({ label: String(c), type: 'enum' })) } : null
  }
  const key = /^(\s*)([\w-]*)$/.exec(before)
  if (!key || (!key[2] && !context.explicit)) return null
  const options: Completion[] = keysAt(pathAbove(context.state.doc, line.number, key[1].length)).map(([name, node]) => ({
    label: name,
    type: 'property',
    apply: `${name}: `,
    info: explain(node) || undefined,
  }))
  return options.length ? { from: context.pos - key[2].length, options, validFor: /^[\w-]*$/ } : null
}

/** What the schema says about the key under the cursor. */
export function hoverFromSchema(doc: Text, pos: number): Tooltip | null {
  const line = doc.lineAt(pos)
  const opened = /^(\s*)(?:-\s+)?([\w-]+):/.exec(line.text)
  if (!opened) return null
  const from = line.from + opened[0].length - opened[2].length - 1
  if (pos < from || pos > from + opened[2].length) return null
  const node = at([...pathAbove(doc, line.number, opened[1].length), opened[2]])
  const text = node && explain(node)
  if (!text) return null
  return {
    pos: from,
    end: from + opened[2].length,
    above: true,
    create: () => {
      const dom = document.createElement('div')
      dom.className = 'cm-schema-hover'
      dom.textContent = text
      return { dom }
    },
  }
}
