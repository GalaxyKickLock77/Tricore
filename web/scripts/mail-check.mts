// Offline checks for the notification emails and the /api/notify security (no email is really sent).
import { writeFileSync, appendFileSync } from 'node:fs'
import { buildEmails, type Email } from '../api/_lib/mail.ts'
import { handleNotify } from '../api/notify.ts'
const OUT = new URL('../mail-out.txt', import.meta.url)
writeFileSync(OUT, '')
let fails = 0
const ok = (c: boolean, m: string) => { appendFileSync(OUT, (c ? 'PASS  ' : 'FAIL  ') + m + '\n'); if (!c) fails++ }
const APP = 'https://shop.example.com'
const base = { type: 'order' as const, ref: 'AB12CD34', product: 'Widget', quantity: 2, total: 1000, customer_email: 'c@x.com', admin_email: 'team@x.com' }

let m = buildEmails({ ...base, event: 'order_placed' }, APP)
ok(m.length === 2 && m[0].to === 'c@x.com' && m[1].to === 'team@x.com', 'order placed -> customer and admin')
ok(/₹1,000\.00/.test(m[0].text) && /#AB12CD34/.test(m[0].subject) && m[0].text.includes(`${APP}/orders`), 'amount in rupees, order number, link to My orders')
ok(m[1].text.includes(`${APP}/admin/orders`), 'admin mail links to the Orders page')
m = buildEmails({ ...base, event: 'payment_submitted', payment_reference: '412345678901' }, APP)
ok(m.length === 2 && /412345678901/.test(m[1].text) && /bank statement/.test(m[1].text), 'payment submitted -> admin is told which ID to look for')
m = buildEmails({ ...base, event: 'payment_rejected', note: 'Amount not received' }, APP)
ok(m.length === 1 && m[0].to === 'c@x.com' && /Amount not received/.test(m[0].text), 'payment rejected -> customer only, with the reason')
m = buildEmails({ ...base, event: 'payment_confirmed' }, APP)
ok(m.length === 1 && m[0].to === 'c@x.com', 'payment confirmed -> customer only')
m = buildEmails({ ...base, event: 'shipped', courier: 'DTDC', tracking_number: 'TRK1', tracking_url: 'https://t.example.com/TRK1' }, APP)
ok(m.length === 1 && /DTDC/.test(m[0].text) && /TRK1/.test(m[0].text) && m[0].html.includes('https://t.example.com/TRK1'), 'shipped -> courier, tracking number and link')
m = buildEmails({ ...base, event: 'shipped', courier: 'DTDC', tracking_number: 'TRK1', tracking_url: 'javascript:alert(1)' }, APP)
ok(!m[0].html.includes('javascript:'), 'unsafe tracking links are dropped')
ok(buildEmails({ ...base, event: 'delivered' }, APP).length === 1 && buildEmails({ ...base, event: 'cancelled', note: 'Cancelled automatically' }, APP).length === 1, 'delivered and cancelled -> customer')
ok(buildEmails({ ...base, event: 'unknown_event' }, APP).length === 0, 'unknown events send nothing')
m = buildEmails({ ...base, customer_email: 'not an email', event: 'payment_confirmed' }, APP)
ok(m.length === 0, 'invalid customer address -> nothing sent')
m = buildEmails({ ...base, admin_email: '', event: 'order_placed' }, APP)
ok(m.length === 1, 'no support email configured -> only the customer is mailed')
m = buildEmails({ ...base, event: 'payment_rejected', note: '<script>alert(1)</script>' }, APP)
ok(!m[0].html.includes('<script>') && m[0].html.includes('&lt;script&gt;'), 'user text is HTML-escaped')

const t = { type: 'ticket' as const, ref: 'ZZ99XX11', contact: 'visitor@x.com', admin_email: 'team@x.com' }
m = buildEmails({ ...t, event: 'opened', question: 'Where is my invoice?' }, APP)
ok(m.length === 2 && /invoice/.test(m[1].text), 'ticket opened -> customer confirmation and admin alert')
m = buildEmails({ ...t, event: 'reply', body: 'Your invoice is attached.' }, APP)
ok(m.length === 1 && m[0].to === 'visitor@x.com' && /attached/.test(m[0].text) && m[0].replyTo === 'team@x.com', 'admin reply -> emailed to the ticket contact (even visitors), reply-to is the team')
m = buildEmails({ ...t, event: 'reply', body: 'Done.', status: 'In progress' }, APP)
ok(m.length === 1 && /Ticket status: In progress/.test(m[0].text) && /\(In progress\)/.test(m[0].subject), 'team reply email shows the ticket status')
m = buildEmails({ ...t, event: 'status', status: 'Resolved' }, APP)
ok(m.length === 1 && m[0].to === 'visitor@x.com' && /now Resolved/.test(m[0].subject) && /reopen/.test(m[0].text), 'status change email: Resolved, with a hint that replying reopens it')
m = buildEmails({ ...t, event: 'status', status: 'In progress' }, APP)
ok(m.length === 1 && /working on your ticket/.test(m[0].text), 'status change email: In progress')
m = buildEmails({ ...t, event: 'customer_reply', body: 'Thanks!' }, APP)
ok(m.length === 1 && m[0].to === 'team@x.com', 'customer reply -> admin')
ok(buildEmails({ ...t, contact: '+919876543210', event: 'reply', body: 'x' }, APP).length === 0, 'a phone number as contact is not emailed')

// ── endpoint security
const sent: (Email & { from: string })[] = []
const mail = { mailer: { send: async (x: Email & { from: string }) => void sent.push(x) }, from: 'Tricore <no-reply@x.com>' }
const call = (headers: Record<string, string>, body: unknown, deps: Partial<Parameters<typeof handleNotify>[1]> = {}) =>
  handleNotify(new Request('http://x/api/notify', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }), { secret: 's3cret', appUrl: APP, mail, ...deps })
