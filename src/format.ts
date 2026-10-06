const compactFormat = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const plainFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 0 })

export const compact = (d: number) => compactFormat.format(d)
export const plain = (d: number) => plainFormat.format(d)
export const percent = (d: number) => `${(d * 100).toFixed(0)}%`
