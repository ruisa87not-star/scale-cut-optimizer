const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);

function enginePath() {
  return isDevelopment
    ? path.join(__dirname, '..', 'native', 'build', 'Release', 'cutting_optimizer.exe')
    : path.join(process.resourcesPath, 'native', 'cutting_optimizer.exe');
}

function serialiseRequest(payload) {
  const integer = (value, label) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${label} 必須是非負整數。`);
    return number;
  };
  const capacity = integer(payload.capacity, '新卷長度');
  const threshold = integer(payload.threshold, '可回收門檻');
  const segmentSize = integer(payload.segmentSize ?? 50, '節距');
  if (capacity <= 0) throw new Error('新卷長度必須大於 0。');
  if (segmentSize <= 0) throw new Error('節距必須大於 0。');
  const orders = (payload.orders || []).map(({ length, quantity, start = 0, end = 0 }) => [
    integer(length, '訂單長度'), integer(quantity, '訂單數量'), integer(start, '起始節段') || 0, integer(end, '結束節段') || 0,
  ])
    .filter(([length, quantity]) => length > 0 && quantity > 0);
  const offcuts = (payload.offcuts || []).map((length) => integer(length, '餘料長度')).filter(Boolean);
  if (!orders.length) throw new Error('請至少新增一項有效訂單。');
  return [
    capacity, threshold, segmentSize, orders.length,
    ...orders.flat(),
    offcuts.length,
    ...offcuts,
    '',
  ].join('\n');
}

function runNativeEngine(payload) {
  return new Promise((resolve, reject) => {
    const executable = enginePath();
    const child = spawn(executable, [], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(new Error('The C++ cutting engine is missing. Please download the complete application again.'));
      } else {
        reject(error);
      }
    });
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || `C++ 引擎異常結束（代碼 ${code}）。`));
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error('The C++ engine returned an unreadable result.'));
      }
    });
    try {
      child.stdin.end(serialiseRequest(payload));
    } catch (error) {
      child.kill();
      reject(error);
    }
  });
}

function setWindowLanguage(window, language) {
  const en = language === 'en';
  const label = (chinese, english) => en ? english : chinese;
  const item = (role, chinese, english) => ({ role, label: label(chinese, english) });
  window.setMenu(Menu.buildFromTemplate([
    { label: label('檔案', 'File'), submenu: [item('quit', '結束', 'Quit')] },
    { label: label('編輯', 'Edit'), submenu: [
      item('undo', '復原', 'Undo'), item('redo', '重做', 'Redo'), { type: 'separator' },
      item('cut', '剪下', 'Cut'), item('copy', '複製', 'Copy'), item('paste', '貼上', 'Paste'),
      item('selectAll', '全選', 'Select All'),
    ] },
    { label: label('檢視', 'View'), submenu: [
      item('resetZoom', '實際大小', 'Actual Size'), item('zoomIn', '放大', 'Zoom In'),
      item('zoomOut', '縮小', 'Zoom Out'), { type: 'separator' },
      item('togglefullscreen', '全螢幕', 'Toggle Full Screen'),
      ...(isDevelopment ? [{ type: 'separator' }, item('reload', '重新載入', 'Reload'), item('toggleDevTools', '開發者工具', 'Developer Tools')] : []),
    ] },
    { label: label('視窗', 'Window'), submenu: [item('minimize', '最小化', 'Minimise'), item('close', '關閉', 'Close')] },
    { label: label('說明', 'Help'), submenu: [item('about', '關於卷材裁切優化器', 'About Cutting Stock Optimizer')] },
  ]));
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#f6f8fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  setWindowLanguage(window, 'zh');
  if (isDevelopment) window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else window.loadFile(path.join(__dirname, '..', 'frontend-dist', 'index.html'));
}

app.whenReady().then(() => {
  ipcMain.on('app:language', (event, language) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) setWindowLanguage(window, language);
  });
  ipcMain.handle('optimizer:run', (_, payload) => runNativeEngine(payload));
  ipcMain.handle('workbook:save', async (_, bytes, defaultName, language) => {
    const english = language === 'en';
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: english ? 'Export cutting report' : '匯出裁切報告',
      buttonLabel: english ? 'Save' : '儲存',
      defaultPath: defaultName || 'cutting-stock-report.xlsx',
      filters: [{ name: english ? 'Excel workbook' : 'Excel 活頁簿', extensions: ['xlsx'] }],
    });
    if (canceled || !filePath) return { canceled: true };
    await fs.writeFile(filePath, Buffer.from(bytes));
    return { canceled: false, filePath };
  });
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
