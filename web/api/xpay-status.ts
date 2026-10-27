import { config, json, database, checkXPayStatus } from './_lib/xpay.js'

export async function POST(request: Request) {
  try {
    const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1]
    if (!token) return json({ error: 'Please sign in.' }, 401)
    const db = database()
    if (!db) return json({ error: 'Payment is not configured.' }, 503)
    const { data: userData, error: userError } = await db.auth.getUser(token)
    if (userError || !userData.user) return json({ error: 'Please sign in.' }, 401)
    const userId = userData.user.id

    let body: any
    try { body = await request.json() } catch { return json({ error: 'Invalid request.' }, 400) }
    const orderId = body?.order_id
    if (typeof orderId !== 'string') return json({ error: 'Invalid order.' }, 400)

    const { data: order, error } = await db.from('orders').select('id, user_id, status, total').eq('id', orderId).single()
    if (error || !order) return json({ error: 'Order not found.' }, 404)
    if (order.user_id !== userId) return json({ error: 'Not your order.' }, 403)

    const c = config()
    if (!c) return json({ error: 'Payment is not configured.' }, 503)

    const xpayOrderId = orderId.replace(/-/g, '')
    let statusData: any
    try { statusData = await checkXPayStatus(c, xpayOrderId) } catch { return json({ status: order.status }) }
    if (statusData?.status !== 'success' || statusData?.data?.status !== 'Success') {
      return json({ status: order.status, xpay: statusData?.data?.status ?? 'pending' })
    }
    const amount = Number(statusData.data.amount)
    if (!Number.isFinite(amount) || Math.abs(Number(order.total) - amount) > 0.005) {
      return json({ status: order.status, xpay: 'amount_mismatch' })
    }
    if (order.status !== 'paid' && order.status !== 'shipped' && order.status !== 'delivered') {
      if (order.status === 'awaiting_payment' || order.status === 'payment_submitted') {
        await db.from('orders').update({ status: 'paid', paid_at: new Date().toISOString(), payment_reference: statusData.data.utr || null, payment_note: null }).eq('id', orderId)
        await db.from('order_events').insert({ order_id: orderId, status: 'paid', note: `Payment confirmed via XPay status check.${statusData.data.utr ? ` UTR ${statusData.data.utr}.` : ''}`, actor_role: 'system' })
      }
    }
    return json({ status: 'paid', xpay: 'Success' })
  } catch {
    return json({ error: 'Could not check payment status.' }, 502)
  }
}
