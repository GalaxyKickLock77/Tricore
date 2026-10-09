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
