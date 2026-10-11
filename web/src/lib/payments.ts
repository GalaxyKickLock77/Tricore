/** UPI deep link: opens GPay / PhonePe / Paytm etc. on a phone and is the content of the QR code. */
export function buildUpiLink(opts: { upiId: string; name: string; amount: number; note: string }) {
  const q = new URLSearchParams({
    pa: opts.upiId,
    pn: opts.name,
    am: opts.amount.toFixed(2),
    cu: 'INR',
    tn: opts.note,
  })
  return `upi://pay?${q.toString()}`
}
