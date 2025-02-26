const { net } = require('electron');
const path = require('path');
const fs = require('fs');
const app = require('electron').app || require('@electron/remote').app;

// Simple storage implementation
class SimpleStore {
  constructor() {
    this.storePath = path.join(app ? app.getPath('userData') : __dirname, 'settings.json');
    this.data = this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.storePath)) {
        return JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
    return {};
  }

  save() {
    try {
      fs.writeFileSync(this.storePath, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  }

  get(key, defaultValue) {
    return key in this.data ? this.data[key] : defaultValue;
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }
}

const store = new SimpleStore();

class OllamaClient {
  constructor() {
    this.baseUrl = store.get('ollamaEndpoint', 'http://localhost:11434');
    this.model = store.get('ollamaModel', 'deepseek-r1:8b'); // Default to one of your available models
    
    // Get the prompt file from configuration - default to v2.txt
    this.promptFile = store.get('promptFile', 'v2.txt');
    
  }

  // Helper method to read prompt files
  readPromptFile(promptName) {
    try {
      const promptPath = path.join(__dirname, '..', 'prompts', promptName);
      if (fs.existsSync(promptPath)) {
        return fs.readFileSync(promptPath, 'utf8');
      }
      return null;
    } catch (error) {
      console.error(`Error reading prompt file ${promptName}:`, error);
      return null;
    }
  }

  // Helper method to make API requests to Ollama
  async makeOllamaRequest(prompt) {
    const request = net.request({
      method: 'POST',
      url: `${this.baseUrl}/api/generate`,
    });
    
    return new Promise((resolve, reject) => {
      let responseData = '';
      
      request.on('response', (response) => {
        // add status code check
        if (response.statusCode !== 200) {
          return reject(new Error(`Ollama returned status ${response.statusCode}`));
        }
        
        response.on('data', (chunk) => {
          responseData += chunk.toString();
        });
        
        response.on('end', () => {
          try {
            // check if response looks like json
            if (!responseData.trim().startsWith('{')) {
              console.error('Non-JSON response:', responseData.substring(0, 100));
              return reject(new Error('Invalid response format from Ollama'));
            }
            
            const parsed = JSON.parse(responseData);
            resolve(parsed.response);
          } catch (e) {
            console.error('Parse error:', e, 'Data:', responseData.substring(0, 100));
            reject(new Error(`Failed to parse Ollama response: ${e.message}`));
          }
        });
      });
      
      request.on('error', (error) => {
        reject(new Error(`Ollama request failed: ${error.message}`));
      });
      
      const requestData = JSON.stringify({
        model: this.model,
        prompt: prompt,
        stream: false
      });
      
      request.write(requestData);
      request.end();
    });
  }

  async generateReport(notes) {
    try {
      // Read the prompt template from the specified prompt file
      let promptTemplate = this.readPromptFile(this.promptFile);
      
      // If prompt file doesn't exist or can't be read, use a default prompt
      if (!promptTemplate) {
        console.warn(`Warning: Could not load prompt file ${this.promptFile}, using default prompt`);
        promptTemplate = `
You are a physiotherapy assistant helping to convert clinical notes into a professional report.
Convert the following clinical notes into a well-structured physiotherapy report:

{{notes}}

The report should include:
1. Patient information (extract from notes)
2. Assessment summary
3. Treatment provided
4. Recommendations
5. Follow-up plan

IMPORTANT: Respond ONLY with the final report text. Do not include any explanations, your reasoning process, or any text outside the report itself.
`;
      }
      
      // Replace the {{notes}} placeholder with the actual notes
      const prompt = promptTemplate.replace('{{notes}}', notes);

      return await this.makeOllamaRequest(prompt);
    } catch (error) {
      console.error('Error generating report:', error);
      throw error;
    }
  }

  async generateClarificationQuestions(notes, generatedReport) {
    try {
      // Read the clarification questions prompt template
      let promptTemplate = this.readPromptFile('clarification-questions.txt');
      
      // If prompt file doesn't exist, use a default prompt
      if (!promptTemplate) {
        promptTemplate = `
You are a physiotherapy expert reviewing clinical notes and a generated report letter.
Compare the original notes with the generated report and identify 2-4 areas where:
- Information may be missing but would enhance the report
- Assumptions have been made that aren't clearly supported by the notes
- Statements are vague and could benefit from more specific details
- Important follow-up plans or treatment rationales could be expanded upon

Format your response as a numbered list of clear, concise questions.
`;
      }

      const prompt = `
${promptTemplate}

ORIGINAL CLINICAL NOTES:
${notes}

GENERATED REPORT:
${generatedReport}

Provide 2-4 clarification questions that would help improve this report:
`;

      const response = await this.makeOllamaRequest(prompt);
      
      // Extract numbered questions from the response
      const questionLines = response.split('\n')
        .filter(line => /^\d+\./.test(line.trim()))
        .map(line => line.trim());
      
      // If no questions were found in the expected format, return the whole response
      return questionLines.length > 0 ? questionLines : [response];
    } catch (error) {
      console.error('Error generating clarification questions:', error);
      throw error;
    }
  }

  async generateReportWithClarifications(notes, clarifications) {
    try {
      // Read the main prompt template (same one used for the initial report)
      let mainPromptTemplate = this.readPromptFile(this.promptFile);
      
      // If main prompt file doesn't exist or can't be read, use a default prompt
      if (!mainPromptTemplate) {
        console.warn(`Warning: Could not load main prompt file ${this.promptFile}, using default prompt`);
        mainPromptTemplate = `
You are a physiotherapy assistant helping to convert clinical notes into a professional report.
Convert the following clinical notes into a well-structured physiotherapy report:

{{notes}}

The report should include:
1. Patient information (extract from notes)
2. Assessment summary
3. Treatment provided
4. Recommendations
5. Follow-up plan

IMPORTANT: Respond ONLY with the final report text. Do not include any explanations, your reasoning process, or any text outside the report itself.
`;
      }

      // Replace the {{notes}} placeholder in the main prompt
      const mainPrompt = mainPromptTemplate.replace('{{notes}}', notes);
      
      // Read the clarification report prompt template
      let clarificationTemplate = this.readPromptFile('clarification-report.txt');
      
      // If clarification prompt file doesn't exist, use a default
      if (!clarificationTemplate) {
        console.warn('Warning: Could not load clarification-report.txt prompt file, using default');
        clarificationTemplate = `
# Clarification Enhancement

{{main_prompt}}

## Additional Clarification Information
The following represents clarifications provided by the physiotherapist:

{{clarifications}}

Based on both the original instructions above and these clarifications, please generate an improved physiotherapy report.
Ensure you incorporate the clarification information to make the report more accurate and comprehensive.

At the end of your report, include a section with the header <questions> that lists any remaining questions you have about the patient or treatment plan.
`;
      }
      
      // Replace placeholders in the clarification template
      let prompt = clarificationTemplate
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
      console.log('DEBUG: attempting ollama connection to:', this.baseUrl);
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.log('DEBUG: ollama connection timeout');
          resolve(false);
        }, 5000); // 5s timeout
        
        const request = net.request({
          method: 'GET',
          url: `${this.baseUrl}/api/tags`,
        });
        
        request.on('response', (response) => {
          clearTimeout(timeout);
          let data = '';
          response.on('data', (chunk) => {
            data += chunk;
          });
          
          response.on('end', () => {
            console.log('DEBUG: ollama response status:', response.statusCode);
            if (response.statusCode === 200) {
              try {
                const parsed = JSON.parse(data);
                console.log('DEBUG: ollama models found:', parsed.models?.length || 0);
                resolve(true);
              } catch (parseErr) {
                console.error('DEBUG: failed to parse ollama response:', parseErr);
                resolve(false);
              }
            } else {
              resolve(false);
            }
          });
        });
        
        request.on('error', (error) => {
          clearTimeout(timeout);
          console.error('DEBUG: ollama connection error:', error.message);
          resolve(false); // fail gracefully
        });
        
        request.end();
      });
    } catch (error) {
      console.error('DEBUG: unexpected error in checkConnection:', error);
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
  
  estimateModelParameters(modelName) {
    // Log the model name we're analyzing
    console.log(`Estimating parameters for model: ${modelName}`);
    
    // Extract model size from name (look for patterns like 7b, 13b, etc.)
    let modelSizeInB = null;
    const lowerModelName = modelName.toLowerCase();
    
    // Special handling for specific models
    if (lowerModelName.includes('llama3.2') || lowerModelName.includes('llama3:2')) {
      if (!lowerModelName.includes('70b')) {
        // All llama3.2 models except 70B are 3B models
        console.log('Detected llama3.2 3B model');
        return 3;
      }
    }
    
    if (lowerModelName.includes('llama3.1') || lowerModelName.includes('llama3:1')) {
      // Default llama3.1 is 8B
      console.log('Detected llama3.1 8B model');
      return 8;
    }
    
    // Try to extract explicit parameter count
    const sizeMatch = lowerModelName.match(/[:-](\d+)b/i);
    
    if (sizeMatch && sizeMatch[1]) {
      modelSizeInB = parseInt(sizeMatch[1]);
      console.log(`Extracted parameter count from name: ${modelSizeInB}B`);
    } else {
      // Known specific models and their parameter counts
      const specificModels = {
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
      };
      
      // Check for specific models with known sizes
      for (const [model, size] of Object.entries(specificModels)) {
        if (lowerModelName.includes(model.toLowerCase())) {
          modelSizeInB = size;
          console.log(`Matched specific model ${model}: ${modelSizeInB}B`);
          break;
        }
      }
      
      // If still not found, use model family defaults
      if (!modelSizeInB) {
        // Default sizes for models without explicit size in name
        const defaultSizes = {
          'llama2': 7,
          'llama3': 8,
          'mistral': 7,
          'codellama': 7,
          'wizardcoder': 13
        };
        
        // Try to match the model family
        for (const [family, size] of Object.entries(defaultSizes)) {
          if (lowerModelName.includes(family.toLowerCase())) {
            modelSizeInB = size;
            console.log(`Matched model family ${family}: ${modelSizeInB}B`);
            break;
          }
        }
      }
      
      // Default to 7B if we couldn't identify
      if (!modelSizeInB) {
        modelSizeInB = 7;
        console.log(`Could not identify model size, defaulting to ${modelSizeInB}B`);
      }
    }
    
    return modelSizeInB;
  }
  
  evaluateModelCompatibility(modelName, systemInfo) {
    // Get model size in billions of parameters
    const modelSizeInB = this.estimateModelParameters(modelName);
    
    // Get hardware info
    const ram = systemInfo.memory.total;
    const isAppleSilicon = systemInfo.cpu.isAppleSilicon;
    
    // Simple compatibility matrix
    // Format: [min_size, max_size]
    const compatMatrix = {
      // Apple Silicon machines
      appleSilicon: {
        // RAM ranges (in GB)
        8: {
          easy: [0, 7],          // 0-7B models run easily on 8GB RAM
          difficult: [7, 13],    // 7-13B models run with difficulty on 8GB RAM
          // anything larger is impossible
        },
        16: {
          easy: [0, 13],         // 0-13B models run easily on 16GB RAM
          difficult: [13, 33],   // 13-33B models run with difficulty on 16GB RAM
          // anything larger is impossible
        },
        32: {
          easy: [0, 33],         // 0-33B models run easily on 32GB RAM
          difficult: [33, 70],   // 33-70B models run with difficulty on 32GB RAM
          // anything larger is impossible
        },
        64: {
          easy: [0, 70],         // 0-70B models run easily on 64GB RAM
          difficult: [70, 100],  // 70-100B models run with difficulty on 64GB RAM
          // anything larger is impossible
        }
      },
      // Other processors (Intel, AMD, etc.)
      other: {
        // RAM ranges (in GB)
        8: {
          easy: [0, 3],          // 0-3B models run easily on 8GB RAM
          difficult: [3, 7],     // 3-7B models run with difficulty on 8GB RAM
          // anything larger is impossible
        },
        16: {
          easy: [0, 7],          // 0-7B models run easily on 16GB RAM
          difficult: [7, 13],    // 7-13B models run with difficulty on 16GB RAM
          // anything larger is impossible
        },
        32: {
          easy: [0, 13],         // 0-13B models run easily on 32GB RAM
          difficult: [13, 33],   // 13-33B models run with difficulty on 32GB RAM
          // anything larger is impossible
        },
        64: {
          easy: [0, 33],         // 0-33B models run easily on 64GB RAM
          difficult: [33, 70],   // 33-70B models run with difficulty on 64GB RAM
          // anything larger is impossible
        }
      }
    };
    
    // Determine architecture type
    const archType = isAppleSilicon ? 'appleSilicon' : 'other';
    
    // Find the right RAM category
    let ramCategory;
    if (ram <= 8) ramCategory = 8;
    else if (ram <= 16) ramCategory = 16;
    else if (ram <= 32) ramCategory = 32;
    else ramCategory = 64;
    
    // Default values
    let comfortLevel = 'Easy';
    let message = 'No sweat, your machine should run this just fine.';
    let loadingMessage = null;
    
    // Determine comfort level based on matrix
    const ranges = compatMatrix[archType][ramCategory];
    
    if (modelSizeInB >= ranges.easy[0] && modelSizeInB <= ranges.easy[1]) {
      comfortLevel = 'Easy';
      message = 'Will run well';
    } else if (modelSizeInB >= ranges.difficult[0] && modelSizeInB <= ranges.difficult[1]) {
      comfortLevel = 'Difficult';
      message = "Will run slowly";
      loadingMessage = 'This could take a few minutes. Plenty of time for tea.';
    } else {
      comfortLevel = 'Impossible';
      message = 'Not enough RAM';
    }
    
    // Debug output to help troubleshoot
    console.log(`Model compatibility for ${modelName}: Size=${modelSizeInB}B, RAM=${ram}GB, Arch=${archType}, Level=${comfortLevel}`);
    console.log(`Ranges - Easy: ${ranges.easy[0]}-${ranges.easy[1]}B, Difficult: ${ranges.difficult[0]}-${ranges.difficult[1]}B`);
    
    return {
      modelSizeInB,
      comfortLevel,
      message,
      loadingMessage
    };
  }

  async getAvailableModels() {
    try {
      const request = net.request({
        method: 'GET',
        url: `${this.baseUrl}/api/tags`,
      });
      
      return new Promise((resolve, reject) => {
        let responseData = '';
        
        request.on('response', (response) => {
          response.on('data', (chunk) => {
            responseData += chunk.toString();
          });
          
          response.on('end', () => {
            try {
              const parsed = JSON.parse(responseData);
              const models = parsed.models || [];
              resolve(models.map(model => model.name));
            } catch (e) {
              reject(new Error(`Failed to parse Ollama models: ${e.message}`));
            }
          });
        });
        
        request.on('error', (error) => {
          reject(new Error(`Failed to get models: ${error.message}`));
        });
        
        request.end();
      });
    } catch (error) {
      console.error('Error getting models:', error);
      return [];
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
