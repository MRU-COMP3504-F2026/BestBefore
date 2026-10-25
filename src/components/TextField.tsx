/*
 * Animations: Motion (https://motion.dev), v14.3.0
 * License: MIT (https://github.com/motiondivision/motion/blob/main/LICENSE.md)
 * Copyright (c) 2024 Motion B.V.
 */
import { useId, useState, type InputHTMLAttributes, type ReactNode, type Ref } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { EyeIcon, EyeOffIcon } from './icons'
import { errorReveal } from '../lib/motion'
import '../styles/TextField.css'

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  error?: string
  hint?: string
  tag?: 'Optional' | 'Recommended'
  labelAction?: ReactNode
  ref?: Ref<HTMLInputElement>
}

export default function TextField({
  label,
  error,
  hint,
  tag,
  labelAction,
  id,
  required,
  type,
  disabled,
  ...rest
}: TextFieldProps) {
  const [showPassword, setShowPassword] = useState(false)
  const isPassword = type === 'password'
  const generatedId = useId()
  const inputId = id ?? generatedId
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className="text-field">
      <div className="text-field-label-row">
        <label htmlFor={inputId}>
          {label}
          {required && (
            <span className="text-field-required" aria-hidden="true">
              *
            </span>
          )}
          {tag && <span className={`text-field-tag text-field-tag-${tag.toLowerCase()}`}>{tag}</span>}
        </label>
        {labelAction}
      </div>
      <div className="text-field-input">
        <input
          id={inputId}
          type={isPassword && showPassword ? 'text' : type}
          required={required}
          disabled={disabled}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={describedBy}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            className="text-field-toggle"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-controls={inputId}
            disabled={disabled}
            onClick={() => setShowPassword((shown) => !shown)}
          >
            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
      </div>
      {hint && (
        <p id={hintId} className="text-field-hint">
          {hint}
        </p>
      )}
      <AnimatePresence initial={false}>
        {error && (
          <motion.p key={error} id={errorId} className="text-field-error" {...errorReveal}>
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}
