const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const ollamaClient = require('./src/ollama');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  
  // Only open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

// Initialize the app
app.whenReady().then(async () => {
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

// IPC Handlers
ipcMain.handle('generate-report', async (event, notes) => {
  try {
    return await ollamaClient.generateReport(notes);
  } catch (error) {
    dialog.showErrorBox('Error', `Failed to generate report: ${error.message}`);
    return null;
  }
});

ipcMain.handle('generate-clarification-questions', async (event, notes) => {
  try {
    return await ollamaClient.generateClarificationQuestions(notes);
  } catch (error) {
    console.error('Failed to generate clarification questions:', error);
    return [];
  }
});

ipcMain.handle('generate-report-with-clarifications', async (event, notes, clarifications) => {
  try {
    return await ollamaClient.generateReportWithClarifications(notes, clarifications);
  } catch (error) {
    dialog.showErrorBox('Error', `Failed to generate report: ${error.message}`);
    return null;
  }
});

ipcMain.handle('generate-conversational-response', async (event, contextPrompt) => {
  try {
    return await ollamaClient.generateConversationalResponse(contextPrompt);
  } catch (error) {
    dialog.showErrorBox('Error', `Failed to generate response: ${error.message}`);
    return null;
  }
});

ipcMain.handle('check-ollama-connection', async () => {
  try {
    return await ollamaClient.checkConnection();
  } catch (error) {
    console.error('Failed to check Ollama connection:', error);
    return false;
  }
});

ipcMain.handle('get-ollama-models', async () => {
  try {
    return await ollamaClient.getAvailableModels();
  } catch (error) {
    console.error('Failed to get Ollama models:', error);
    return [];
  }
});

ipcMain.handle('set-ollama-model', async (event, model) => {
  ollamaClient.setModel(model);
  return true;
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
