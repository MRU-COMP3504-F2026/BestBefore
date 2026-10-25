/*
 * Animations: Motion (https://motion.dev), v14.3.0
 * License: MIT (https://github.com/motiondivision/motion/blob/main/LICENSE.md)
 * Copyright (c) 2024 Motion B.V.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import Button from '../components/Button'
import PageHeader from '../components/PageHeader'
import { ChevronRightIcon, HouseIcon, UserIcon } from '../components/icons'
import { signOut, useAuthSession } from '../lib/authClient'
import { AUTH_DISABLED } from '../lib/devAuth'
import { spring, tap } from '../lib/motion'
import '../styles/ProfilePage.css'

// Placeholder until household membership is implemented.
const household = 'My Household'

export default function ProfilePage() {
  const navigate = useNavigate()
  const { data: session } = useAuthSession()
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const user = {
    name: session?.user.name ?? '',
    email: session?.user.email ?? '',
    household,
  }

  const onLogout = async () => {
    setIsLoggingOut(true)
    const result = await signOut()
    if (result.ok) {
      navigate('/login', { replace: true })
    } else {
      setIsLoggingOut(false)
    }
  }

  return (
    <div className="profile">
      <PageHeader title="Profile" backTo="/" />

      <section className="profile-identity">
        <div className="profile-avatar">
          <UserIcon />
        </div>
        <p className="profile-name">{user.name}</p>
        <p className="profile-email">{user.email}</p>
      </section>

      <motion.button type="button" className="profile-row" whileTap={tap} transition={spring}>
        <span className="profile-row-icon">
          <HouseIcon />
        </span>
        <span className="profile-row-body">
          <span className="profile-row-label">Household</span>{' '}
          <span className="profile-row-value">{user.household}</span>
        </span>
        <ChevronRightIcon className="profile-row-chevron" />
      </motion.button>

      {/* Nothing to log out of while the dev auth bypass is on. */}
      <Button variant="secondary" onClick={onLogout} disabled={isLoggingOut || AUTH_DISABLED}>
        Log out
      </Button>
    </div>
  )
}
