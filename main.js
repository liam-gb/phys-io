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

// Wrapper function for sessions directory
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

// Standard error handling for IPC handlers
function createErrorHandler(errorMessage, consoleOnly = false) {
  return (error) => {
    console.error(`${errorMessage}:`, error);
    
    if (!consoleOnly) {
      dialog.showErrorBox('Error', `${errorMessage}: ${error.message}`);
    }
    
    return consoleOnly ? (Array.isArray(error) ? [] : null) : null;
  };
}

// IPC Handlers - Ollama client functions
ipcMain.handle('generate-report', async (event, notes) => {
  try {
    return await ollamaClient.generateReport(notes);
  } catch (error) {
    return createErrorHandler('Failed to generate report')(error);
  }
});

ipcMain.handle('generate-clarification-questions', async (event, notes) => {
  try {
    return await ollamaClient.generateClarificationQuestions(notes);
  } catch (error) {
    return createErrorHandler('Failed to generate clarification questions', true)(error);
  }
});

ipcMain.handle('generate-report-with-clarifications', async (event, notes, clarifications) => {
  try {
    return await ollamaClient.generateReportWithClarifications(notes, clarifications);
  } catch (error) {
    return createErrorHandler('Failed to generate report with clarifications')(error);
  }
});

ipcMain.handle('generate-conversational-response', async (event, contextPrompt) => {
  try {
    return await ollamaClient.generateConversationalResponse(contextPrompt);
  } catch (error) {
    return createErrorHandler('Failed to generate response')(error);
  }
});

// IPC Handlers - Ollama connection and settings
ipcMain.handle('check-ollama-connection', async () => {
  try {
    return await ollamaClient.checkConnection();
  } catch (error) {
    return createErrorHandler('Failed to check Ollama connection', true)(error);
  }
});

ipcMain.handle('get-ollama-models', async () => {
  try {
    return await ollamaClient.getAvailableModels();
  } catch (error) {
    return createErrorHandler('Failed to get Ollama models', true)(error);
  }
});

ipcMain.handle('set-ollama-model', async (event, model) => {
  ollamaClient.setModel(model);
  return true;
});

ipcMain.handle('get-prompt-file', async () => {
  return ollamaClient.getPromptFile();
});

ipcMain.handle('set-prompt-file', async (event, promptFile) => {
  ollamaClient.setPromptFile(promptFile);
  return true;
});

// IPC Handlers - System information
ipcMain.handle('get-system-info', async () => {
  try {
    return await ollamaClient.getSystemInfo();
  } catch (error) {
    return createErrorHandler('Failed to get system info', true)(error);
  }
});

ipcMain.handle('evaluate-model-compatibility', async (event, modelName) => {
  try {
    const systemInfo = await ollamaClient.getSystemInfo();
    return ollamaClient.evaluateModelCompatibility(modelName, systemInfo);
  } catch (error) {
    console.error('Failed to evaluate model compatibility:', error);
    return {
      modelSizeInB: null,
      comfortLevel: 'Unknown',
      message: 'Could not determine compatibility.',
      loadingMessage: null
    };
  }
});

// Helper to generate a unique ID
function generateUniqueId() {
  return crypto.randomBytes(16).toString('hex');
}

// Session management utilities
function prepareSessionData(sessionData) {
  // If no ID exists, create one
  if (!sessionData.id) {
    sessionData.id = generateUniqueId();
  }
  
  // Add timestamp if not provided
  if (!sessionData.savedAt) {
    sessionData.savedAt = new Date().toISOString();
  }
  
  return sessionData;
}

function getSessionFilePath(sessionId) {
  return path.join(sessionsDirectory, `${sessionId}.json`);
}

// Session management handlers
ipcMain.handle('save-session', async (event, sessionData) => {
  try {
    ensureSessionsDirectory();
    sessionData = prepareSessionData(sessionData);
    const filePath = getSessionFilePath(sessionData.id);
    
    fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2), 'utf8');
    return { success: true, id: sessionData.id };
  } catch (error) {
    console.error('Failed to save session:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-sessions-list', async () => {
  try {
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
      // Sort by saved date (newest first)
      if (a.savedAt && b.savedAt) {
        return new Date(b.savedAt) - new Date(a.savedAt);
      }
      return 0;
    });
    
    return sessions;
  } catch (error) {
    console.error('Failed to load sessions list:', error);
    return [];
  }
});

ipcMain.handle('load-session', async (event, sessionId) => {
  try {
    const filePath = getSessionFilePath(sessionId);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    const rawData = fs.readFileSync(filePath, 'utf8');
    const sessionData = JSON.parse(rawData);
    
    // Ensure the ID matches the filename
    sessionData.id = sessionId;
    
    return sessionData;
  } catch (error) {
    console.error('Failed to load session:', error);
    return null;
  }
});

ipcMain.handle('delete-session', async (event, sessionId) => {
  try {
    const filePath = getSessionFilePath(sessionId);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Failed to delete session:', error);
    return false;
  }
});

ipcMain.handle('save-report', async (event, reportText, suggestedName) => {
  try {
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
  } catch (error) {
    dialog.showErrorBox('Error', `Failed to save report: ${error.message}`);
    return false;
  }
});

ipcMain.handle('load-notes', async () => {
  try {
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
  } catch (error) {
    dialog.showErrorBox('Error', `Failed to load notes: ${error.message}`);
    return null;
  }
});

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

ipcMain.handle('load-doc-file', async (event, filename) => {
  const content = loadContentFile('docs', filename);
  if (content === null) {
    return `Error: Document file "${filename}" not found`;
  }
  return content;
});

ipcMain.handle('load-prompt-file', async (event, filename) => {
  const content = loadContentFile('prompts', filename);
  if (content === null) {
    console.warn(`Prompt file not found: ${filename}`);
  }
  return content;
});