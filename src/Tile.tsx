/** A stat tile: a label, one number, and a line of context under it. */
export function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="card tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      <div className="tile-note">{note}</div>
    </div>
  )
}
