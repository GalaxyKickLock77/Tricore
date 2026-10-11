import { Navigate } from 'react-router-dom'
import AuthForm from '../components/AuthForm'
import { useAuth } from '../lib/auth'

export default function Signup() {
  const { session, loading } = useAuth()
  if (!loading && session) return <Navigate to="/shop" replace />
  return (
    <AuthForm
      title="Create your account"
      description="Sign up in one click with your Google account"
      buttonLabel="Sign up with Google"
      footer={{ text: 'Already registered?', to: '/login', label: 'Sign in' }}
    />
  )
}
