// Builds and sends the notification emails (order steps and support tickets).
// The database triggers post a small JSON event to /api/notify; this file turns it into emails.
import nodemailer from 'nodemailer'

export interface NotifyPayload {
  type: 'order' | 'ticket'
  event: string
  ref: string
  product?: string
  quantity?: number
  total?: number
  courier?: string | null
  tracking_number?: string | null
  tracking_url?: string | null
  payment_reference?: string | null
  note?: string | null
  customer_email?: string
  admin_email?: string
  contact?: string
  question?: string
  body?: string
  status?: string
}

export interface Email {
  to: string
  subject: string
  text: string
  html: string
  replyTo?: string
}

export const isEmail = (s: unknown): s is string => typeof s === 'string' && s.length <= 200 && /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(s)

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
const inr = (n: unknown) => `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const safeUrl = (u: unknown) => (typeof u === 'string' && /^https?:\/\/[^\s]{3,300}$/i.test(u) ? u : null)

function render(opts: { to: string; subject: string; lines: string[]; link?: { label: string; url: string }; replyTo?: string; tag?: 'Admin' | 'Customer' }): Email {
  const text = [...opts.lines, ...(opts.link ? ['', `${opts.link.label}: ${opts.link.url}`] : []), '', 'Tricore IT Solutions'].join('\n')
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;color:#111">
${opts.lines.map((l) => (l ? `<p style="margin:0 0 10px">${esc(l)}</p>` : '')).join('\n')}
${opts.link ? `<p style="margin:18px 0"><a href="${esc(opts.link.url)}" style="background:#4f46e5;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${esc(opts.link.label)}</a></p>` : ''}
<p style="color:#666;font-size:12px;margin-top:24px">Tricore IT Solutions</p></div>`
  return { to: opts.to, subject: `Tricore: ${opts.tag ? `[${opts.tag}] ` : ''}${opts.subject}`, text, html, replyTo: opts.replyTo }
}

export function buildEmails(p: NotifyPayload, appUrl: string): Email[] {
  const out: Email[] = []
  const admin = isEmail(p.admin_email) ? p.admin_email : null
  const customer = isEmail(p.customer_email) ? p.customer_email : isEmail(p.contact) ? p.contact : null
  const item = `${p.quantity ?? 1} × ${p.product ?? 'your item'} (${inr(p.total)})`
  const ref = `#${p.ref}`
  const orders = `${appUrl}/orders`

  if (p.type === 'order') {
    switch (p.event) {
      case 'order_placed':
        if (customer && customer !== admin) out.push(render({ to: customer, subject: `Order ${ref} placed`, lines: [`Thank you for your order ${ref}.`, item, 'We have opened a support ticket for you. Our team will contact you shortly to confirm payment and delivery.'], link: { label: 'View my tickets', url: `${appUrl}/tickets` }, replyTo: admin ?? undefined, tag: 'Customer' }))
        if (admin) out.push(render({ to: admin, subject: `New order ${ref}`, lines: [`New order ${ref} from ${p.customer_email ?? 'a customer'}.`, item, 'A support ticket has been opened. Please contact the customer to confirm payment and delivery.'], link: { label: 'Open orders', url: `${appUrl}/admin/orders` }, tag: 'Admin' }))
        break
      case 'payment_submitted':
        if (customer && customer !== admin) out.push(render({ to: customer, subject: `We received your payment details for ${ref}`, lines: [`Thanks! We received your payment reference${p.payment_reference ? ` ${p.payment_reference}` : ''} for order ${ref}.`, 'Our team is verifying it in the bank and will confirm shortly.'], link: { label: 'Track your order', url: orders }, replyTo: admin ?? undefined, tag: 'Customer' }))
        if (admin) out.push(render({ to: admin, subject: `Verify payment for ${ref}`, lines: [`${p.customer_email ?? 'A customer'} says they paid ${inr(p.total)} for order ${ref}.`, `UPI transaction ID: ${p.payment_reference ?? '(not given)'}`, 'Check your bank statement for this amount and ID, then confirm or reject the payment.'], link: { label: 'Verify payment', url: `${appUrl}/admin/orders` }, tag: 'Admin' }))
        break
      case 'payment_rejected':
        if (customer && customer !== admin) out.push(render({ to: customer, subject: `We could not verify the payment for ${ref}`, lines: [`We could not verify the payment for order ${ref}.`, p.note ?? '', 'Please check your payment and submit the correct UPI transaction ID.'], link: { label: 'Open my order', url: orders }, replyTo: admin ?? undefined, tag: 'Customer' }))
        break
      case 'payment_confirmed':
        if (customer && customer !== admin) out.push(render({ to: customer, subject: `Payment confirmed for ${ref}`, lines: [`Good news! We received your payment for order ${ref}.`, item, 'We are preparing your order for shipping.'], link: { label: 'Track your order', url: orders }, replyTo: admin ?? undefined, tag: 'Customer' }))
        break
      case 'shipped': {
        const url = safeUrl(p.tracking_url)
        if (customer && customer !== admin) out.push(render({ to: customer, subject: `Your order ${ref} has shipped`, lines: [`Your order ${ref} is on its way.`, item, `Courier: ${p.courier ?? '-'}`, `Tracking number: ${p.tracking_number ?? '-'}`], link: url ? { label: 'Track shipment', url } : { label: 'View my order', url: orders }, replyTo: admin ?? undefined, tag: 'Customer' }))
        break
      }
      case 'delivered':
        if (customer && customer !== admin) out.push(render({ to: customer, subject: `Order ${ref} delivered`, lines: [`Your order ${ref} was delivered. Thank you for shopping with Tricore!`, 'If anything is not right, open a support ticket and we will help.'], link: { label: 'Get support', url: `${appUrl}/tickets` }, replyTo: admin ?? undefined, tag: 'Customer' }))
        break
      case 'cancelled':
        if (customer && customer !== admin) out.push(render({ to: customer, subject: `Order ${ref} cancelled`, lines: [`Your order ${ref} was cancelled.`, p.note ?? '', 'If you did not expect this, open a support ticket.'], link: { label: 'Get support', url: `${appUrl}/tickets` }, replyTo: admin ?? undefined, tag: 'Customer' }))
        if (admin) out.push(render({ to: admin, subject: `Order ${ref} cancelled by customer`, lines: [`Order ${ref} was cancelled by the customer.`, p.note ?? '', `Customer: ${p.customer_email ?? 'unknown'}`], link: { label: 'Open orders', url: `${appUrl}/admin/orders` }, tag: 'Admin' }))
        break
    }
  }

  if (p.type === 'ticket') {
    const contactEmail = isEmail(p.contact) ? p.contact : null
    switch (p.event) {
      case 'opened':
        if (contactEmail && contactEmail !== admin) out.push(render({ to: contactEmail, subject: `We received your support ticket ${ref}`, lines: ['Thanks for contacting us. Our team will reply soon.', `Your message: ${p.question ?? ''}`], link: { label: 'View Support', url: `${appUrl}/tickets` }, replyTo: admin ?? undefined, tag: 'Customer' }))
        if (admin) out.push(render({ to: admin, subject: `New support ticket ${ref}`, lines: [`From: ${p.contact ?? 'unknown'}`, p.question ?? ''], link: { label: 'Open tickets', url: `${appUrl}/admin/support` }, tag: 'Admin' }))
        break
      case 'reply':
        if (contactEmail && contactEmail !== admin) out.push(render({ to: contactEmail, subject: `New reply on your ticket ${ref}${p.status ? ` (${p.status})` : ''}`, lines: ['Our team replied to your ticket:', '', p.body ?? '', '', ...(p.status ? [`Ticket status: ${p.status}`] : [])], link: { label: 'View the conversation', url: `${appUrl}/tickets` }, replyTo: admin ?? undefined, tag: 'Customer' }))
        break
      case 'status': {
        const note =
          p.status === 'Resolved'
            ? 'We have marked your ticket as resolved. If you still need help, just reply and we will reopen it.'
            : p.status === 'In progress'
              ? 'Our team is working on your ticket.'
              : 'Your ticket is open and waiting for our team.'
        if (contactEmail && contactEmail !== admin) out.push(render({ to: contactEmail, subject: `Your ticket ${ref} is now ${p.status ?? 'updated'}`, lines: [`The status of your ticket ${ref} changed to: ${p.status ?? 'updated'}.`, note], link: { label: 'View the conversation', url: `${appUrl}/tickets` }, replyTo: admin ?? undefined, tag: 'Customer' }))
        break
      }
      case 'customer_reply':
        if (admin) out.push(render({ to: admin, subject: `Customer replied on ticket ${ref}`, lines: [`From: ${p.contact ?? 'unknown'}`, p.body ?? '', ...(p.status ? [`Ticket status: ${p.status}`] : [])], link: { label: 'Open tickets', url: `${appUrl}/admin/support` }, tag: 'Admin' }))
        break
    }
  }
  return out
}

export interface Mailer {
  send(mail: Email & { from: string }): Promise<unknown>
}

/** Real SMTP sender (Gmail, Brevo, Zoho, Resend SMTP…). Returns null when SMTP is not configured. */
export function smtpMailer(env: Record<string, string | undefined> = process.env): { mailer: Mailer; from: string } | null {
  const host = env.SMTP_HOST
  const user = env.SMTP_USER
  const pass = env.SMTP_PASS
  if (!host || !user || !pass) return null
  const port = Number(env.SMTP_PORT ?? 465)
  const transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } })
  return { mailer: { send: (m) => transport.sendMail(m) }, from: env.MAIL_FROM ?? `Tricore IT Solutions <${user}>` }
}


