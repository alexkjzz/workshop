import { useDeviceStatus } from './hooks/useDeviceStatus'
import { useLiveData } from './hooks/useLiveData'
import { useRoute } from './hooks/useRoute'
import { useSession } from './hooks/useSession'
import { LoginForm } from './components/LoginForm'
import { Topbar } from './components/Topbar'
import { CameraPage } from './pages/CameraPage'
import { MetricsPage } from './pages/MetricsPage'
import { SettingsPage } from './pages/SettingsPage'

interface AuthenticatedAppProps {
  userName: string
  onSignOut: () => void
  onSessionExpired: () => void
}

function AuthenticatedApp({ userName, onSignOut, onSessionExpired }: AuthenticatedAppProps) {
  const route = useRoute()
  const deviceStatus = useDeviceStatus(onSessionExpired)
  const { readings, detections } = useLiveData(onSessionExpired)

  return (
    <>
      <Topbar route={route} userName={userName} onSignOut={onSignOut} />
      {route === 'camera' && <CameraPage detections={detections} />}
      {route === 'settings' && <SettingsPage onSessionExpired={onSessionExpired} />}
      {route === 'metrics' && <MetricsPage {...deviceStatus} readings={readings} />}
    </>
  )
}

export function App() {
  const { session, pending, refresh, signIn, signOut } = useSession()

  if (pending) return null
  if (!session) {
    return (
      <>
        <Topbar />
        <LoginForm onSignIn={signIn} />
      </>
    )
  }
  return (
    <AuthenticatedApp
      userName={session.userName}
      onSignOut={() => void signOut()}
      onSessionExpired={() => void refresh()}
    />
  )
}
