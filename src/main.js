const {
  app, BrowserWindow, ipcMain, screen, Tray, Menu,
  dialog, shell, nativeImage,
} = require('electron');
const path = require('path');
const fs = require('fs');

// ─── Single instance lock ──────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }
else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

let mainWindow = null;
let tray = null;

// ─── Icon ──────────────────────────────────────────────────────────
function getIconPath() {
  const png = path.join(__dirname, '..', 'assets', 'icon.png');
  const ico = path.join(__dirname, '..', 'assets', 'icon.ico');
  if (fs.existsSync(png)) return png;
  if (fs.existsSync(ico)) return ico;
  return undefined;
}
function createFallbackTrayIcon() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) { buf[i*4]=56;buf[i*4+1]=189;buf[i*4+2]=148;buf[i*4+3]=255; }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

// ─── Window ────────────────────────────────────────────────────────
function createWindow() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const winW = 540, winH = 780;
  mainWindow = new BrowserWindow({
    width: winW, height: winH,
    x: Math.round((screenW - winW) / 2), y: Math.round((screenH - winH) / 2),
    frame: false, transparent: true, resizable: true, minWidth: 460, minHeight: 560, show: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    icon: getIconPath(),
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); } });
}

// ─── Tray ──────────────────────────────────────────────────────────
function createTray() {
  const iconPath = getIconPath();
  let trayIcon = iconPath ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }) : createFallbackTrayIcon();
  tray = new Tray(trayIcon);
  tray.setToolTip('CleanSweep');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show / Hide', click: toggleWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', toggleWindow);
}
function toggleWindow() {
  if (!mainWindow) return;
  mainWindow.isVisible() ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus());
}

// ─── IPC: Window controls ──────────────────────────────────────────
ipcMain.handle('minimize-window', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('close-window', () => { if (mainWindow) mainWindow.hide(); });

// ─── IPC: Settings ─────────────────────────────────────────────────
ipcMain.handle('get-settings', () => {
  const p = path.join(app.getPath('userData'), 'settings.json');
  try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
  return null;
});
ipcMain.handle('save-settings', (_, s) => {
  const p = path.join(app.getPath('userData'), 'settings.json');
  try { fs.writeFileSync(p, JSON.stringify(s, null, 2)); return true; } catch (_) { return false; }
});

// ─── Dangerous path protection ─────────────────────────────────────
function isDangerousPath(folderPath) {
  const normalized = path.resolve(folderPath).toLowerCase().replace(/\\/g, '/');
  const winDangerous = ['c:/','c:/windows','c:/windows/system32','c:/windows/syswow64','c:/program files','c:/program files (x86)','c:/programdata','c:/users','c:/$recycle.bin','c:/recovery','c:/boot','c:/system volume information'];
  const unixDangerous = ['/','/bin','/sbin','/usr','/usr/bin','/usr/sbin','/usr/lib','/usr/local','/etc','/var','/sys','/proc','/dev','/boot','/lib','/lib64','/opt','/root','/tmp'];
  const homeDir = (process.env.USERPROFILE || process.env.HOME || '').toLowerCase().replace(/\\/g, '/');
  for (const d of [...winDangerous, ...unixDangerous]) {
    if (normalized === d || normalized === d + '/') return { dangerous: true, reason: `"${path.basename(folderPath) || folderPath}" is a protected system directory.` };
  }
  if (homeDir && (normalized === homeDir || normalized === homeDir + '/')) return { dangerous: true, reason: 'Your user profile root is protected. Choose a subfolder like Desktop or Downloads.' };
  if (/^[a-z]:\/?$/.test(normalized)) return { dangerous: true, reason: 'Drive roots are protected. Choose a subfolder.' };
  return { dangerous: false };
}

// ─── IPC: Folder selection ─────────────────────────────────────────
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: 'Select folder to clean up' });
  if (result.canceled || !result.filePaths.length) return { cancelled: true };
  const selected = result.filePaths[0];
  const check = isDangerousPath(selected);
  if (check.dangerous) return { cancelled: false, dangerous: true, reason: check.reason, path: selected };
  return { cancelled: false, dangerous: false, path: selected };
});
ipcMain.handle('select-cleanup-dest', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: 'Choose where to create the CleanUp folder' });
  if (result.canceled || !result.filePaths.length) return { cancelled: true };
  const selected = result.filePaths[0];
  const check = isDangerousPath(selected);
  if (check.dangerous) return { cancelled: false, dangerous: true, reason: check.reason, path: selected };
  return { cancelled: false, dangerous: false, path: selected };
});

