import { useEffect, useMemo, useState } from 'react'
import {
  aggregationFn_sum,
  columnFacetingFeature,
  columnFilteringFeature,
  columnGroupingFeature,
  createColumnHelper,
  createExpandedRowModel,
  createFacetedRowModel,
  createFacetedUniqueValues,
  createFilteredRowModel,
  createGroupedRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_equalsString,
  filterFn_includesString,
  globalFilteringFeature,
  rowAggregationFeature,
  rowExpandingFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import type { Column } from '@tanstack/react-table'

import { ARCHIVE } from './archive'
import { type Entry, loadCatalog, loadQuantity, MEANING, type Row } from './explore'
import { compact } from './format'

const DIRECTORIES = { runs: 'the four scenarios', grid: 'the 110 what-if points' }
type Directory = keyof typeof DIRECTORIES

const exact = new Intl.NumberFormat('en', { maximumSignificantDigits: 6 })
const number = (v: unknown) => (typeof v === 'number' ? exact.format(v + 0) : String(v ?? ''))
/** A coordinate is a label, so 2045 stays 2045. */
const label = (v: unknown) => String(v ?? '')

const catalogFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns: { includesString: filterFn_includesString },
  sortFns: { alphanumeric: sortFn_alphanumeric },
})
const catalogColumns = createColumnHelper<typeof catalogFeatures, Entry>()

const quantityFeatures = tableFeatures({
  columnFilteringFeature,
  columnFacetingFeature,
  columnGroupingFeature,
  rowAggregationFeature,
  rowExpandingFeature,
  rowPaginationFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  facetedRowModel: createFacetedRowModel(),
  facetedUniqueValues: createFacetedUniqueValues(),
  groupedRowModel: createGroupedRowModel(),
  expandedRowModel: createExpandedRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  filterFns: { equalsString: filterFn_equalsString },
  sortFns: { basic: sortFn_basic },
  aggregationFns: { sum: aggregationFn_sum },
})
const quantityColumns = createColumnHelper<typeof quantityFeatures, Row>()

export function Explore() {
  const [directory, setDirectory] = useState<Directory>('runs')
  const [catalog, setCatalog] = useState<{ entries: Entry[]; runs: number } | null>(null)
  const [picked, setPicked] = useState<Entry | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setCatalog(null)
    loadCatalog(directory).then((c) => {
      setCatalog(c)
      setPicked((old) => c.entries.find((e) => e.path === old?.path) ?? c.entries.find((e) => e.name === 'p') ?? c.entries[0])
    }, (e: unknown) => setError(String(e)))
  }, [directory])

  if (error) return <p className="error">The archives did not load: {error}</p>
  return (
    <>
      <header className="intro">
        <h1>Every number the solver wrote down</h1>
        <p>
          This page knows nothing about the model. It reads the catalogue each archive carries, lists every quantity in
          it, and opens any of them as a table you can filter, sort and group, with the URL of the very file it read.
          Point DuckDB, polars or a spreadsheet at that URL and you have the same rows.
        </p>
      </header>

      <section className="controls" aria-label="Directory">
        <div className="segmented paths" role="radiogroup" aria-label="Directory of archives">
          {(Object.keys(DIRECTORIES) as Directory[]).map((d) => (
            <button key={d} role="radio" aria-checked={d === directory} className={d === directory ? 'on' : undefined} onClick={() => setDirectory(d)}>
              {d}/
            </button>
          ))}
        </div>
        <p className="picked">
          {DIRECTORIES[directory]}
          {catalog ? `: ${catalog.entries.length} quantities across ${catalog.runs} archives` : ''}
        </p>
      </section>

      {!catalog ? (
        <p className="muted">Reading the catalogue…</p>
      ) : (
        <div className="explore">
          <Catalog entries={catalog.entries} picked={picked} onPick={setPicked} />
          {picked ? <Quantity key={`${directory}/${picked.path}`} directory={directory} entry={picked} /> : null}
        </div>
      )}
    </>
  )
}

function Catalog({ entries, picked, onPick }: { entries: Entry[]; picked: Entry | null; onPick: (e: Entry) => void }) {
  const columns = useMemo(
    () =>
      catalogColumns.columns([
        catalogColumns.accessor('name', { header: 'name', cell: (info) => <code>{info.getValue()}</code> }),
        catalogColumns.accessor('kind', { header: 'kind' }),
        catalogColumns.accessor((e) => e.dims.join(', ') || '—', { id: 'dims', header: 'keyed by' }),
      ]),
    [],
  )
  const table = useTable(
    { features: catalogFeatures, columns, data: entries, globalFilterFn: 'includesString', getRowId: (e) => e.path },
    (state) => state,
  )
  return (
    <div className="card catalog">
      <h2>Catalogue</h2>
      <input
        className="search"
        type="search"
        placeholder="Search names, kinds, dimensions…"
        value={table.state.globalFilter ?? ''}
        onChange={(e) => table.setGlobalFilter(e.target.value)}
        aria-label="Search the catalogue"
      />
      <div className="table-wrap">
        <table className="entries">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th key={header.id}>
                    <button className="sort" onClick={header.column.getToggleSortingHandler()}>
                      <table.FlexRender header={header} />
                      {{ asc: ' ↑', desc: ' ↓' }[header.column.getIsSorted() as string] ?? ''}
                    </button>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={row.original.path === picked?.path ? 'here' : undefined}
                onClick={() => onPick(row.original)}
                title={row.original.description}
              >
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
    </div>
  )
}

