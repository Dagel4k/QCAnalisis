const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

const appDir = __dirname;

let mainWindow: any = null;
let serverProcess: any = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(appDir, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:8080');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(appDir, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startServer() {
  try {
    const userDataPath = app.getPath('userData');
    const dashboardRoot = path.resolve(__dirname, '..');
    const serverScript = path.join(dashboardRoot, 'server', 'index.ts');
    const tsxPath = path.join(dashboardRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

    if (!fs.existsSync(tsxPath)) {
      console.error('tsx not found at', tsxPath);
    }

    console.log('Using Electron Node:', process.execPath);
    console.log('Server script:', serverScript);
    console.log('TSX path:', tsxPath);

    const envPath = [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      process.env.PATH || '',
    ].filter(Boolean).join(':');

    const env = {
      ...process.env,
      NODE_ENV: isDev ? 'development' : 'production',
      PORT: '3001',
      ELECTRON_MODE: 'true',
      USER_DATA_PATH: userDataPath,
      PATH: envPath,
      ELECTRON_RUN_AS_NODE: '1',
    };

    serverProcess = spawn(process.execPath, [tsxPath, serverScript], {
      env,
      stdio: 'inherit',
      cwd: userDataPath,
      shell: false,
    });

    serverProcess.on('error', (error: any) => {
      console.error('Server process error:', error);
    });

    serverProcess.on('exit', (code: any) => {
      console.log(`Server process exited with code ${code}`);
      if (code !== 0 && code !== null && mainWindow && !mainWindow.isDestroyed()) {
        console.error('Server crashed, restarting...');
        setTimeout(startServer, 2000);
      }
    });
  } catch (error) {
    console.error('Failed to start internal server:', error);
  }
}

app.whenReady().then(() => {
  startServer();

  setTimeout(() => {
    createWindow();
  }, 2000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (serverProcess) {
      serverProcess.kill();
    }
    app.quit();
  }
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});