// ─── IPC: Scan folder (quick) ──────────────────────────────────────
ipcMain.handle('scan-folder', (_, folderPath) => {
  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (entry.name === 'CleanUp' || entry.name.startsWith('.')) continue;
      const fullPath = path.join(folderPath, entry.name);
      try {
        const stat = fs.statSync(fullPath);
        if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          files.push({ name: entry.name, path: fullPath, type: ext || '(no ext)', size: stat.size, sizeHuman: humanSize(stat.size), modified: stat.mtime.toISOString(), created: stat.birthtime.toISOString() });
        }
      } catch (_) {}
    }
    return { success: true, files, folderPath };
  } catch (err) { return { success: false, error: err.message }; }
});

// ─── IPC: Deep scan (metadata + content extraction) ────────────────
ipcMain.handle('deep-scan-file', async (_, filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const meta = {};
  try {
    // ── PDF: extract first ~2000 chars of text ──
    if (ext === '.pdf') {
      const buf = fs.readFileSync(filePath);
      const text = extractPdfText(buf);
      if (text) meta.content = text.substring(0, 2000);
      meta.pageEstimate = (buf.toString('ascii').match(/\/Type\s*\/Page[^s]/g) || []).length;
    }
    // ── DOCX/XLSX/PPTX/DOC/XLS/PPT: read metadata from XML inside zip ──
    else if (['.docx','.xlsx','.pptx','.doc','.xls','.ppt'].includes(ext)) {
      const result = extractOfficeMetadata(filePath, ext);
      if (result) Object.assign(meta, result);
    }
    // ── Text/code files: read first 1500 chars ──
    else if (['.txt','.md','.csv','.json','.js','.ts','.py','.html','.css','.java','.c','.cpp','.h','.rb','.go','.rs','.sh','.bat','.ps1','.xml','.yaml','.yml','.ini','.cfg','.conf','.log','.sql','.r','.rtf'].includes(ext)) {
      const fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(1500);
      const bytesRead = fs.readSync(fd, buf, 0, 1500, 0);
      fs.closeSync(fd);
      meta.content = buf.toString('utf8', 0, bytesRead).replace(/\0/g, '');
    }
    // ── Images: read EXIF-like info from JPEG headers ──
    else if (['.jpg','.jpeg'].includes(ext)) {
      const exif = extractBasicExif(filePath);
      if (exif) Object.assign(meta, exif);
    }
    // ── Images (general): just note dimensions from PNG header ──
    else if (ext === '.png') {
      const dims = extractPngDimensions(filePath);
      if (dims) Object.assign(meta, dims);
    }
  } catch (err) { meta.error = err.message; }
  return meta;
});

// ── PDF text extraction (basic — works for most text-based PDFs) ──
function extractPdfText(buf) {
  const str = buf.toString('binary');
  const texts = [];
  // Find stream...endstream blocks and look for text operators
  const regex = /stream\r?\n([\s\S]*?)endstream/g;
  let match;
  while ((match = regex.exec(str)) !== null && texts.join('').length < 2500) {
    const block = match[1];
    // Look for text between parentheses in Tj/TJ operators
    const tjRegex = /\(([^)]*)\)/g;
    let tj;
    while ((tj = tjRegex.exec(block)) !== null) {
      const decoded = tj[1].replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\');
      if (decoded.trim().length > 0 && /[a-zA-Z0-9]/.test(decoded)) texts.push(decoded);
    }
  }
  return texts.join(' ').replace(/\s+/g, ' ').trim() || null;
}

