import { app, BrowserWindow, Menu, session } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Remove native menu bar entirely
Menu.setApplicationMenu(null)

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'AI Video Reel',
    backgroundColor: '#0a0a0a',
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0a0a',
      symbolColor: '#666666',
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Required for Lovense localhost HTTP API (CORS bypass)
      webSecurity: false,
    },
  })

  // Only show once content is ready — avoids white flash on startup
  win.once('ready-to-show', () => win.show())

  // Load the Vite dev server in development, dist/index.html in production
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

// Allow video autoplay without user gesture requirement
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

app.setName('AI Video Reel')

app.whenReady().then(() => {
  // Grant all permission requests (media autoplay, etc.)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(true)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
