// Store currency: Indian rupees (UPI / GPay only works in INR).
export const money = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n))

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** Short, readable order number shown to customers and admins. */
export const orderRef = (id: string) => id.slice(0, 8).toUpperCase()
