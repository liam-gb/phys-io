process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ollamaClient = require('./src/ollama');

let mainWindow;
const sessionsDirectory = path.join(app.getPath('userData'), 'sessions');

// Ensure a directory exists
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

function ensureSessionsDirectory() {
  return ensureDirectoryExists(sessionsDirectory);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Phys.IO',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setTitle('Phys.IO');
  
  // Only open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

// Initialize the app
app.whenReady().then(async () => {
  ensureSessionsDirectory();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Error handler factory
function createIpcHandler(handlerFn, errorOptions = {}) {
  const { errorMessage, consoleOnly = false, fallbackValue = null } = errorOptions;
  
  return async (event, ...args) => {
    try {
      return await handlerFn(event, ...args);
    } catch (error) {
      console.error(`${errorMessage || 'Error in IPC handler'}:`, error);
      
      if (!consoleOnly) {
        dialog.showErrorBox('Error', `${errorMessage || 'An error occurred'}: ${error.message}`);
      }
      
      return fallbackValue;
    }
  };
}

// IPC Handlers - Ollama client functions
ipcMain.handle('generate-report', createIpcHandler(
  async (event, notes) => await ollamaClient.generateReport(notes),
  { errorMessage: 'Failed to generate report' }
));

ipcMain.handle('generate-clarification-questions', createIpcHandler(
  async (event, notes) => await ollamaClient.generateClarificationQuestions(notes),
  { errorMessage: 'Failed to generate clarification questions', consoleOnly: true, fallbackValue: [] }
));

ipcMain.handle('generate-report-with-clarifications', createIpcHandler(
  async (event, notes, clarifications) => await ollamaClient.generateReportWithClarifications(notes, clarifications),
  { errorMessage: 'Failed to generate report with clarifications' }
));

ipcMain.handle('generate-conversational-response', createIpcHandler(
  async (event, contextPrompt) => await ollamaClient.generateConversationalResponse(contextPrompt),
  { errorMessage: 'Failed to generate response' }
));

// IPC Handlers - Ollama connection and settings
ipcMain.handle('check-ollama-connection', createIpcHandler(
  async () => await ollamaClient.checkConnection(),
  { errorMessage: 'Failed to check Ollama connection', consoleOnly: true, fallbackValue: false }
));

ipcMain.handle('get-ollama-models', createIpcHandler(
  async () => await ollamaClient.getAvailableModels(),
  { errorMessage: 'Failed to get Ollama models', consoleOnly: true, fallbackValue: [] }
));

ipcMain.handle('set-ollama-model', createIpcHandler(
  async (event, model) => {
    ollamaClient.setModel(model);
    return true;
  },
  { errorMessage: 'Failed to set Ollama model', consoleOnly: true, fallbackValue: false }
));

ipcMain.handle('get-prompt-file', createIpcHandler(
  async () => ollamaClient.getPromptFile(),
  { errorMessage: 'Failed to get prompt file', consoleOnly: true, fallbackValue: 'v3.txt' }
));

ipcMain.handle('set-prompt-file', createIpcHandler(
  async (event, promptFile) => {
    ollamaClient.setPromptFile(promptFile);
    return true;
  },
  { errorMessage: 'Failed to set prompt file', consoleOnly: true, fallbackValue: false }
));

// IPC Handlers - System information
ipcMain.handle('get-system-info', createIpcHandler(
  async () => await ollamaClient.getSystemInfo(),
  { errorMessage: 'Failed to get system info', consoleOnly: true, fallbackValue: null }
));

ipcMain.handle('evaluate-model-compatibility', createIpcHandler(
  async (event, modelName) => {
    const systemInfo = await ollamaClient.getSystemInfo();
    return ollamaClient.evaluateModelCompatibility(modelName, systemInfo);
  },
  { 
    errorMessage: 'Failed to evaluate model compatibility',
    consoleOnly: true, 
    fallbackValue: {
      modelSizeInB: null,
      comfortLevel: 'Unknown',
      message: 'Could not determine compatibility.',
      loadingMessage: null
    }
  }
));

// Helper to generate a unique ID
function generateUniqueId() {
  return crypto.randomBytes(16).toString('hex');
}

// Session management utilities
function prepareSessionData(sessionData) {
  if (!sessionData.id) {
    sessionData.id = generateUniqueId();
  }
  
  if (!sessionData.savedAt) {
    sessionData.savedAt = new Date().toISOString();
  }
  
  return sessionData;
}

function getSessionFilePath(sessionId) {
  return path.join(sessionsDirectory, `${sessionId}.json`);
}

// Session management handlers
ipcMain.handle('save-session', createIpcHandler(
  async (event, sessionData) => {
    ensureSessionsDirectory();
    sessionData = prepareSessionData(sessionData);
    const filePath = getSessionFilePath(sessionData.id);
    
    fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2), 'utf8');
    return { success: true, id: sessionData.id };
  },
  { 
    errorMessage: 'Failed to save session', 
    consoleOnly: false, 
    fallbackValue: { success: false, error: 'Failed to save session' } 
  }
));

ipcMain.handle('load-sessions-list', createIpcHandler(
  async () => {
    ensureSessionsDirectory();
    
    const files = fs.readdirSync(sessionsDirectory)
      .filter(file => file.endsWith('.json'));
    
    const sessions = files.map(file => {
      try {
        const filePath = path.join(sessionsDirectory, file);
        const rawData = fs.readFileSync(filePath, 'utf8');
        const sessionData = JSON.parse(rawData);
        const id = path.basename(file, '.json');
        
        return {
          id,
          title: sessionData.title,
          patientName: sessionData.patientName,
          savedAt: sessionData.savedAt,
          messageCount: sessionData.messages?.length || 0
        };
      } catch (err) {
        console.error(`Error reading session file ${file}:`, err);
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.savedAt && b.savedAt) {
        return new Date(b.savedAt) - new Date(a.savedAt);
      }
      return 0;
    });
    
    return sessions;
  },
  { errorMessage: 'Failed to load sessions list', consoleOnly: true, fallbackValue: [] }
));

ipcMain.handle('load-session', createIpcHandler(
  async (event, sessionId) => {
    const filePath = getSessionFilePath(sessionId);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    const rawData = fs.readFileSync(filePath, 'utf8');
    const sessionData = JSON.parse(rawData);
    
    sessionData.id = sessionId;
    
    return sessionData;
  },
  { errorMessage: 'Failed to load session', consoleOnly: false, fallbackValue: null }
));

ipcMain.handle('delete-session', createIpcHandler(
  async (event, sessionId) => {
    const filePath = getSessionFilePath(sessionId);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  },
  { errorMessage: 'Failed to delete session', consoleOnly: true, fallbackValue: false }
));

ipcMain.handle('save-report', createIpcHandler(
  async (event, reportText, suggestedName) => {
    const defaultPath = suggestedName 
      ? path.join(app.getPath('documents'), suggestedName) 
      : path.join(app.getPath('documents'), 'physio-report.txt');
      
    const { filePath } = await dialog.showSaveDialog({
      defaultPath,
      filters: [
        { name: 'Text Files', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    
    if (filePath) {
      fs.writeFileSync(filePath, reportText);
      return true;
    }
    return false;
  },
  { errorMessage: 'Failed to save report', consoleOnly: false, fallbackValue: false }
));

ipcMain.handle('load-notes', createIpcHandler(
  async () => {
    const { filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Text Files', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    
    if (filePaths && filePaths.length > 0) {
      return fs.readFileSync(filePaths[0], 'utf8');
    }
    return null;
  },
  { errorMessage: 'Failed to load notes', consoleOnly: false, fallbackValue: null }
));

// File loading utility function
function loadContentFile(basePath, filename) {
  try {
    const filePath = path.join(__dirname, basePath, filename);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
    return null;
  } catch (error) {
    console.error(`Error loading file ${filename} from ${basePath}:`, error);
    return null;
  }
}

ipcMain.handle('load-doc-file', createIpcHandler(
  async (event, filename) => {
    const content = loadContentFile('docs', filename);
    if (content === null) {
      return `Error: Document file "${filename}" not found`;
    }
    return content;
  },
  { 
    errorMessage: 'Failed to load document file', 
    consoleOnly: true, 
    fallbackValue: 'Error: Could not load the requested document file' 
  }
));

ipcMain.handle('load-prompt-file', createIpcHandler(
  async (event, filename) => {
    const content = loadContentFile('prompts', filename);
    if (content === null) {
      console.warn(`Prompt file not found: ${filename}`);
    }
    return content;
  },
  { errorMessage: 'Failed to load prompt file', consoleOnly: true, fallbackValue: null }
));