import { supabase } from './supabase'

export interface AiReply {
  reply?: string
  agent_notes?: string[]
  confidence?: 'high' | 'medium' | 'low'
  summary?: string
  category?: string
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  should_add?: boolean
  title?: string
  content?: string
  reason?: string
}

/** Calls the admin-only AI endpoint. Throws an Error with a readable message. */
export async function callSupportAi(mode: 'suggest_reply' | 'summarize' | 'kb_draft', ticketId: string): Promise<AiReply> {
  const { data } = await supabase.auth.getSession()
  const res = await fetch('/api/support-ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
    body: JSON.stringify({ mode, ticketId }),
  })
  const body = (await res.json().catch(() => ({}))) as AiReply & { error?: string }
  if (!res.ok) throw new Error(body.error ?? 'The AI could not help right now.')
  return body
}
