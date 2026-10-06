import { DeviceDashboard } from './components/DeviceDashboard'
import { useDeviceDashboard } from './hooks/useDeviceDashboard'

function App() {
  const dashboard = useDeviceDashboard()
  return <DeviceDashboard {...dashboard} />
}

export default App
