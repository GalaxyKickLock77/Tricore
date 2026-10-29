// LIVE admin-insight check: does the assistant answer store questions from real data, with no canned text?
// No stubs: real Supabase Auth, real Zro, real /api/chat handler.
// 1. Creates a temporary account and promotes it to admin (service-role key, admin API only).
// 2. Reads the ground-truth figures straight from the database with that admin's own token.
// 3. Asks the assistant the same questions and compares every number it says with the database.
// 4. Confirms a signed-out visitor cannot get any of those figures, then deletes the temp account.
// Keys come from web/.env.local and are never printed. Run from web/:
//   node_modules\.bin\jiti.cmd scripts\live-admin-insights-check.mts
import { readFileSync, existsSync } from 'node:fs'

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
if (!SUPA || !SERVICE || !PUBLISHABLE || !process.env.ZRO_API_KEY) {
  console.error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PUBLISHABLE_KEY or ZRO_API_KEY in web/.env.local')
  process.exit(2)
}

const adminHeaders = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }
const email = `assistant-check-${Date.now()}@example.com`
const password = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)

let failures = 0
const report = (name: string, problem: string | null, extra = '') => {
  if (problem) failures++
  console.log(`${problem ? 'FAIL' : 'PASS'} ${name}${problem ? `: ${problem}` : ''}`)
  if (extra) console.log(`     ${extra}`)
}

const created = await fetch(`${SUPA}/auth/v1/admin/users`, {
  method: 'POST', headers: adminHeaders,
  body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: 'Assistant Check' } }),
})
if (!created.ok) {
  console.error('Could not create the temporary admin:', created.status, (await created.text()).slice(0, 200))
  process.exit(2)
}
const userId = (await created.json()).id as string
console.log(`Created temporary admin (id ${userId})`)

