const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

const appDir = (() => {
  try {
    return path.dirname(require.main?.filename || process.execPath);
  } catch {
    return path.dirname(process.execPath);
  }
})();

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

function findProjectRoot(): string {
  const electronData = app.getPath('userData');
  const possibleRoots = [
    path.join(appDir, '../..'),
    path.join(appDir, '../../..'),
    process.cwd(),
  ];

  for (const root of possibleRoots) {
    const scriptPath = path.join(root, 'bin', 'review-gitlab-branches.js');
    if (fs.existsSync(scriptPath)) {
      return root;
    }
  }

  return electronData;
}

function startServer() {
  const projectRoot = findProjectRoot();
  const userDataPath = app.getPath('userData');
  
  const projectRootDir = path.resolve(appDir, '../..');
  const serverScript = path.join(projectRootDir, 'server', 'index.ts');
  
  let tsxPath: string;
  try {
    tsxPath = require.resolve('tsx');
  } catch {
    tsxPath = path.join(projectRootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    if (!fs.existsSync(tsxPath)) {
      console.error('tsx not found, server may not start correctly');
      return;
    }
  }
  
  let nodeExecutable: string = 'node';
  const { execSync } = require('child_process');
  
  if (process.platform === 'win32') {
    nodeExecutable = 'node.exe';
  } else {
    try {
      const whichResult = execSync('which node', { 
        encoding: 'utf8',
        env: { ...process.env, PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin' }
      }).trim();
      if (whichResult && fs.existsSync(whichResult)) {
        nodeExecutable = whichResult;
      }
    } catch (err) {
      console.log('which node failed, trying common paths');
    }
    
    if (nodeExecutable === 'node') {
      const commonPaths = [
        '/opt/homebrew/bin/node',
        '/usr/local/bin/node',
        '/usr/bin/node',
        '/bin/node',
      ];
      for (const nodePath of commonPaths) {
        if (fs.existsSync(nodePath)) {
          nodeExecutable = nodePath;
          break;
        }
      }
    }
  }
  
  console.log('Using Node.js:', nodeExecutable);
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
    REVIEW_SCRIPT_PATH: path.join(projectRoot, 'bin', 'review-gitlab-branches.js'),
    REPORT_SCRIPT_PATH: path.join(projectRoot, 'generate-html-lint-report.js'),
    WORK_DIR: path.join(userDataPath, '.work'),
    STORAGE_DIR: path.join(userDataPath, 'storage'),
    PATH: envPath,
  };

  serverProcess = spawn(nodeExecutable, [tsxPath, serverScript], {
    env,
    stdio: 'inherit',
    cwd: projectRootDir,
    shell: false,
  });

  serverProcess.on('error', (error) => {
    console.error('Server process error:', error);
  });

  serverProcess.on('exit', (code) => {
    console.log(`Server process exited with code ${code}`);
    if (code !== 0 && code !== null && mainWindow && !mainWindow.isDestroyed()) {
      console.error('Server crashed, restarting...');
      setTimeout(startServer, 2000);
    }
  });
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
