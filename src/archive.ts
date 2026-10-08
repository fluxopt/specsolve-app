import { decompress } from 'fzstd'
import { type Compressors, parquetReadObjects } from 'hyparquet'

/** hyparquet reads snappy itself; a single archive's files are zstd. */
const compressors: Compressors = { ZSTD: (input, length) => decompress(input, new Uint8Array(length)) }

/** Where the archives are served: the showcase's Pages site, or a local copy under `public/` in development. */
export const ARCHIVE: string =
  import.meta.env.VITE_ARCHIVE ?? 'https://fluxopt.github.io/specsolve-showcase/archive'

/**
 * Read one stacked file of a published directory of archives, or one file of one archive.
 *
 * `path` is a path inside an archive, such as `answer/primal/total.parquet`;
 * the file at `<directory>/<path>` holds that path across every archive, each
 * row naming its archive in `specsolve_run`. `directory` may also name one
 * archive, such as `hedge/risk-050`, whose files specsolve compresses with
 * zstd. Integer columns arrive as `bigint`, so callers convert the ones they
 * do arithmetic on. `bytes` is the size of the file the rows came from.
 *
 * A file read once is kept for the visit, so a page opened again reads
 * nothing over the network. The rows are shared: callers map them rather
 * than change them.
 *
 * Throws if the server answers with an error status; a failed read is not kept.
 */
const cache = new Map<string, Promise<{ rows: unknown[]; bytes: number }>>()

export function read<Row>(directory: string, path: string, columns: string[]): Promise<{ rows: Row[]; bytes: number }> {
  const url = new URL(`${ARCHIVE}/${directory}/${path}`, window.location.href).href
  const key = `${url}|${columns.join(',')}`
  if (!cache.has(key)) {
    const reading = fetchRows(url, columns)
    reading.catch(() => cache.delete(key))
    cache.set(key, reading)
  }
  return cache.get(key)! as Promise<{ rows: Row[]; bytes: number }>
}

async function fetchRows(url: string, columns: string[]): Promise<{ rows: unknown[]; bytes: number }> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  const file = await response.arrayBuffer()
  return { rows: await parquetReadObjects({ file, columns, compressors }), bytes: file.byteLength }
}