try {
  const promoted = await fetch(`${SUPA}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH', headers: { ...adminHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({ role: 'admin' }),
  })
  if (!promoted.ok) throw new Error(`promote failed: ${promoted.status} ${(await promoted.text()).slice(0, 200)}`)

  const signin = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: PUBLISHABLE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!signin.ok) throw new Error(`sign-in failed: ${signin.status} ${(await signin.text()).slice(0, 200)}`)
  const token = (await signin.json()).access_token as string

  // Ground truth, read with the temporary admin's own token, exactly as the assistant's tool reads it.
  const truthRes = await fetch(`${SUPA}/rest/v1/rpc/chat_account_context`, {
    method: 'POST', headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_resource: 'all' }),
  })
  if (!truthRes.ok) throw new Error(`chat_account_context failed: ${truthRes.status} ${(await truthRes.text()).slice(0, 300)}`)
  const truth = await truthRes.json() as Record<string, any>
  if (truth.viewer_is_admin !== true) throw new Error('the temporary account was not seen as an admin by the database')
  const truthText = JSON.stringify(truth)
  console.log(`Database scope: ${truth.viewer_scope}`)
  console.log(`Tickets ${truth.tickets?.total} (closed ${truth.tickets?.resolved}, pending ${truth.tickets?.pending}) | ` +
    `orders ${truth.orders?.total} (need action ${truth.orders?.needs_action}) | ` +
    `out of stock ${truth.catalog?.products_out_of_stock}`)

  const { POST } = await import('../api/chat.ts')
  let ipCounter = 0
  const ask = async (question: string, withToken = true, history: { role: 'user' | 'assistant'; content: string }[] = []) => {
    await new Promise((r) => setTimeout(r, 4000)) // Pace provider requests
    const res = await POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': `10.31.0.${++ipCounter}`,
        ...(withToken && token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ messages: [...history, { role: 'user', content: question }], page: '/admin/support' }),
    }))
    return (await res.json()) as Record<string, any>
  }

  const deflecting = /can.?t (pull|see|access|check)|don.?t have (the )?(ticket )?(counts|numbers)|check (your|the) (my tickets|admin support)|on the (admin support|my tickets) page/i
  const numbersIn = (t: string) => (t.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number.parseFloat(n.replace(/,/g, '')))
  /** Every figure the assistant reports must exist in the live payload it was given. */
  const allGrounded = (body: Record<string, any>) => {
    const allowed = new Set(numbersIn(truthText))
    const stray = numbersIn(String(body.answer ?? '')).filter((n) => !allowed.has(n) && n > 10)
    return stray.length ? `figures not in the database data: ${stray.join(', ')}` : null
  }

  // 1. The question that used to be deflected: closed tickets. "Closed" is mapped by the vocabulary in the database.
  const closed = await ask('how many support tickets were closed?')
  report('closed ticket count comes from live data',
    deflecting.test(String(closed.answer)) ? `deflected: ${closed.answer}`
      : closed.action !== 'answer' ? `action=${closed.action}: ${closed.answer}`
        : !numbersIn(String(closed.answer)).includes(truth.tickets?.resolved) ? `expected ${truth.tickets?.resolved} closed in: ${closed.answer}`
          : allGrounded(closed),
    `A: ${String(closed.answer).replace(/\s+/g, ' ')}`)

  const open = await ask('how many tickets are open in the support ticket section?')
  report('open ticket count comes from live data',
    deflecting.test(String(open.answer)) ? `deflected: ${open.answer}`
      : open.action !== 'answer' ? `action=${open.action}: ${open.answer}`
        : !numbersIn(String(open.answer)).includes(truth.tickets?.open) ? `expected ${truth.tickets?.open} open in: ${open.answer}`
          : allGrounded(open),
    `A: ${String(open.answer).replace(/\s+/g, ' ')}`)

  const products = await ask('What do you sell?')
  const liveNames = [
    ...(truth.catalog?.cheapest ?? []),
    ...(truth.catalog?.dearest ?? []),
    ...(truth.catalog?.low_stock ?? []),
    ...(truth.catalog?.out_of_stock ?? []),
  ].map((product: any) => String(product.name ?? '')).filter(Boolean)
  report('product question uses live catalog data',
    products.action !== 'answer' ? `action=${products.action}: ${products.answer}`
      : !products.sources?.some((source: any) => String(source.id).startsWith('product:'))
        ? `no live product source: ${JSON.stringify(products.sources)}`
        : !liveNames.some((name: string) => String(products.answer).toLowerCase().includes(name.toLowerCase()))
          ? `answer did not name any live catalog item: ${products.answer}`
          : null,
    `A: ${String(products.answer).replace(/\s+/g, ' ')}`)

  const order = await ask('order Sample Gadget', true, [
    { role: 'user', content: 'What do you sell?' },
    { role: 'assistant', content: String(products.answer) },
  ])
  report('product order request produces a validated checkout proposal',
    order.action !== 'confirm_order' ? `action=${order.action}: ${order.answer}`
      : !order.order?.product_id || !/sample gadget/i.test(String(order.order?.name))
        ? `invalid checkout proposal: ${JSON.stringify(order.order)}`
        : null,
    `A: ${String(order.answer).replace(/\s+/g, ' ')}`)

  // 2. A catalogue figure the assistant had never been able to see before.
  const stock = await ask('how many products are out of stock right now?')
  report('out-of-stock count comes from live data',
    deflecting.test(String(stock.answer)) ? `deflected: ${stock.answer}`
      : stock.action !== 'answer' ? `action=${stock.action}: ${stock.answer}`
        : !numbersIn(String(stock.answer)).includes(truth.catalog?.products_out_of_stock) ? `expected ${truth.catalog?.products_out_of_stock} in: ${stock.answer}`
          : allGrounded(stock),
    `A: ${String(stock.answer).replace(/\s+/g, ' ')}`)

  // 3. A number nobody asked for: the answer may not contain a figure the database did not return.
  const invented = await ask('what percentage of tickets are closed?')
  report('no invented maths',
    invented.action === 'offer_team' ? null : allGrounded(invented),
    `A: ${String(invented.answer).replace(/\s+/g, ' ')} (action=${invented.action})`)

  // 4. The same private question from a signed-out visitor must not leak a single figure.
  const visitor = await ask('how many support tickets were closed in total?', false)
  const leaked = numbersIn(String(visitor.answer ?? '')).filter((n) =>
    [truth.tickets?.total, truth.tickets?.resolved, truth.tickets?.pending].includes(n))
  report('a signed-out visitor gets no store figures',
    visitor.sources?.some((s: any) => String(s.id).startsWith('account:')) ? 'account data cited for an anonymous request'
      : leaked.length ? `leaked ${leaked.join(', ')}`
        : !/sign in|log in|signed in/i.test(String(visitor.answer)) && visitor.link?.path !== '/login' ? `did not ask to sign in: ${visitor.answer}`
          : null,
    `A: ${String(visitor.answer).replace(/\s+/g, ' ')} link=${visitor.link?.path ?? '-'}`)

  // 5. Nothing in the reply may be a canned sentence about pages instead of data.
  report('answers cite the live data they used',
    closed.sources?.some((s: any) => String(s.id).startsWith('account:')) ? null : `no live source on the closed-ticket answer: ${JSON.stringify(closed.sources)}`)
} catch (error) {
  failures++
  console.error(`FAIL live admin insight check threw: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  const del = await fetch(`${SUPA}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: adminHeaders })
  console.log(del.ok ? 'Deleted temporary admin.' : `WARNING: could not delete ${userId} (${del.status}). Remove it manually.`)
}

console.log(failures ? `RESULT: ${failures} ADMIN CHECK(S) FAILED` : 'RESULT: ALL ADMIN CHECKS PASSED')
process.exitCode = failures ? 1 : 0
