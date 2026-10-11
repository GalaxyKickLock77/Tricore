import { timingSafeEqual } from 'node:crypto'
import { buildEmails, smtpMailer, type Mailer, type NotifyPayload } from './_lib/mail.js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

const same = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined)

/** Called by the database (pg_net) whenever an order or ticket event happens. Protected by a shared secret. */
export async function handleNotify(
  request: Request,
  deps: { secret?: string; appUrl: string; mail: { mailer: Mailer; from: string } | null },
): Promise<Response> {
  if (!deps.secret) return json({ error: 'Notifications are not configured' }, 503)
  if (!same(request.headers.get('x-notify-secret') ?? '', deps.secret)) return json({ error: 'Forbidden' }, 403)
  if (!deps.mail) return json({ error: 'Email (SMTP) is not configured' }, 503)

  let raw: Record<string, unknown>
  try {
    const text = await request.text()
    if (text.length > 20_000) return json({ error: 'Too large' }, 413)
    raw = JSON.parse(text)
  } catch {
    return json({ error: 'Invalid request' }, 400)
  }
  if ((raw.type !== 'order' && raw.type !== 'ticket') || typeof raw.event !== 'string') return json({ error: 'Invalid event' }, 400)

  const payload: NotifyPayload = {
    type: raw.type,
    event: clip(raw.event, 40) ?? '',
    ref: clip(raw.ref, 12) ?? '',
    product: clip(raw.product, 200),
    quantity: typeof raw.quantity === 'number' ? raw.quantity : undefined,
    total: typeof raw.total === 'number' ? raw.total : undefined,
    courier: clip(raw.courier, 80),
    tracking_number: clip(raw.tracking_number, 100),
    tracking_url: clip(raw.tracking_url, 400),
    payment_reference: clip(raw.payment_reference, 60),
    note: clip(raw.note, 400),
    customer_email: clip(raw.customer_email, 200),
    admin_email: clip(raw.admin_email, 200),
    contact: clip(raw.contact, 200),
    question: clip(raw.question, 1500),
    body: clip(raw.body, 1500),
  }

  const emails = buildEmails(payload, deps.appUrl)
  const results = await Promise.allSettled(
    emails.map((m) => deps.mail!.mailer.send({ ...m, from: deps.mail!.from })),
  )
  const failed = results.filter((r) => r.status === 'rejected').length
  return json({ sent: emails.length - failed, failed })
}

export async function POST(request: Request): Promise<Response> {
  return handleNotify(request, {
    secret: process.env.NOTIFY_SECRET,
    appUrl: (process.env.APP_URL ?? 'https://tricore-eight.vercel.app').replace(/\/$/, ''),
    mail: smtpMailer(),
  })
}
