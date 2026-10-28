export type Role = 'user' | 'admin'

export interface Profile {
  id: string
  email: string | null
  full_name: string | null
  role: Role
}

export interface Product {
  id: string
  name: string
  description: string | null
  price: number
  stock: number
  image_url: string | null
  is_active: boolean
  created_at: string
}

export type OrderStatus = 'awaiting_payment' | 'payment_submitted' | 'paid' | 'shipped' | 'delivered' | 'cancelled'

export interface Order {
  id: string
  user_id: string
  product_id: string
  quantity: number
  unit_price: number
  total: number
  status: OrderStatus
  created_at: string
  payment_reference: string | null
  payment_note: string | null
  payment_submitted_at: string | null
  paid_at: string | null
  shipped_at: string | null
  delivered_at: string | null
  courier: string | null
  tracking_number: string | null
  tracking_url: string | null
  cancelled_reason: string | null
  ship_name: string | null
  ship_phone: string | null
  ship_line1: string | null
  ship_line2: string | null
  ship_city: string | null
  ship_state: string | null
  ship_pincode: string | null
  ship_country: string | null
  products?: { name: string; image_url?: string | null } | null
  profiles?: { email: string | null } | null
}

export interface OrderEvent {
  id: string
  order_id: string
  status: OrderStatus
  note: string | null
  actor_role: 'customer' | 'admin' | 'system'
  created_at: string
}

export interface Address {
  name: string
  phone: string
  line1: string
  line2: string
  city: string
  state: string
  pincode: string
}

export type StoreSettings = Record<'support_email' | 'unpaid_expiry_hours', string>

export type TicketStatus = 'open' | 'in_progress' | 'resolved'

export interface Ticket {
  id: string
  user_id: string | null
  contact: string
  question: string
  reason: string | null
  transcript: { role: string; content: string }[]
  status: TicketStatus
  created_at: string
  updated_at: string
  ai_summary: string | null
  ai_category: string | null
  ai_priority: 'low' | 'normal' | 'high' | 'urgent' | null
  customer_last_seen: string | null
  profiles?: { full_name: string | null; email: string | null } | null
}

export interface TicketComment {
  id: string
  ticket_id: string
  author_role: 'admin' | 'customer' | 'system'
  body: string
  is_internal: boolean
  created_at: string
}
