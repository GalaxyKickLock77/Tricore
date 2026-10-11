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

export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'cancelled'

export interface Order {
  id: string
  user_id: string
  product_id: string
  quantity: number
  unit_price: number
  status: OrderStatus
  created_at: string
  products?: { name: string } | null
  profiles?: { email: string | null } | null
}

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
}

export interface TicketComment {
  id: string
  ticket_id: string
  author_role: 'admin' | 'customer'
  body: string
  is_internal: boolean
  created_at: string
}
