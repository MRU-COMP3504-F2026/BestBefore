import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import Logo from '../components/Logo'
import TextField from '../components/TextField'
import { mockForgotPassword } from '../lib/mockAuth'
import '../styles/Auth.css'

const forgotPasswordSchema = z.object({
  email: z.string().min(1, 'Email is required').pipe(z.email('Enter a valid email')),
})

type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>

export default function ForgotPassword() {
  useEffect(() => {
    document.title = 'BestBefore | Forgot Password'
  }, [])

  const [sentTo, setSentTo] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({ resolver: zodResolver(forgotPasswordSchema) })

  const onSubmit = async (values: ForgotPasswordValues) => {
    const result = await mockForgotPassword()
    if (result.ok) {
      setSentTo(values.email)
    }
  }

  return (
    <main className="auth">
      <Logo />
      <h1 className="auth-title">BestBefore</h1>

      {sentTo ? (
        <p className="auth-message" role="status">
          If an account exists for {sentTo}, you'll receive a reset link shortly.
        </p>
      ) : (
        <form className="auth-form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <p className="auth-message">
            Enter your email and we'll send you a link to reset your password.
          </p>

          <TextField
            id="email"
            label="Email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            disabled={isSubmitting}
            error={errors.email?.message}
            {...register('email')}
          />

          <button type="submit" className="auth-submit" disabled={isSubmitting}>
            {isSubmitting ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}

      <div className="auth-divider">
        <span>or</span>
      </div>

      <p className="auth-footer">
        <Link to="/login" className="auth-link">
          Back to log in
        </Link>
      </p>
    </main>
  )
}
