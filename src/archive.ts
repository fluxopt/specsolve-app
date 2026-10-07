import { parquetReadObjects } from 'hyparquet'

/** Where the archives are served: the showcase's Pages site, or a local copy under `public/` in development. */
export const ARCHIVE: string =
  import.meta.env.VITE_ARCHIVE ?? 'https://fluxopt.github.io/specsolve-showcase/archive'

/**
 * Read one stacked file of a published directory of archives.
 *
 * `path` is a path inside an archive, such as `answer/primal/total.parquet`;
 * the file at `<directory>/<path>` holds that path across every archive, each
 * row naming its archive in `specsolve_run`. Integer columns arrive as
 * `bigint`, so callers convert the ones they do arithmetic on. `bytes` is the
 * size of the file the rows came from.
 *
 * Throws if the server answers with an error status.
 */
export async function read<Row>(
  directory: string,
  path: string,
  columns: string[],
): Promise<{ rows: Row[]; bytes: number }> {
  const url = new URL(`${ARCHIVE}/${directory}/${path}`, window.location.href).href
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  const file = await response.arrayBuffer()
  return { rows: (await parquetReadObjects({ file, columns })) as Row[], bytes: file.byteLength }
}
