import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import PageHeader from '../components/PageHeader'
import { UserIcon } from '../components/icons'
import { signOut, useAuthSession } from '../lib/authClient'
import { AUTH_DISABLED } from '../lib/devAuth'
import '../styles/ProfilePage.css'

export default function ProfilePage() {
  useEffect(() => {
    document.title = 'BestBefore | My Profile'
  }, [])
  const navigate = useNavigate()
  const { data: session } = useAuthSession()
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const user = {
    name: session?.user.name ?? '',
    email: session?.user.email ?? '',
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

      {/* Nothing to log out of while the dev auth bypass is on. */}
      <Button variant="secondary" onClick={onLogout} disabled={isLoggingOut || AUTH_DISABLED}>
        Log out
      </Button>
    </div>
  )
}
