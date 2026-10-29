// Checks the admin support AI: offline (fake model) for parsing/safety, then a few real calls.
import { writeFileSync, appendFileSync } from 'node:fs'
import { runSupportAi, type OrderData } from '../api/_lib/supportAi.ts'
const OUT = new URL('../ai-out.txt', import.meta.url)
writeFileSync(OUT, '')
const log = (m: string) => appendFileSync(OUT, m + '\n')
let fails = 0
const ok = (c: boolean, m: string) => { log((c ? 'PASS  ' : 'FAIL  ') + m); if (!c) fails++ }
const fake = (obj: unknown): typeof fetch => (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) } }] }), { status: 200 })) as unknown as typeof fetch
const fail429: typeof fetch = (async () => new Response('{}', { status: 429 })) as unknown as typeof fetch

const ticket = { id: 't1', contact: 'ravi@example.com', question: 'I paid yesterday but my order still shows pending. Where is it?', status: 'open', customer_name: 'Ravi' }
const orders: OrderData[] = [{ quantity: 1, unit_price: 899, status: 'payment_submitted', created_at: '2026-10-09T10:00:00Z', products: { name: 'Dell Latitude 5440 Laptop' } }]
const base = { ticket, thread: [], orders, context: null, apiKey: 'x' }

// offline
let r = await runSupportAi({ ...base, mode: 'suggest_reply', fetchImpl: fake({ reply: 'Hi Ravi, your payment for the Dell Latitude (₹899.00) is being verified.\nTricore Support', agent_notes: ['Check the bank'], confidence: 'high' }) })
ok(r.ok && r.result.confidence === 'high' && r.result.agent_notes?.length === 1, 'reply draft parsed, grounded numbers keep high confidence')
r = await runSupportAi({ ...base, mode: 'suggest_reply', fetchImpl: fake({ reply: 'We will refund ₹5,000 today.', agent_notes: [], confidence: 'high' }) })
ok(r.ok && r.result.confidence === 'low' && (r.result.agent_notes ?? []).some((n) => /numbers/.test(n)), 'invented amount -> confidence forced to low and the agent is warned')
r = await runSupportAi({ ...base, mode: 'summarize', fetchImpl: fake({ summary: 'Customer paid but order not confirmed', category: 'nonsense', priority: 'extreme' }) })
ok(r.ok && r.result.category === 'other' && r.result.priority === 'normal', 'invalid category/priority are normalised')
r = await runSupportAi({ ...base, mode: 'kb_draft', fetchImpl: fake({ should_add: true, title: 'Payment verification', content: 'Payments are verified within one business day. Contact ravi@example.com or +91 98765 43210 for help.', reason: 'x' }) })
ok(r.ok && !/ravi@example|98765/.test(r.result.content ?? ''), 'personal data is scrubbed from knowledge drafts')
r = await runSupportAi({ ...base, mode: 'kb_draft', fetchImpl: fake({ should_add: true, title: 'x', content: 'short' }) })
ok(r.ok && r.result.should_add === false, 'too-short drafts are not proposed')
r = await runSupportAi({ ...base, mode: 'suggest_reply', fetchImpl: fail429 })
ok(!r.ok && r.busy === true, 'quota exhausted -> friendly "busy" error')
r = await runSupportAi({ ...base, mode: 'suggest_reply', fetchImpl: (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not json at all' } }] }), { status: 200 })) as unknown as typeof fetch })
ok(!r.ok, 'unreadable AI output -> error, nothing is invented')

// real model (uses a little free quota)
const apiKey = process.env.ZRO_API_KEY ?? ''
const thread = [{ author_role: 'admin' as const, body: 'Hi, we checked and your payment was received. Payments take up to one business day to be verified. Your order will ship after that.' }]
for (const mode of ['summarize', 'suggest_reply'] as const) {
  const out = await runSupportAi({ ticket, thread: mode === 'suggest_reply' ? [] : [], orders, context: null, apiKey, mode })
  log(`REAL ${mode}: ` + JSON.stringify(out).slice(0, 700))
  await new Promise((res) => setTimeout(res, 8000))
}
const kb = await runSupportAi({ ticket: { ...ticket, status: 'resolved' }, thread, orders: [], context: null, apiKey, mode: 'kb_draft' })
log('REAL kb_draft: ' + JSON.stringify(kb).slice(0, 800))
log(fails ? `RESULT(offline): ${fails} FAILED` : 'RESULT(offline): ALL PASSED')
