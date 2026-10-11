import { answerQuestion, handoff, type ChatContext, type ChatMessage } from './_lib/core.js'

// Simple per-instance throttle (best effort on serverless): 15 requests / 10 min per IP.
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
    .map((m) => ({ role: m.role as ChatMessage['role'], content: m.content.trim().slice(0, 600) }))
    .filter((m) => m.content.length > 0)
    .slice(-6)
  if (msgs.length === 0 || msgs[msgs.length - 1].role !== 'user') return null
  return msgs
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.GROQ_API_KEY
  const supaUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const supaKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!apiKey || !supaUrl || !supaKey) return json({ error: 'Chat is not configured' }, 500)

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (limited(ip)) {
    return json(handoff('You are sending messages very quickly. Please wait a moment, or I can connect you with our team.', 'throttled'))
  }

  let body: { messages?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid request' }, 400)
  }
  const messages = clean(body.messages)
  if (!messages) return json({ error: 'Invalid request' }, 400)

  // Retrieval (RAG): knowledge articles + live products from Supabase.
  const users = messages.filter((m) => m.role === 'user')
  const last = users[users.length - 1].content
  const query = last.split(/\s+/).length < 4 && users.length > 1 ? `${users[users.length - 2].content} ${last}` : last

  let context: ChatContext
  try {
    const res = await fetch(`${supaUrl}/rest/v1/rpc/chat_context`, {
      method: 'POST',
      headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_query: query }),
    })
    if (!res.ok) throw new Error(String(res.status))
    context = (await res.json()) as ChatContext
  } catch {
    return json(handoff("I couldn't load our information just now, so I'll connect you with the Tricore team.", 'retrieval failed'))
  }

  const { model: _model, ...reply } = await answerQuestion({ messages, context, apiKey })
  return json(reply)
}
