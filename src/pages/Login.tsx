/*
 * Animations: Motion (https://motion.dev), v14.3.0
 * License: MIT (https://github.com/motiondivision/motion/blob/main/LICENSE.md)
 * Copyright (c) 2024 Motion B.V.
 */
import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import Logo from '../components/Logo'
import TextField from '../components/TextField'
import { signIn } from '../lib/authClient'
import { errorReveal } from '../lib/motion'
import '../styles/Auth.css'

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').pipe(z.email('Enter a valid email')),
  password: z.string().min(1, 'Password is required'),
})

type LoginValues = z.infer<typeof loginSchema>

export default function Login() {
  useEffect(() => {
    document.title = 'BestBefore | Log In'
  }, [])

  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) })

  const onSubmit = async (values: LoginValues) => {
    setFormError(null)
    const result = await signIn(values.email, values.password)
    if (result.ok) {
      navigate(from, { replace: true })
    } else {
      setFormError(result.error)
    }
  }

  return (
    <main className="auth">
      <Logo />
      <h1 className="auth-title">BestBefore</h1>

      <form className="auth-form" onSubmit={handleSubmit(onSubmit)} noValidate>
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

        <TextField
          id="password"
          label="Password"
          type="password"
          placeholder="Enter your password"
          autoComplete="current-password"
          disabled={isSubmitting}
          error={errors.password?.message}
          labelAction={
            <Link to="/forgot-password" className="auth-link auth-link-small">
              Forgot password?
            </Link>
          }
          {...register('password')}
        />

        {formError && (
          <motion.p className="auth-error auth-form-error" role="alert" {...errorReveal}>
            {formError}
          </motion.p>
        )}

        <button type="submit" className="auth-submit" disabled={isSubmitting}>
          {isSubmitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>

      <div className="auth-divider">
        <span>or</span>
      </div>

      <p className="auth-footer">
        New to BestBefore?{' '}
        <Link to="/register" className="auth-link">
          Create an account
        </Link>
      </p>
    </main>
  )
}
