import { authClient } from './auth-client'
import { DeviceDashboard } from './components/DeviceDashboard'
import { LoginForm } from './components/LoginForm'
import { useDeviceDashboard } from './hooks/useDeviceDashboard'

function Dashboard({ userName, onSessionExpired }: { userName: string; onSessionExpired: () => void }) {
  const dashboard = useDeviceDashboard(onSessionExpired)
  return (
    <DeviceDashboard
      {...dashboard}
      userName={userName}
      onSignOut={() => void authClient.signOut()}
    />
  )
}

function App() {
  const { data: session, isPending, refetch } = authClient.useSession()

  if (isPending) return null
  if (!session) return <LoginForm />
  return <Dashboard userName={session.user.name} onSessionExpired={() => void refetch()} />
}

export default App
