const { net } = require('electron');
const path = require('path');
const fs = require('fs');
const app = require('electron').app || require('@electron/remote').app;

// Define a simple store implementation since electron-store now requires ESM
const userDataPath = app.getPath('userData');
const settingsPath = path.join(userDataPath, 'settings.json');

// Simple store API 
const store = {
  get: (key, defaultValue) => {
    try {
      if (!fs.existsSync(settingsPath)) {
        return defaultValue;
      }
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      return data[key] !== undefined ? data[key] : defaultValue;
    } catch (error) {
      console.error('Error reading settings:', error);
      return defaultValue;
    }
  },
  set: (key, value) => {
    try {
      const data = fs.existsSync(settingsPath) 
        ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) 
        : {};
      data[key] = value;
      fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      console.error('Error writing settings:', error);
    }
  }
};

class OllamaClient {
  constructor() {
    this.baseUrl = store.get('ollamaEndpoint', 'http://localhost:11434');
    this.model = store.get('ollamaModel', 'deepseek-r1:8b'); // Default to one of your available models
    
    // Get the prompt file from configuration - default to v3.txt
    this.promptFile = store.get('promptFile', 'v3.txt');
    
  }

  // Helper method to read prompt files
  readPromptFile(promptName) {
    try {
      const promptPath = path.join(__dirname, '..', 'prompts', promptName);
      if (fs.existsSync(promptPath)) {
        return fs.readFileSync(promptPath, 'utf8');
      }
      
      throw new Error(`Prompt file not found: ${promptName}`);
    } catch (error) {
      console.error(`Error reading prompt file ${promptName}:`, error);
      throw error;
    }
  }

  // Helper method to make HTTP requests to Ollama API
  async makeHttpRequest(endpoint, method, data = null) {
    const url = `${this.baseUrl}${endpoint}`;
    const request = net.request({
      method: method,
      url: url,
    });
    
    return new Promise((resolve, reject) => {
      let responseData = '';
      
      request.on('response', (response) => {
        if (response.statusCode !== 200) {
          return reject(new Error(`Ollama returned status ${response.statusCode}`));
        }
        
        response.on('data', (chunk) => {
          responseData += chunk.toString();
        });
        
        response.on('end', () => {
          try {
            if (!responseData.trim()) {
              console.error('Empty response from Ollama');
              return reject(new Error('Empty response from Ollama'));
            }
            
            if (!responseData.trim().startsWith('{')) {
              console.error('Non-JSON response:', responseData.substring(0, 100));
              return reject(new Error('Invalid response format from Ollama'));
            }
            
            resolve(JSON.parse(responseData));
          } catch (e) {
            console.error('Parse error:', e, 'Data:', responseData.substring(0, 100));
            reject(new Error(`Failed to parse Ollama response: ${e.message}`));
          }
        });
      });
      
      request.on('error', (error) => {
        reject(new Error(`Ollama request failed: ${error.message}`));
      });
      
      if (data) {
        request.write(JSON.stringify(data));
      }
      
      request.end();
    });
  }

  // Helper method to make text generation requests to Ollama
  async makeOllamaRequest(prompt) {
    try {
      const result = await this.makeHttpRequest('/api/generate', 'POST', {
        model: this.model,
        prompt: prompt,
        stream: false
      });
      
      return result.response;
    } catch (error) {
      throw error;
    }
  }

  async generateReport(notes) {
    try {
      // Read the prompt template from the specified prompt file - will throw error if not found
      const promptTemplate = this.readPromptFile(this.promptFile);
      
      // Replace the {{notes}} placeholder with the actual notes
      const prompt = promptTemplate.replace('{{notes}}', notes);

      return await this.makeOllamaRequest(prompt);
    } catch (error) {
      console.error('Error generating report:', error);
      throw error;
    }
  }

  async generateClarificationQuestions(notes, generatedReport = "") {
    try {
      // Read the clarification questions prompt template - will throw error if not found
      const promptTemplate = this.readPromptFile('clarification-questions.txt');

      const prompt = `
${promptTemplate}

ORIGINAL CLINICAL NOTES:
${notes}

${generatedReport ? `GENERATED REPORT:
${generatedReport}` : ""}

Provide 2-4 clarification questions that would help improve this report:
`;

      const response = await this.makeOllamaRequest(prompt);
      
      // Instead of parsing the response here, return the full text
      // The renderer will handle extracting thinking tags and parsing questions
      return response;
    } catch (error) {
      console.error('Error generating clarification questions:', error);
      throw error;
    }
  }

