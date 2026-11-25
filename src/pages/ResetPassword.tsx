/*
 * Animations: Motion (https://motion.dev), v14.3.0
 * License: MIT (https://github.com/motiondivision/motion/blob/main/LICENSE.md)
 * Copyright (c) 2024 Motion B.V.
 */
import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import Logo from '../components/Logo'
import TextField from '../components/TextField'
import { resetPassword } from '../lib/authClient'
import { errorReveal } from '../lib/motion'
import '../styles/Auth.css'

const resetPasswordSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type ResetPasswordValues = z.infer<typeof resetPasswordSchema>

export default function ResetPassword() {
  useEffect(() => {
    document.title = 'BestBefore | Reset Password'
  }, [])

  // Neon Auth redirects here with ?token=... on a valid link, or ?error=INVALID_TOKEN otherwise.
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const linkInvalid = !token || searchParams.get('error') !== null

  const [formError, setFormError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({ resolver: zodResolver(resetPasswordSchema) })

  const onSubmit = async (values: ResetPasswordValues) => {
    if (!token) return
    setFormError(null)
    const result = await resetPassword(token, values.password)
    if (result.ok) {
      setDone(true)
    } else {
      setFormError(result.error)
    }
  }

  return (
    <main className="auth">
      <Logo />
      <h1 className="auth-title">BestBefore</h1>

      {linkInvalid ? (
        <>
          <p className="auth-message" role="alert">
            This reset link is invalid or has expired. Request a new one.
          </p>
          <p className="auth-footer">
            <Link to="/forgot-password" className="auth-link">
              Request a new link
            </Link>
          </p>
        </>
      ) : done ? (
        <>
          <p className="auth-message" role="status">
            Your password has been reset. You can now log in with your new password.
          </p>
          <p className="auth-footer">
            <Link to="/login" className="auth-link">
              Log in
            </Link>
          </p>
        </>
      ) : (
        <form className="auth-form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <p className="auth-message">Choose a new password for your account.</p>

          <TextField
            id="password"
            label="New password"
            type="password"
            placeholder="At least 8 characters"
            autoComplete="new-password"
            disabled={isSubmitting}
            error={errors.password?.message}
            {...register('password')}
          />

          <TextField
            id="confirmPassword"
            label="Confirm new password"
            type="password"
            placeholder="Re-enter your new password"
            autoComplete="new-password"
            disabled={isSubmitting}
            error={errors.confirmPassword?.message}
            {...register('confirmPassword')}
          />

          {formError && (
            <motion.p className="auth-error auth-form-error" role="alert" {...errorReveal}>
              {formError}
            </motion.p>
          )}

          <button type="submit" className="auth-submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Set new password'}
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