// ── Office doc metadata (docx/xlsx/pptx are ZIP files with XML) ──
function extractOfficeMetadata(filePath, ext) {
  try {
    const buf = fs.readFileSync(filePath);
    const meta = {};
    const str = buf.toString('binary');
    // Old .doc/.xls/.ppt are OLE format, not ZIP — just try keyword extraction
    if (['.doc','.xls','.ppt'].includes(ext)) {
      // Extract readable ASCII strings for a content hint
      const readable = str.replace(/[^\x20-\x7E\n]/g, ' ').replace(/\s{3,}/g, '  ').trim();
      if (readable.length > 20) meta.content = readable.substring(0, 1500);
      return Object.keys(meta).length ? meta : null;
    }
    // Modern Office XML formats — ZIP containing XML
    const titleMatch = str.match(/<dc:title>(.*?)<\/dc:title>/);
    if (titleMatch) meta.title = titleMatch[1].substring(0, 200);
    const subjectMatch = str.match(/<dc:subject>(.*?)<\/dc:subject>/);
    if (subjectMatch) meta.subject = subjectMatch[1].substring(0, 200);
    const creatorMatch = str.match(/<dc:creator>(.*?)<\/dc:creator>/);
    if (creatorMatch) meta.author = creatorMatch[1].substring(0, 100);
    const descMatch = str.match(/<dc:description>(.*?)<\/dc:description>/);
    if (descMatch) meta.description = descMatch[1].substring(0, 300);
    const kwMatch = str.match(/<cp:keywords>(.*?)<\/cp:keywords>/);
    if (kwMatch) meta.keywords = kwMatch[1].substring(0, 200);
    // For docx: try to get some body text
    if (ext === '.docx') {
      const bodyTexts = [];
      const wTRegex = /<w:t[^>]*>(.*?)<\/w:t>/g;
      let wt;
      while ((wt = wTRegex.exec(str)) !== null && bodyTexts.join(' ').length < 1500) {
        bodyTexts.push(wt[1]);
      }
      if (bodyTexts.length) meta.content = bodyTexts.join(' ').substring(0, 1500);
    }
    return Object.keys(meta).length ? meta : null;
  } catch (_) { return null; }
}

