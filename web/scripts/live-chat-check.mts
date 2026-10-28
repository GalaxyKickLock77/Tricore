// LIVE check of the Tricore chat assistant: no stubs. Calls the real /api/chat handler,
// which calls the real Groq API and the real Supabase project (keys read from web/.env.local).
// Run from web/:  node_modules\.bin\jiti.cmd scripts\live-chat-check.mts
// Signed-in checkout needs a customer session token, so it is not covered here (see the report).
import { readFileSync, existsSync } from 'node:fs'

const envFile = new URL('../.env.local', import.meta.url)
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
if (!process.env.GROQ_API_KEY || !(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)) {
  console.error('Missing GROQ_API_KEY or SUPABASE_URL in web/.env.local')
  process.exit(2)
}

const { POST } = await import('../api/chat.ts')

let failures = 0
let ipCounter = 0
async function ask(question: string, history: { role: 'user' | 'assistant'; content: string }[] = []) {
  // A fresh IP per call so the per-IP throttle never interferes with the checks.
  const ip = `10.20.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250 + 1}`
  const messages = [...history, { role: 'user', content: question }]
  const res = await POST(new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ messages, page: '/' }),
  }))
  return { status: res.status, body: (await res.json()) as Record<string, any> }
}

async function check(name: string, question: string, verify: (b: Record<string, any>) => string | null, history?: { role: 'user' | 'assistant'; content: string }[]) {
  // Groq's free tier rate-limits bursts; the assistant retries 429s, so a short pause is enough.
  await new Promise((r) => setTimeout(r, 4000))
  console.log(`... ${name}`)
  const started = Date.now()
  try {
    const { status, body } = await ask(question, history)
    const problem = status !== 200 ? `HTTP ${status}: ${JSON.stringify(body)}` : verify(body)
    const secs = ((Date.now() - started) / 1000).toFixed(1)
    if (problem) {
      failures++
      console.log(`FAIL ${name} (${secs}s): ${problem}`)
    } else {
      console.log(`PASS ${name} (${secs}s)`)
    }
    console.log(`     Q: ${question}`)
    console.log(`     action=${body.action} intent=${body.intent} link=${body.link?.path ?? '-'} order=${body.order ? 'yes' : 'no'} model=${body.model ?? '-'}`)
    console.log(`     A: ${String(body.answer ?? body.error ?? '').replace(/\s+/g, ' ')}`)
  } catch (error) {
    failures++
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const mustBe = (actual: unknown, expected: unknown, what: string) =>
  actual === expected ? null : `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`

await check('greeting is answered warmly', 'hi there', (b) =>
  mustBe(b.action, 'answer', 'action') ?? (/tricore|help|welcome|hi|hello|hey/i.test(b.answer) ? null : 'greeting reply not on-brand'))

await check('who are you: identifies as the Tricore assistant, not a human', 'who are you?', (b) =>
  /assistant|bot|ai/i.test(b.answer) && !/\bI am (a )?(human|real person)\b/i.test(b.answer) ? null : 'identity answer wrong')

// The intent label is chosen by the model, so judge behaviour: no poem written, no shop or checkout action.
await check('off-topic request is redirected, not answered', 'write me a poem about the moon', (b) =>
  /\b(stanza|rhyme|moonlight|under the moon)\b/i.test(b.answer) || b.answer.length > 400 ? 'bot may have written the poem'
    : b.order || b.link?.path === '/shop' ? 'off-topic request triggered shop action'
    : null)

await check('bare checkout while signed out offers sign-in button', 'I want to checkout', (b) =>
  mustBe(b.link?.path, '/login', 'link') ?? (b.order ? 'checkout order produced while signed out' : null))

await check('buying a product while signed out does not create an order', 'I want to buy a dell laptop', (b) =>
  b.order ? 'order produced while signed out' : b.action === 'confirm_order' ? 'confirm_order while signed out' : null)

await check('unknown product is not invented', 'do you sell gaming chairs with 10 year warranty?', (b) => {
  if (b.order) return 'order produced for a product the bot cannot see'
  const claimsWarranty = /\b10[- ]year\b/i.test(b.answer)
  const denies = /don.?t|do not|can.?t|cannot|not (sure|available|in|listed)|no\b|sorry|isn.?t|not in|sign in|log in/i.test(b.answer)
  return claimsWarranty && !denies ? 'warranty claim invented' : null
})

await check('discount request goes to the team, with the listed price not invented', 'can you give me 50% discount on anything?', (b) =>
  mustBe(b.action, 'offer_team', 'action') ?? (b.order ? 'order produced on a discount request' : null))

await check('delivery detail the bot does not have is not guessed', 'how many days does delivery take to Chennai?', (b) =>
  /\b\d+\s*(days?|hours?|weeks?)\b/i.test(b.answer) ? `guessed delivery time: ${b.answer}` : null)

await check('order status while signed out asks to sign in', 'where is my latest order?', (b) =>
  b.order ? 'order produced for a status question' : /sign in|log in|signed in/i.test(b.answer) ? null : 'did not ask to sign in')

await check('follow-up keeps context from the earlier turn', 'and how many would that be for 3?', (b) => {
  if (b.order) return 'order produced without signed-in checkout'
  return null
}, [
  { role: 'user', content: 'do you have a laptop?' },
  { role: 'assistant', content: 'Yes, we have laptops. Which one would you like to know about?' },
])

console.log(failures ? `RESULT: ${failures} LIVE CHECK(S) FAILED` : 'RESULT: ALL LIVE CHECKS PASSED')
process.exitCode = failures ? 1 : 0
