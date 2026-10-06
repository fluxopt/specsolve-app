/**
 * Colour by entity, in a fixed order, from the showcase's validated palette.
 *
 * Each value is a CSS variable, so light and dark mode are the stylesheet's
 * choice and a chart never re-renders to change theme. A technology this
 * model does not name takes the next free hue.
 */
const KNOWN: Record<string, string> = { gas: 'blue', wind: 'aqua', solar: 'yellow' }
const ORDER = ['blue', 'orange', 'aqua', 'yellow']

export function technologyColors(names: string[]): string[] {
  const free = ORDER.filter((hue) => !names.some((n) => KNOWN[n] === hue))
  return names.map((n, i) => `var(--hue-${KNOWN[n] ?? free.shift() ?? ORDER[i % ORDER.length]})`)
}

/** The single-hue sequential ramp for a magnitude, light to dark. */
export const SEQUENTIAL = ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b']
