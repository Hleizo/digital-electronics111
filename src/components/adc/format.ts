export const signed = (value: number, digits = 6) => `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(digits)}`
export const volts = (value: number | null | undefined) => value == null ? '—' : `${value.toFixed(6)} V`
