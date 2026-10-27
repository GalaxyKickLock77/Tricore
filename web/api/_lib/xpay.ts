import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

export function config() {
  const { XPAY_API_KEY, STORE_URL, XPAY_SWITCH } = process.env
  if (!XPAY_API_KEY || !STORE_URL) return null
  const store = new URL(STORE_URL)
  if ((store.protocol !== 'https:' && !(store.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(store.hostname))) || store.username || store.password) throw new Error('Invalid store URL')
  return { apiKey: XPAY_API_KEY, store: store.origin, switchId: XPAY_SWITCH || undefined }
}

export type Config = NonNullable<ReturnType<typeof config>>

export function database(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function authUser(token: string, db: SupabaseClient): Promise<string | null> {
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) return null
  const { data: profile, error: profileError } = await db.from('profiles').select('role').eq('id', data.user.id).single()
  // any signed-in user may pay their own order; admin not required
  if (profileError) return null
  return data.user.id
}

export function safePaymentUrl(value: unknown) {
  if (typeof value !== 'string') throw new Error('Missing payment URL')
  const u = new URL(value)
  if (u.protocol !== 'https:' || u.hostname !== 'xpaygateway.store' || u.username || u.password) throw new Error('Unexpected payment URL')
  return u.href
}

export async function createXPayOrder(c: Config, payload: Record<string, unknown>) {
  const r = await fetch('https://xpaygateway.store/api/create-order', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await r.json().catch(() => null)
  if (!r.ok) throw new Error(data?.message || 'XPay create-order failed')
  if (!data || data.status !== 'success' || typeof data.payment_url !== 'string') throw new Error(data?.message || 'Unexpected XPay response')
  return { payment_url: safePaymentUrl(data.payment_url), order_id: data.order_id }
}

export async function checkXPayStatus(c: Config, orderId: string) {
  const r = await fetch('https://xpaygateway.store/api/check-status', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: c.apiKey, order_id: orderId }),
  })
  const data = await r.json().catch(() => null)
  if (!r.ok) throw new Error('XPay status check failed')
  return data
}