  async generateReportWithClarifications(notes, clarifications) {
    try {
      // Read the main prompt template (same one used for the initial report)
      const mainPromptTemplate = this.readPromptFile(this.promptFile);

      // Replace the {{notes}} placeholder in the main prompt
      const mainPrompt = mainPromptTemplate.replace('{{notes}}', notes);
      
      // Read the clarification report prompt template
      const clarificationTemplate = this.readPromptFile('clarification-report.txt');
      
      // Replace placeholders in the clarification template
      const prompt = clarificationTemplate
        .replace('{{main_prompt}}', mainPrompt)
        .replace('{{clarifications}}', Array.isArray(clarifications) ? clarifications.join('\n') : clarifications);

      const response = await this.makeOllamaRequest(prompt);
      return response;
    } catch (error) {
      console.error('Error generating report with clarifications:', error);
      throw error;
    }
  }

  async generateConversationalResponse(contextPrompt) {
    try {
      return await this.makeOllamaRequest(contextPrompt);
    } catch (error) {
      console.error('Error generating conversational response:', error);
      throw error;
    }
  }

  async checkConnection() {
    try {
      console.log('Attempting ollama connection to:', this.baseUrl);
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.log('Ollama connection timeout');
          resolve(false);
        }, 5000); // 5s timeout
        
