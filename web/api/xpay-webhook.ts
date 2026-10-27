import { config, json, database, checkXPayStatus } from './_lib/xpay.js'

export async function POST(request: Request) {
  try {
    const c = config()
    const db = database()
    if (!c || !db) return json({ error: 'Payment is not configured.' }, 503)

    const raw = await request.text()
    if (raw.length > 65536) return json({ error: 'Payload too large' }, 413)
    let event: any
    try { event = JSON.parse(raw) } catch { return json({ error: 'Invalid JSON' }, 400) }

    const orderId = event?.order_id
    if (typeof orderId !== 'string' || !/^[0-9a-f]{32}$/i.test(orderId)) {
      return json({ received: true })
    }

    // Verify independently with the Check Status API; never trust the callback body alone.
    let statusData: any
    try { statusData = await checkXPayStatus(c, orderId) } catch { return json({ error: 'Retry webhook later' }, 503) }
    if (statusData?.status !== 'success' || statusData?.data?.status !== 'Success') {
      // Not confirmed; leave the order awaiting payment so the customer can retry.
      return json({ received: true })
    }

    const amount = Number(statusData.data.amount)
    const utr = typeof statusData.data.utr === 'string' ? statusData.data.utr : (typeof event?.utr === 'string' ? event.utr : '')

    // Map the compact XPay order id back to our store order id (UUID with hyphens).
    const { data: allOrders, error: listError } = await db.from('orders').select('id, status, total, payment_reference')
    if (listError) return json({ error: 'Retry webhook later' }, 503)
    const order = (allOrders ?? []).find((o: any) => String(o.id).replace(/-/g, '').toLowerCase() === orderId.toLowerCase())
    if (!order) return json({ received: true }) // unknown order, ignore

    // Amount must match.
    if (!Number.isFinite(amount) || Math.abs(Number(order.total) - amount) > 0.005) {
      return json({ received: true })
    }

    // Never move paid/shipped/delivered backward.
    if (order.status === 'paid' || order.status === 'shipped' || order.status === 'delivered') {
      return json({ received: true })
    }
    if (order.status !== 'awaiting_payment' && order.status !== 'payment_submitted') {
      return json({ received: true })
    }

    const { error: updateError } = await db
      .from('orders')
      .update({ status: 'paid', paid_at: new Date().toISOString(), payment_reference: utr || order.payment_reference, payment_note: null })
      .eq('id', order.id)
    if (updateError) return json({ error: 'Retry webhook later' }, 503)

    await db.from('order_events').insert({
      order_id: order.id,
      status: 'paid',
      note: `Payment received via XPay.${utr ? ` UTR ${utr}.` : ''}`,
      actor_role: 'system',
    })

    return json({ received: true })
  } catch {
    return json({ error: 'Retry webhook later' }, 503)
  }
}