let r = await call({ 'x-notify-secret': 'wrong' }, { ...base, event: 'delivered' })
ok(r.status === 403 && sent.length === 0, 'wrong secret -> 403, nothing sent')
r = await call({}, { ...base, event: 'delivered' })
ok(r.status === 403, 'missing secret -> 403')
r = await call({ 'x-notify-secret': 's3cret' }, { ...base, event: 'delivered' }, { secret: undefined })
ok(r.status === 503, 'server without NOTIFY_SECRET refuses')
r = await call({ 'x-notify-secret': 's3cret' }, { ...base, event: 'delivered' }, { mail: null })
ok(r.status === 503, 'SMTP not configured -> 503 (the database just logs it)')
r = await call({ 'x-notify-secret': 's3cret' }, 'not json')
ok(r.status === 400, 'bad JSON -> 400')
r = await call({ 'x-notify-secret': 's3cret' }, { type: 'evil', event: 'x' })
ok(r.status === 400, 'unknown type -> 400')
r = await call({ 'x-notify-secret': 's3cret' }, 'x'.repeat(30000))
ok(r.status === 413, 'oversized body -> 413')
r = await call({ 'x-notify-secret': 's3cret' }, { ...base, event: 'shipped', courier: 'DTDC', tracking_number: 'T1' })
const j = await r.json()
ok(r.status === 200 && j.sent === 1 && sent.length === 1 && sent[0].from.includes('no-reply'), 'valid event with the right secret -> email handed to the mailer')
const failing = { mailer: { send: async () => { throw new Error('smtp down') } }, from: 'x' }
r = await call({ 'x-notify-secret': 's3cret' }, { ...base, event: 'delivered' }, { mail: failing })
ok(r.status === 200 && (await r.json()).failed === 1, 'a mail failure is reported, not thrown')
appendFileSync(OUT, fails ? `RESULT: ${fails} FAILED\n` : 'RESULT: ALL PASSED\n')
