import { read } from './archive'

/** One quantity a directory of archives holds, as its catalogue lists it. */
export interface Entry {
  kind: string
  name: string
  path: string
  description: string
  dims: string[]
}

export type Row = Record<string, string | number>

/** What a quantity's `value` column holds, by the catalogue's kind. */
export const MEANING: Record<string, string> = {
  variable: 'what the solver chose',
  constraint: 'shadow price: what one more unit of the right-hand side is worth',
  expression: 'what the named quantity came to',
  parameter: 'an input, as solved',
}

type CatalogRow = { specsolve_run: string; path: string; name: string; kind: string; description: string | null; column: string }

/**
 * Every quantity a published directory holds, off its stacked `catalog.parquet`.
 *
 * A dimension's own labels carry no `value`, so they are left out. A quantity
 * is listed once however many archives hold it; its dimensions are the columns
 * the catalogue names for it.
 */
export async function loadCatalog(directory: string): Promise<{ entries: Entry[]; runs: number }> {
  const { rows } = await read<CatalogRow>(directory, 'catalog.parquet', [
    'specsolve_run',
    'path',
    'name',
    'kind',
    'description',
    'column',
  ])
  const byPath = new Map<string, Entry>()
  for (const d of rows) {
    if (d.kind === 'dimension') continue
    const entry = byPath.get(d.path) ?? { kind: d.kind, name: d.name, path: d.path, description: d.description ?? '', dims: [] }
    if (!entry.dims.includes(d.column)) entry.dims.push(d.column)
    byPath.set(d.path, entry)
  }
  const kinds = Object.keys(MEANING)
  const entries = [...byPath.values()].sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || a.name.localeCompare(b.name))
  return { entries, runs: new Set(rows.map((d) => d.specsolve_run)).size }
}

/** One quantity across every archive of the directory: `(specsolve_run, <dims…>, value)`, integers as numbers. */
export async function loadQuantity(directory: string, entry: Entry): Promise<{ rows: Row[]; bytes: number }> {
  const columns = ['specsolve_run', ...entry.dims, 'value']
  const { rows, bytes } = await read<Record<string, unknown>>(directory, entry.path, columns)
  return {
    rows: rows.map((d) => Object.fromEntries(columns.map((c) => [c, typeof d[c] === 'bigint' ? Number(d[c]) : (d[c] as string | number)]))),
    bytes,
  }
}
