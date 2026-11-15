import { useEffect, useState } from 'react'
import Button from './components/Button'
import './styles/InstallApp.css'

interface InstallEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)')
    const update = () => setInstalled(standalone.matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
    const ready = (event: Event) => { event.preventDefault(); setPrompt(event as InstallEvent) }
    const done = () => { setInstalled(true); setPrompt(null) }
    update()
    standalone.addEventListener('change', update)
    window.addEventListener('beforeinstallprompt', ready)
    window.addEventListener('appinstalled', done)
    return () => {
      standalone.removeEventListener('change', update)
      window.removeEventListener('beforeinstallprompt', ready)
      window.removeEventListener('appinstalled', done)
    }
  }, [])
  if (installed) return null
  const install = async () => {
    if (!prompt || busy) return
    setBusy(true)
    try {
      await prompt.prompt()
      await prompt.userChoice
    } catch {
      // Browser may withdraw eligibility; manual instructions remain available.
    } finally {
      setPrompt(null)
      setBusy(false)
    }
  }
  return <aside aria-label="Install BestBefore" className="install-app">
    {prompt && <Button variant="secondary" disabled={busy} onClick={() => { void install() }}>Install BestBefore</Button>}
    <details>
      <summary>Install BestBefore on your phone</summary>
      <p>iPhone or iPad: open this site in Safari, tap Share, then Add to Home Screen and Add. If shown, enable Open as Web App.</p>
      <p>Android: open this site in Chrome, then use Install BestBefore above or the browser menu's Install app / Add to Home screen option.</p>
      <p>If opened inside another app, open this page in Safari or Chrome first. Installation needs HTTPS and browser support. BestBefore requires an internet connection.</p>
    </details>
  </aside>
}
