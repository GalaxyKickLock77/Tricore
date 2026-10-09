import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { RequireAdmin, RequireAuth } from './components/Guards'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Products from './pages/Products'
import MyOrders from './pages/MyOrders'
import AdminProducts from './pages/AdminProducts'
import AdminOrders from './pages/AdminOrders'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Products />} />
          <Route path="/orders" element={<MyOrders />} />
          <Route element={<RequireAdmin />}>
            <Route path="/admin/products" element={<AdminProducts />} />
            <Route path="/admin/orders" element={<AdminOrders />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
