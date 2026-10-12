import { useMemo, useState } from 'react'
import {
  columnFacetingFeature,
  columnFilteringFeature,
  createColumnHelper,
  createFacetedRowModel,
  createFacetedUniqueValues,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_equalsString,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_basic,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import type { Column } from '@tanstack/react-table'

import type { Columns } from './solver'

/** One row of a source, with its position in the source's columns so an edit lands where it came from. */
type Row = Record<string, unknown> & { index: number }

const features = tableFeatures({
  columnFilteringFeature,
  columnFacetingFeature,
  rowPaginationFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  facetedRowModel: createFacetedRowModel(),
  facetedUniqueValues: createFacetedUniqueValues(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  filterFns: { equalsString: filterFn_equalsString },
  sortFns: { basic: sortFn_basic },
})
const helper = createColumnHelper<typeof features, Row>()

const label = (v: unknown) => String(v ?? '')

/** The cells of `value` that differ from the published ones, by source. */
export function editedCells(sources: Record<string, Columns>, published: Record<string, Columns>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(sources).map(([name, columns]) => [name, (columns.value ?? []).filter((v, i) => v !== published[name].value[i]).length]),
  )
}

/**
 * Every parameter of the scenario as a table whose `value` column is editable, one parameter at a time.
 *
 * Only sources with a `value` column are offered: a dimension's own labels
 * are what the other tables are keyed by, so they stay as published.
 * *onEdit* receives new values by row position and must merge them into the
 * newest sources, since a cell keeps the callback it was made with.
 */
export function DataEditor({
  sources,
  published,
  onEdit,
  disabled,
}: {
  sources: Record<string, Columns>
  published: Record<string, Columns>
  onEdit: (name: string, changes: Map<number, number>) => void
  disabled: boolean
}) {
  const names = Object.keys(sources)
    .filter((n) => 'value' in sources[n])
    .sort()
  const [picked, setPicked] = useState(names.includes('invest') ? 'invest' : names[0])
  const edited = editedCells(sources, published)
  return (
    <div className="card">
      <h2>The data</h2>
      <p className="muted">
        Every parameter the archive holds. Type a new <code>value</code>, or filter the rows and scale them all at once. A
        changed cell is marked; the next solve uses it.
      </p>
      <div className="segmented sentence parameters" role="radiogroup" aria-label="Parameter">
        {names.map((n) => (
          <button key={n} role="radio" aria-checked={n === picked} className={n === picked ? 'on' : undefined} onClick={() => setPicked(n)}>
            {n}
            {edited[n] ? ` · ${edited[n]}` : ''}
          </button>
        ))}
      </div>
      <Source key={picked} name={picked} columns={sources[picked]} published={published[picked]} onEdit={onEdit} disabled={disabled} />
    </div>
  )
}

function Source({
  name,
  columns,
  published,
  onEdit,
  disabled,
}: {
  name: string
  columns: Columns
  published: Columns
  onEdit: (name: string, changes: Map<number, number>) => void
  disabled: boolean
}) {
  const [factor, setFactor] = useState('1')
  const dims = Object.keys(columns).filter((c) => c !== 'value')
  const rows = useMemo(
    (): Row[] => columns.value.map((_, index) => ({ ...Object.fromEntries(Object.keys(columns).map((c) => [c, columns[c][index]])), index })),
    [columns],
  )
  const definition = useMemo(
    () =>
      helper.columns([
        ...dims.map((dim) =>
          helper.accessor((r) => r[dim], { id: dim, header: dim, filterFn: 'equalsString', sortFn: 'basic', cell: (info) => label(info.getValue()) }),
        ),
        helper.accessor((r) => r.value as number, {
          id: 'value',
          header: 'value',
          enableColumnFilter: false,
          sortFn: 'basic',
          cell: (info) => {
            const { index } = info.row.original
            return (
              <ValueCell
                value={info.getValue()}
                published={published.value[index] as number}
                label={`${name} at ${dims.map((d) => label(info.row.original[d])).join(', ')}`}
                disabled={disabled}
                onCommit={(v) => onEdit(name, new Map([[index, v]]))}
              />
            )
          },
        }),
      ]),
    [name, published, disabled, onEdit],
  )
  const table = useTable(
    {
      features,
      columns: definition,
      data: rows,
      getRowId: (r) => String(r.index),
      initialState: { pagination: { pageIndex: 0, pageSize: 24 } },
    },
    (state) => state,
  )
  const matching = table.getFilteredRowModel().rows
  const scale = Number(factor)

  return (
    <>
      <div className="table-wrap">
        <table className="rows editor">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th key={header.id}>
                    <div className="th">
                      <button className="sort" onClick={header.column.getToggleSortingHandler()}>
                        <table.FlexRender header={header} />
                        {{ asc: ' ↑', desc: ' ↓' }[header.column.getIsSorted() as string] ?? ''}
                      </button>
                    </div>
                    {header.column.getCanFilter() ? <Filter column={header.column} /> : null}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getAllCells().map((cell) => (
                  <td key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Previous page">
          ‹
        </button>
        <span>
          page {table.state.pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}
        </span>
        <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Next page">
          ›
        </button>
        <span className="muted">
          {matching.length.toLocaleString()} of {rows.length.toLocaleString()} rows
        </span>
        <span className="scale">
          <label>
            multiply these {matching.length.toLocaleString()} by{' '}
            <input className="cell" type="number" step="any" value={factor} onChange={(e) => setFactor(e.target.value)} aria-label="Factor" />
          </label>
          <button
            className="apply"
            disabled={disabled || !Number.isFinite(scale) || scale === 1}
            onClick={() => {
              onEdit(name, new Map(matching.map((r) => [r.original.index, (r.original.value as number) * scale])))
              setFactor('1')
            }}
          >
            apply
          </button>
        </span>
      </div>
    </>
  )
}

/** A number input that shows the value it is given, except while it holds the focus and the person is typing. */
function ValueCell({
  value,
  published,
  label,
  disabled,
  onCommit,
}: {
  value: number
  published: number
  label: string
  disabled: boolean
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const changed = value !== published
  return (
    <input
      className={changed ? 'cell edited' : 'cell'}
      type="number"
      step="any"
      value={draft ?? String(value)}
      title={changed ? `published: ${published}` : undefined}
      aria-label={label}
      disabled={disabled}
      onFocus={() => setDraft(String(value))}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        setDraft(e.target.value)
        if (Number.isFinite(e.target.valueAsNumber)) onCommit(e.target.valueAsNumber)
      }}
    />
  )
}

function Filter({ column }: { column: Column<typeof features, Row> }) {
  const values = useMemo(
    () => [...column.getFacetedUniqueValues().keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    [column.getFacetedUniqueValues()],
  )
  return (
    <select
      className="filter"
      value={(column.getFilterValue() as string | undefined) ?? ''}
      onChange={(e) => column.setFilterValue(e.target.value || undefined)}
      aria-label={`Filter ${column.id}`}
    >
      <option value="">all {values.length}</option>
      {values.map((v) => (
        <option key={String(v)} value={String(v)}>
          {label(v)}
        </option>
      ))}
    </select>
  )
}
