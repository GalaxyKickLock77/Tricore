import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { RequireAdmin, RequireAuth } from './components/Guards'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Landing from './pages/Landing'
import Products from './pages/Products'
import MyOrders from './pages/MyOrders'
import AdminProducts from './pages/AdminProducts'
import AdminOrders from './pages/AdminOrders'
import AdminSupport from './pages/AdminSupport'
import MyTickets from './pages/MyTickets'
import Checkout from './pages/Checkout'
import AdminSettings from './pages/AdminSettings'
import ChatWidget from './components/ChatWidget'

export default function App() {
  return (
    <>
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route path="/shop" element={<Products />} />
          <Route path="/orders" element={<MyOrders />} />
          <Route path="/tickets" element={<MyTickets />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route element={<RequireAdmin />}>
            <Route path="/admin/products" element={<AdminProducts />} />
            <Route path="/admin/orders" element={<AdminOrders />} />
            <Route path="/admin/support" element={<AdminSupport />} />
            <Route path="/admin/settings" element={<AdminSettings />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    <ChatWidget />
    </>
  )
}
