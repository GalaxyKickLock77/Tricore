// LIVE signed-in check. No stubs: real Supabase Auth, real Cline, real /api/chat handler.
// 1. Creates a temporary confirmed customer with the service-role key (admin API).
// 2. Signs in as that customer (password grant) to get a real access token.
// 3. Asks the signed-in questions through POST /api/chat with Authorization: Bearer <token>.
// 4. Deletes the temporary customer, even if a question failed.
// Keys come from web/.env.local and are never printed.
import { readFileSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const envFile = new URL('../.env.local', import.meta.url)
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const SUPA = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '')
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ''
if (!SUPA || !SERVICE || !PUBLISHABLE || !process.env.CLINE_API_KEY) {
  console.error('Missing Supabase/Cline keys in web/.env.local')
  process.exit(2)
}

const email = `chat-test-${Date.now()}@example.com`
const password = randomBytes(18).toString('base64url')
const adminHeaders = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }

const created = await fetch(`${SUPA}/auth/v1/admin/users`, {
  method: 'POST', headers: adminHeaders,
  body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: 'Chat Test' } }),
})
if (!created.ok) {
  console.error('Could not create test customer:', created.status, (await created.text()).slice(0, 200))
  process.exit(2)
}
const userId = (await created.json()).id as string
console.log(`Created temporary test customer (id ${userId})`)

let failures = 0
try {
  const signin = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: PUBLISHABLE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!signin.ok) throw new Error(`sign-in failed: ${signin.status} ${(await signin.text()).slice(0, 200)}`)
  const token = (await signin.json()).access_token as string
  console.log('Signed in as the test customer; access token obtained (not printed).')

  const { POST } = await import('../api/chat.ts')
  let ipCounter = 0
  const ask = async (question: string, history: { role: 'user' | 'assistant'; content: string }[] = []) => {
    await new Promise((r) => setTimeout(r, 4000)) // Pace free-model requests
    const res = await POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.30.0.${++ipCounter}`, authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages: [...history, { role: 'user', content: question }], page: '/shop' }),
    }))
    return { status: res.status, body: (await res.json()) as Record<string, any> }
  }

  const questions: { name: string; q: string; history?: { role: 'user' | 'assistant'; content: string }[]; verify: (b: Record<string, any>) => string | null }[] = [
    // The live catalog holds: Sample Widget (9.99, 49 in stock), Sample Gadget (24.50, 17 in stock).
    { name: 'product price comes from the catalog', q: 'How much is the Sample Widget?',
      verify: (b) => (b.action === 'answer' && /9\.99/.test(b.answer) ? null : `expected 9.99 in answer: ${b.answer}`) },
    { name: 'buy by name shows checkout button', q: 'I want to buy one Sample Gadget',
      verify: (b) => (b.action === 'confirm_order' || (b.link?.path ?? '').startsWith('/checkout') ? null : `no checkout button (action=${b.action}, link=${JSON.stringify(b.link)})`) },
    { name: 'quantity word is respected', q: 'checkout three Sample Widgets',
      verify: (b) => (/qty=3|"quantity":\s*3/.test(JSON.stringify(b)) ? null : `quantity not 3 (action=${b.action}, link=${JSON.stringify(b.link)})`) },
    { name: 'a laptop not in the catalog is not invented', q: 'do you have any Dell laptops?',
      verify: (b) => (b.order || b.action === 'confirm_order' ? 'checkout for a laptop that does not exist' : /don.?t|not (in|available)|no\b|couldn.?t/i.test(b.answer) ? null : `unclear: ${b.answer}`) },
    { name: 'unknown product is not invented', q: 'do you sell a quantum teleporter model Z9?',
      verify: (b) => (b.order || b.action === 'confirm_order' ? 'checkout for unknown product' : /don.?t|not (in|available|sure)|no\b|couldn.?t/i.test(b.answer) ? null : `unclear answer: ${b.answer}`) },
    { name: 'my orders reads this customer data', q: 'what are my recent orders?',
      verify: (b) => (b.action === 'answer' && !/sign in|log in/i.test(b.answer) ? null : `still asks to sign in: ${b.answer}`) },
    { name: 'follow-up "that one" keeps the product', q: 'how much is that one?',
      history: [{ role: 'user', content: 'Tell me about the Sample Widget' }, { role: 'assistant', content: 'The Sample Widget is a small demo product.' }],
      verify: (b) => (/9\.99/.test(b.answer) ? null : `lost the product or price: ${b.answer}`) },
  ]

  for (const t of questions) {
    try {
      const { status, body } = await ask(t.q, t.history)
      const problem = status !== 200 ? `HTTP ${status} ${JSON.stringify(body)}` : t.verify(body)
      if (problem) failures++
      console.log(`${problem ? 'FAIL' : 'PASS'} ${t.name}${problem ? `: ${problem}` : ''}`)
      console.log(`     Q: ${t.q}`)
      console.log(`     action=${body.action} intent=${body.intent} link=${body.link?.path ?? '-'} order=${body.order ? 'yes' : 'no'}`)
      console.log(`     A: ${String(body.answer ?? body.error ?? '').replace(/\s+/g, ' ')}`)
    } catch (error) {
      failures++
      console.log(`FAIL ${t.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
} finally {
  const del = await fetch(`${SUPA}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: adminHeaders })
  console.log(del.ok ? 'Deleted temporary test customer.' : `WARNING: could not delete test customer ${userId} (${del.status}). Delete it manually.`)
}

console.log(failures ? `RESULT: ${failures} SIGNED-IN CHECK(S) FAILED` : 'RESULT: ALL SIGNED-IN CHECKS PASSED')
process.exitCode = failures ? 1 : 0
