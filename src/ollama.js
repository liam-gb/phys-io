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
  }

  async generateReport(notes) {
    try {
      const prompt = `
You are a physiotherapy assistant helping to convert clinical notes into a professional report.
Convert the following clinical notes into a well-structured physiotherapy report:

${notes}

The report should include:
1. Patient information (extract from notes)
2. Assessment summary
3. Treatment provided
4. Recommendations
5. Follow-up plan

IMPORTANT: Respond ONLY with the final report text. Do not include any explanations, your reasoning process, or any text outside the report itself.
`;

      const request = net.request({
        method: 'POST',
        url: `${this.baseUrl}/api/generate`,
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
              resolve(parsed.response);
            } catch (e) {
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
    } catch (error) {
      console.error('Error generating report:', error);
      throw error;
    }
  }

  async generateConversationalResponse(contextPrompt) {
    try {
      const request = net.request({
        method: 'POST',
        url: `${this.baseUrl}/api/generate`,
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
              resolve(parsed.response);
            } catch (e) {
              reject(new Error(`Failed to parse Ollama response: ${e.message}`));
            }
          });
        });
        
        request.on('error', (error) => {
          reject(new Error(`Ollama request failed: ${error.message}`));
        });
        
        const requestData = JSON.stringify({
          model: this.model,
          prompt: contextPrompt,
          stream: false
        });
        
        request.write(requestData);
        request.end();
      });
    } catch (error) {
      console.error('Error generating conversational response:', error);
      throw error;
    }
  }

  async checkConnection() {
    try {
      const request = net.request({
        method: 'GET',
        url: `${this.baseUrl}/api/tags`,
      });
      
      return new Promise((resolve, reject) => {
        request.on('response', (response) => {
          let data = '';
          response.on('data', (chunk) => {
            data += chunk;
          });
          
          response.on('end', () => {
            if (response.statusCode === 200) {
              resolve(true);
            } else {
              reject(new Error(`Ollama returned status code ${response.statusCode}`));
            }
          });
        });
        
        request.on('error', () => {
          resolve(false); // Quietly fail - Ollama is likely not running
        });
        
        request.end();
      });
    } catch (error) {
      return false;
    }
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
}

module.exports = new OllamaClient();
