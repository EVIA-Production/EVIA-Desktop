import { app } from 'electron'
import fs from 'fs'
import path from 'path'

const isDemoMode =
  !app.isPackaged &&
  process.env.TAYLOS_DEMO_MODE === '1'

if (isDemoMode) {
  const demoUserData = path.join(app.getPath('appData'), 'Taylos Demo Shoot')
  fs.mkdirSync(demoUserData, { recursive: true })
  app.setPath('userData', demoUserData)
  console.log('[DemoMode] Isolated local state at:', demoUserData)
}
