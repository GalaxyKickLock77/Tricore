import { config, json, database, authUser, createXPayOrder, safePaymentUrl } from './_lib/xpay.js'

export async function POST(request: Request) {
  try {
    const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1]
    if (!token) return json({ error: 'Please sign in.' }, 401)
    const db = database()
    if (!db) return json({ error: 'Payment is not configured on the server.' }, 503)
    const userId = await authUser(token, db)
    if (!userId) return json({ error: 'Please sign in.' }, 401)

    let body: any
    try { body = await request.json() } catch { return json({ error: 'Invalid request.' }, 400) }
    const orderId = body?.order_id
    if (typeof orderId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
      return json({ error: 'Invalid order.' }, 400)
    }

    const c = config()
    if (!c) return json({ error: 'Payment is not configured on the server.' }, 503)

    const { data: order, error } = await db
      .from('orders')
      .select('id, user_id, status, total, ship_phone, products(name)')
      .eq('id', orderId)
      .single()
    if (error || !order) return json({ error: 'Order not found.' }, 404)
    if (order.user_id !== userId) return json({ error: 'This is not your order.' }, 403)
    if (order.status !== 'awaiting_payment') return json({ error: 'This order is not waiting for payment.' }, 409)

    const productName = (order as any).products?.name ?? 'Order'
    const mobile = String(order.ship_phone ?? '').replace(/\D/g, '').slice(-10)
    const amount = Number(order.total).toFixed(2)

    const payload: Record<string, unknown> = {
      api_key: c.apiKey,
      amount,
      order_id: orderId,
      customer_mobile: mobile || undefined,
      remark: `${productName} | ${orderId.slice(0, 8)}`,
      success_url: `${c.store}/orders?payment=success&order=${orderId}`,
      failed_url: `${c.store}/orders?payment=failed&order=${orderId}`,
      timeout_url: `${c.store}/orders?payment=timeout&order=${orderId}`,
    }
    if (c.switchId) payload.switch = Number.isFinite(Number(c.switchId)) ? Number(c.switchId) : c.switchId

    const result = await createXPayOrder(c, payload)
    return json({ payment_url: result.payment_url })
  } catch {
    return json({ error: 'Could not start payment. Please try again.' }, 502)
  }
}
