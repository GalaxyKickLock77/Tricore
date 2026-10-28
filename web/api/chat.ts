import { runAssistant } from './_lib/assistant.js'
import type { ChatMessage } from './_lib/core.js'

// Best-effort per-instance throttle: 15 customer messages / 10 min per IP.
const hits = new Map<string, number[]>()
function limited(ip: string): boolean {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 600_000)
  recent.push(now)
  hits.set(ip, recent)
  if (hits.size > 5000) hits.clear()
  return recent.length > 15
}

function clean(input: unknown): ChatMessage[] | null {
  if (!Array.isArray(input) || input.length === 0) return null
  const msgs = input
    .filter((m): m is { role: string; content: string } => !!m && typeof m.content === 'string' && typeof m.role === 'string')
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as ChatMessage['role'], content: m.content.trim().slice(0, m.role === 'assistant' ? 1200 : 600) }))
    .filter((m) => m.content.length > 0)
    .slice(-16)
  if (msgs.length === 0 || msgs[msgs.length - 1].role !== 'user') return null
  return msgs
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.ANYROUTER_API_KEY
  const supaUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const supaKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!apiKey || !supaUrl || !supaKey) return json({ error: 'Chat is not configured' }, 500)

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (limited(ip)) {
    return json({
      action: 'offer_team',
      answer: 'You are sending messages very quickly. Give me a moment, or would you like me to connect you with my team?',
      intent: 'question',
      sources: [],
      verified: true,
      handoffReason: 'throttled',
    })
  }

  let body: { messages?: unknown; name?: unknown; memory?: unknown; page?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid request' }, 400)
  }
  const messages = clean(body.messages)
  if (!messages) return json({ error: 'Invalid request' }, 400)

  const rawName = typeof body.name === 'string' ? body.name.trim().split(/\s+/)[0] : ''
  const name = /^[\p{L}'-]{2,24}$/u.test(rawName) ? rawName : undefined
  const memory = (Array.isArray(body.memory) ? body.memory : [])
    .filter((n): n is string => typeof n === 'string')
    .map((n) => n.trim().slice(0, 120))
    .filter(Boolean)
    .slice(-5)
  const page = typeof body.page === 'string' ? body.page.replace(/[^\w/-]/g, '').slice(0, 100) : ''
  const authorization = request.headers.get('authorization')
  const token = authorization?.replace(/^Bearer\s+/i, '').trim() || undefined

  const reply = await runAssistant({
    messages,
    apiKey,
    name,
    page,
    memory,
    runtime: { supaUrl, supaKey, token, fetchImpl: fetch },
  })
  reply.model = undefined
  return json(reply)
}