        this.makeHttpRequest('/api/tags', 'GET')
          .then(data => {
            clearTimeout(timeout);
            console.log('Ollama models found:', data.models?.length || 0);
            resolve(true);
          })
          .catch(error => {
            clearTimeout(timeout);
            console.error('Ollama connection error:', error.message);
            resolve(false); // fail gracefully
          });
      });
    } catch (error) {
      console.error('Unexpected error in checkConnection:', error);
      return false;
    }
  }

  async getSystemInfo() {
    try {
      const os = require('os');
      const cpuInfo = os.cpus()[0];
      const cpuModel = cpuInfo.model;
      const isAppleSilicon = cpuModel.includes('Apple');
      const totalRam = Math.round(os.totalmem() / (1024 * 1024 * 1024)); // GB
      
      return {
        cpu: {
          model: cpuModel,
          cores: os.cpus().length,
          isAppleSilicon
        },
        memory: {
          total: totalRam,
          free: Math.round(os.freemem() / (1024 * 1024 * 1024))  // GB
        },
        platform: os.platform(),
        arch: os.arch()
      };
    } catch (error) {
      console.error('Error getting system info:', error);
      return null;
    }
  }
  
  // Model size definitions
  get modelSizeDefinitions() {
    return {
      // Special model families
      specialCases: {
        'llama3.2': 3,
        'llama3:2': 3,
        'llama3.1': 8,
        'llama3:1': 8
      },
      // Specific models with known sizes
      specificModels: {
        'phi3': 3,
        'gemma': 2,
        'gemma:2b': 2,
        'gemma:7b': 7,
        'phi': 2,
        'phi-2': 2,
        'vicuna': 7,
        'zephyr': 7,
        'deepseek': 8,
        'mixtral': 47
      },
      // Default sizes for model families
      modelFamilies: {
        'llama2': 7,
        'llama3': 8,
        'mistral': 7,
        'codellama': 7,
        'wizardcoder': 13
      },
      // Default size if nothing else matches
      defaultSize: 7
    };
  }
  
  estimateModelParameters(modelName) {
    console.log(`Estimating parameters for model: ${modelName}`);
    
    let modelSizeInB = null;
    const lowerModelName = modelName.toLowerCase();
    const modelSizes = this.modelSizeDefinitions;
    
    // Special case handling for llama3.2 70b
    if ((lowerModelName.includes('llama3.2') || lowerModelName.includes('llama3:2')) && 
        lowerModelName.includes('70b')) {
      return 70;
    }
    
    // Check special cases first
    for (const [specialCase, size] of Object.entries(modelSizes.specialCases)) {
      if (lowerModelName.includes(specialCase.toLowerCase())) {
        console.log(`Matched special case ${specialCase}: ${size}B`);
        return size;
      }
    }
    
    // Try to extract explicit parameter count - IMPROVED to handle decimal sizes
    const sizeMatch = lowerModelName.match(/[:-](\d+(?:\.\d+)?)b/i);
    if (sizeMatch && sizeMatch[1]) {
      modelSizeInB = parseFloat(sizeMatch[1]);
      console.log(`Extracted parameter count from name: ${modelSizeInB}B`);
      return modelSizeInB;
    }
    
    // Check specific models
    for (const [model, size] of Object.entries(modelSizes.specificModels)) {
      if (lowerModelName.includes(model.toLowerCase())) {
        console.log(`Matched specific model ${model}: ${size}B`);
        return size;
      }
    }
    
    // Handle specific deepseek variants that don't follow standard pattern
    if (lowerModelName.includes('deepseek') && lowerModelName.includes('1.5')) {
      console.log('Matched deepseek 1.5B variant');
      return 1.5;
    }
    
    // Check model families
    for (const [family, size] of Object.entries(modelSizes.modelFamilies)) {
      if (lowerModelName.includes(family.toLowerCase())) {
        console.log(`Matched model family ${family}: ${size}B`);
        return size;
      }
    }
    
    // Default if we couldn't identify
    console.log(`Could not identify model size, defaulting to ${modelSizes.defaultSize}B`);
    return modelSizes.defaultSize;
  }
  
  evaluateModelCompatibility(modelName, systemInfo) {
    // get model size
    const modelSizeInB = this.estimateModelParameters(modelName);
    
    // hardware specs
    const ram = systemInfo.memory.total;
    const isAppleSilicon = systemInfo.cpu.isAppleSilicon;
    const architecture = isAppleSilicon ? 'appleSilicon' : 'other';
    
    // define compatibility matrix as flat lookup table
    // format: [architecture, minRam, maxRam, minSize, maxSize, comfortLevel]
    const compatibilityRules = [
      // Apple Silicon compatibility
      ['appleSilicon', 0, 8, 0, 7, 'Easy'],
      ['appleSilicon', 0, 8, 7, 13, 'Difficult'],
      ['appleSilicon', 8, 16, 0, 13, 'Easy'],
      ['appleSilicon', 8, 16, 13, 33, 'Difficult'],
      ['appleSilicon', 16, 32, 0, 33, 'Easy'],
      ['appleSilicon', 16, 32, 33, 70, 'Difficult'],
      ['appleSilicon', 32, Infinity, 0, 70, 'Easy'],
      ['appleSilicon', 32, Infinity, 70, 100, 'Difficult'],
      
      // Other architectures
      ['other', 0, 8, 0, 3, 'Easy'],
      ['other', 0, 8, 3, 7, 'Difficult'],
      ['other', 8, 16, 0, 7, 'Easy'],
      ['other', 8, 16, 7, 13, 'Difficult'],
      ['other', 16, 32, 0, 13, 'Easy'],
      ['other', 16, 32, 13, 33, 'Difficult'],
      ['other', 32, Infinity, 0, 33, 'Easy'],
      ['other', 32, Infinity, 33, 70, 'Difficult']
    ];
    
    // find matching rule
    const matchingRule = compatibilityRules.find(rule => {
      const [arch, minRam, maxRam, minSize, maxSize] = rule;
      return arch === architecture && 
             ram >= minRam && ram < maxRam && 
             modelSizeInB >= minSize && modelSizeInB <= maxSize;
    }) || [architecture, 0, 0, 0, 0, 'Impossible'];
    
    // extract comfort level
    const comfortLevel = matchingRule[5];
    
    // message templates based on comfort level
    const messages = {
      'Easy': {
        message: 'should run well',
        loadingMessage: null
      },
      'Difficult': {
        message: 'should run slowly',
        loadingMessage: 'This could take a few minutes.<br>Plenty of time for tea.'
      },
      'Impossible': {
        message: 'not enough RAM',
        loadingMessage: 'This probably will not run.<br>Suggest closing this program.'
      }
    };
    
    // log for debugging
    console.log(`Model ${modelName} (${modelSizeInB}B) on ${architecture} with ${ram}GB RAM: ${comfortLevel}`);
    
    return {
      modelSizeInB,
      comfortLevel,
      message: messages[comfortLevel].message,
      loadingMessage: messages[comfortLevel].loadingMessage
    };
  }

  async getAvailableModels() {
    try {
      const data = await this.makeHttpRequest('/api/tags', 'GET');
      const models = data.models || [];
      return models.map(model => model.name);
    } catch (error) {
      console.error('Error getting models:', error);
      throw error;
    }
  }

  setModel(model) {
    this.model = model;
    store.set('ollamaModel', model);
  }
  
  setEndpoint(endpoint) {
    this.baseUrl = endpoint;
    store.set('ollamaEndpoint', endpoint);
  }
  
  setPromptFile(promptFile) {
    this.promptFile = promptFile;
    store.set('promptFile', promptFile);
  }
  
  getPromptFile() {
    return this.promptFile;
  }
}

module.exports = new OllamaClient();