// ── Basic JPEG EXIF (camera model, date, dimensions) ──
function extractBasicExif(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(65536);
    fs.readSync(fd, buf, 0, 65536, 0);
    fs.closeSync(fd);
    const meta = {};
    const str = buf.toString('binary');
    // Look for common EXIF strings
    const dateMatch = str.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (dateMatch) meta.dateTaken = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]} ${dateMatch[4]}:${dateMatch[5]}:${dateMatch[6]}`;
    // Camera make/model often appear as ASCII strings
    const makeModels = str.match(/(Canon|Nikon|Sony|Apple|Samsung|Google|Fujifilm|Olympus|Panasonic|LG|OnePlus|Xiaomi|Huawei|OPPO|iPhone|Pixel)[^\0]{0,40}/i);
    if (makeModels) meta.camera = makeModels[0].replace(/[^\x20-\x7E]/g, ' ').trim().substring(0, 60);
    // Check for screenshot indicators
    if (str.includes('Screenshot') || str.includes('Snipping') || str.includes('ShareX')) meta.isScreenshot = true;
    return Object.keys(meta).length ? meta : null;
  } catch (_) { return null; }
}

// ── PNG dimensions from header ──
function extractPngDimensions(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(32);
    fs.readSync(fd, buf, 0, 32, 0);
    fs.closeSync(fd);
    if (buf[0] === 0x89 && buf[1] === 0x50) {
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      const meta = { width, height };
      // Screenshots are often specific sizes
      if ((width === 1920 || width === 2560 || width === 1440 || width === 3840) && height > 900) meta.likelyScreenshot = true;
      return meta;
    }
    return null;
  } catch (_) { return null; }
}

function humanSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024, sizes = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ─── IPC: Get subfolders ───────────────────────────────────────────
ipcMain.handle('get-subfolders', (_, destPath) => {
  try {
    if (!fs.existsSync(destPath)) return { success: true, folders: [] };
    const entries = fs.readdirSync(destPath, { withFileTypes: true });
    const folders = entries.filter(e => e.isDirectory() && e.name !== 'CleanUpLog').map(e => e.name);
    return { success: true, folders };
  } catch (err) { return { success: false, error: err.message }; }
});

// ─── IPC: Move file ────────────────────────────────────────────────
ipcMain.handle('move-file', (_, { src, dest }) => {
  try {
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    let finalDest = dest;
    if (fs.existsSync(dest)) {
      const ext = path.extname(dest), base = path.basename(dest, ext), dir = path.dirname(dest);
      let c = 1; while (fs.existsSync(finalDest)) { finalDest = path.join(dir, `${base} (${c})${ext}`); c++; }
    }
    try {
      fs.renameSync(src, finalDest);
    } catch (renameErr) {
      // Cross-device rename fails — fall back to copy + delete
      fs.copyFileSync(src, finalDest);
      fs.unlinkSync(src);
    }
    return { success: true, finalDest };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
ipcMain.handle('create-folder', (_, folderPath) => { try { if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true }); return { success: true }; } catch (err) { return { success: false, error: err.message }; } });
ipcMain.handle('copy-file', (_, { src, dest }) => {
  try {
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    let finalDest = dest;
    if (fs.existsSync(dest)) {
      const ext = path.extname(dest), base = path.basename(dest, ext), dir = path.dirname(dest);
      let c = 1; while (fs.existsSync(finalDest)) { finalDest = path.join(dir, `${base} (${c})${ext}`); c++; }
    }
    fs.copyFileSync(src, finalDest);
    return { success: true, finalDest };
  } catch (err) { return { success: false, error: err.message }; }
});
ipcMain.handle('delete-file', (_, filePath) => {
  try {
    if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); return { success: true }; }
    return { success: false, error: 'File not found' };
  } catch (err) { return { success: false, error: err.message }; }
});
ipcMain.handle('check-disk-space', async (_, targetPath) => {
  try {
    // Use OS-specific commands to check free space
    const { execSync } = require('child_process');
    if (process.platform === 'win32') {
      const drive = path.parse(targetPath).root.replace(/\\/g, ''); // e.g. "C:"
      const out = execSync(`wmic logicaldisk where "DeviceID='${drive}'" get FreeSpace /value`, { encoding: 'utf8' });
      const match = out.match(/FreeSpace=(\d+)/);
      return { success: true, freeBytes: match ? parseInt(match[1]) : 0 };
    } else {
      const out = execSync(`df -k "${targetPath}" | tail -1`, { encoding: 'utf8' });
      const parts = out.trim().split(/\s+/);
      const freeKB = parseInt(parts[3]) || 0;
      return { success: true, freeBytes: freeKB * 1024 };
    }
  } catch (err) { return { success: false, freeBytes: 0, error: err.message }; }
});
ipcMain.handle('open-folder', (_, folderPath) => { shell.openPath(folderPath); return true; });

// ─── IPC: Sweep Logs ──────────────────────────────────────────────
function getLogDir() {
  const d = path.join(app.getPath('userData'), 'logs'); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); return d;
}
ipcMain.handle('save-sweep-log', (_, { log }) => { try { const d = getLogDir(); const fn = `sweep-${new Date().toISOString().replace(/[:.]/g,'-')}.json`; fs.writeFileSync(path.join(d,fn), JSON.stringify(log,null,2)); return { success:true, filename:fn }; } catch(e) { return { success:false, error:e.message }; } });
ipcMain.handle('list-sweep-logs', () => { try { const d = getLogDir(); const files = fs.readdirSync(d).filter(f=>f.endsWith('.json')).sort().reverse(); return {success:true, logs: files.map(f=>{ try { return {filename:f,...JSON.parse(fs.readFileSync(path.join(d,f),'utf8'))}; } catch(_) { return {filename:f,error:true}; } })}; } catch(e) { return {success:false,error:e.message}; } });
ipcMain.handle('load-sweep-log', (_, { filename }) => { try { const d = getLogDir(); const fp = path.join(d,filename); if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp,'utf8')); return null; } catch(_) { return null; } });
ipcMain.handle('delete-sweep-log', (_, { filename }) => { try { const d = getLogDir(); const fp = path.join(d,filename); if (fs.existsSync(fp)) { fs.unlinkSync(fp); return true; } return false; } catch(_) { return false; } });
ipcMain.handle('undo-sweep', async (_, { moves, rootFolder }) => {
  const results = [];
  for (const move of moves) {
    try {
      if (fs.existsSync(move.dest)) {
        if (move.deletedFromSource) {
          // Source was deleted: copy back from dest to source, then delete dest copy
          const dir = path.dirname(move.src);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
          fs.copyFileSync(move.dest, move.src);
          fs.unlinkSync(move.dest);
          results.push({file:move.name,success:true});
        } else {
          // Source still exists (copy mode): just delete the dest copy
          fs.unlinkSync(move.dest);
          results.push({file:move.name,success:true});
        }
      } else results.push({file:move.name,success:false,error:'Not found'});
    } catch(e) { results.push({file:move.name,success:false,error:e.message}); }
  }
  return { results };
});

// ─── Lifecycle ─────────────────────────────────────────────────────
app.whenReady().then(() => { createWindow(); createTray(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { app.isQuitting = true; });