function Quantity({ directory, entry }: { directory: Directory; entry: Entry }) {
  const [loaded, setLoaded] = useState<{ rows: Row[]; bytes: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    loadQuantity(directory, entry).then(setLoaded, (e: unknown) => setError(String(e)))
  }, [directory, entry])
  const url = new URL(`${ARCHIVE}/${directory}/${entry.path}`, window.location.href).href

  return (
    <div className="card quantity">
      <h2>
        <code>{entry.name}</code> <span className="muted">— {entry.kind}</span>
      </h2>
      <p className="muted">
        {entry.description ? `${entry.description}. ` : ''}
        <code>value</code> is {MEANING[entry.kind] ?? 'the number the archive holds'}.
      </p>
      {error ? <p className="error">{error}</p> : !loaded ? <p className="muted">Reading {entry.path}…</p> : <Rows entry={entry} rows={loaded.rows} />}
      <ReadIt url={url} bytes={loaded?.bytes} />
    </div>
  )
}

function Rows({ entry, rows }: { entry: Entry; rows: Row[] }) {
  const columns = useMemo(
    () =>
      quantityColumns.columns([
        ...['specsolve_run', ...entry.dims].map((dim) =>
          quantityColumns.accessor((r) => r[dim], {
            id: dim,
            header: dim === 'specsolve_run' ? 'run' : dim,
            filterFn: 'equalsString',
            sortFn: 'basic',
            cell: (info) => label(info.getValue()),
            aggregatedCell: () => null,
          }),
        ),
        quantityColumns.accessor((r) => r.value as number, {
          id: 'value',
          header: 'value',
          enableGrouping: false,
          enableColumnFilter: false,
          sortFn: 'basic',
          aggregationFn: 'sum',
          cell: (info) => number(info.getValue()),
          aggregatedCell: (info) => <span title="sum over the group">Σ {number(info.getValue())}</span>,
        }),
      ]),
    [entry],
  )
  const table = useTable(
    {
      features: quantityFeatures,
      columns,
      data: rows,
      initialState: { pagination: { pageIndex: 0, pageSize: 25 } },
    },
    (state) => state,
  )
  const shown = table.getPrePaginatedRowModel().rows.length
  const matching = table.getFilteredRowModel().rows
  const total = matching.reduce((s, r) => s + Number(r.original.value), 0)

  return (
    <>
      <p className="hint">
        Pick values in a column's filter to narrow the rows. <strong>Group</strong> a column to sum <code>value</code> over
        everything else; group two to nest them.
      </p>
      <div className="table-wrap">
        <table className="rows">
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
                      {header.column.getCanGroup() ? (
                        <button
                          className={header.column.getIsGrouped() ? 'group on' : 'group'}
                          onClick={header.column.getToggleGroupingHandler()}
                          aria-pressed={header.column.getIsGrouped()}
                        >
                          group
                        </button>
                      ) : null}
                    </div>
                    {header.column.getCanFilter() ? <Filter column={header.column} /> : null}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className={row.getIsGrouped() ? 'grouped' : undefined}>
                {row.getAllCells().map((cell) => (
                  <td key={cell.id}>
                    {cell.getIsGrouped() ? (
                      <button className="expand" onClick={row.getToggleExpandedHandler()}>
                        {row.getIsExpanded() ? '▾' : '▸'} <table.FlexRender cell={cell} />{' '}
                        <span className="muted">({row.subRows.length})</span>
                      </button>
                    ) : cell.getIsPlaceholder() ? null : (
                      <table.FlexRender cell={cell} />
                    )}
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
          {table.state.grouping.length
            ? `${shown.toLocaleString()} groups of ${matching.length.toLocaleString()} rows`
            : `${matching.length.toLocaleString()} of ${rows.length.toLocaleString()} rows`}{' '}
          · Σ value {compact(total)}
        </span>
      </div>
    </>
  )
}

function Filter({ column }: { column: Column<typeof quantityFeatures, Row> }) {
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

function ReadIt({ url, bytes }: { url: string; bytes?: number }) {
  const [copied, setCopied] = useState<string | null>(null)
  const snippets = {
    DuckDB: `select * from '${url}';`,
    polars: `pl.read_parquet('${url}')`,
  }
  return (
    <div className="readit">
      <div className="readit-head">
        <span>
          Read it yourself{bytes ? <span className="muted"> · {compact(bytes / 1024)} KB of parquet</span> : null}
        </span>
      </div>
      {Object.entries(snippets).map(([tool, code]) => (
        <div key={tool} className="snippet">
          <span className="muted">{tool}</span>
          <code>{code}</code>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(code).then(() => setCopied(tool))
            }}
          >
            {copied === tool ? 'copied' : 'copy'}
          </button>
        </div>
      ))}
    </div>
  )
}
