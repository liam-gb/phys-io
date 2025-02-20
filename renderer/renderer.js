// DOM Elements
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const modelSelect = document.getElementById('model-select');
const notesInput = document.getElementById('notes-input');
const reportOutput = document.getElementById('report-output');
const generateBtn = document.getElementById('generate-btn');
const clearNotesBtn = document.getElementById('clear-notes-btn');
const copyBtn = document.getElementById('copy-btn');
const saveBtn = document.getElementById('save-btn');
const loadNotesBtn = document.getElementById('load-notes-btn');
const nodeVersionElement = document.getElementById('node-version');
const electronVersionElement = document.getElementById('electron-version');

// Store current model selection and conversation context
let currentModelSelection = '';
let conversationContext = {
  initialNotes: '',
  conversation: []
};

// Display versions
nodeVersionElement.textContent = window.api.versions.node();
electronVersionElement.textContent = window.api.versions.electron();

// Check Ollama connection on startup
async function checkOllamaConnection() {
  try {
    const isConnected = await window.api.ollama.checkConnection();
    if (isConnected) {
      statusDot.classList.add('connected');
      statusDot.classList.remove('disconnected');
      statusText.textContent = 'Ollama Connected';
      generateBtn.disabled = false;
      
      // Load available models
      await loadModels();
    } else {
      setDisconnectedState();
    }
  } catch (error) {
    setDisconnectedState();
  }
}

function setDisconnectedState() {
  statusDot.classList.add('disconnected');
  statusDot.classList.remove('connected');
  statusText.textContent = 'Ollama Disconnected - Start Ollama first';
  generateBtn.disabled = true;
  modelSelect.disabled = true;
}

// Load available models from Ollama
async function loadModels() {
  try {
    const models = await window.api.ollama.getModels();
    
    // Save current selection if it exists
    const currentSelection = modelSelect.value;
    
    // Clear existing options
    modelSelect.innerHTML = '';
    
    if (models.length === 0) {
      const option = document.createElement('option');
      option.value = 'deepseek-r1:8b';
      option.textContent = 'DeepSeek 8B (default)';
      modelSelect.appendChild(option);
      
      // Set current model
      currentModelSelection = 'deepseek-r1:8b';
    } else {
      models.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        modelSelect.appendChild(option);
      });
      
      // Restore selection or use first model
      if (currentSelection && models.includes(currentSelection)) {
        modelSelect.value = currentSelection;
        currentModelSelection = currentSelection;
      } else {
        currentModelSelection = models[0];
        modelSelect.value = models[0];
      }
    }
    
    modelSelect.disabled = false;
  } catch (error) {
    console.error('Failed to load models:', error);
    
    // Set a default option
    modelSelect.innerHTML = '';
    const option = document.createElement('option');
    option.value = 'deepseek-r1:8b';
    option.textContent = 'DeepSeek 8B (default)';
    modelSelect.appendChild(option);
    
    currentModelSelection = 'deepseek-r1:8b';
    modelSelect.disabled = false;
  }
}

// Start the initial report generation
async function generateInitialReport() {
  const notes = notesInput.value.trim();
  
  if (!notes) {
    alert('Please enter some clinical notes first.');
    return;
  }
  
  // Store the initial notes
  conversationContext.initialNotes = notes;
  conversationContext.conversation = [];
  
  // Update UI to show loading state
  generateBtn.disabled = true;
  generateBtn.textContent = 'Generating...';
  reportOutput.innerHTML = '<p class="loading">Generating initial report, please wait...</p>';
  
  try {
    const report = await window.api.ollama.generateReport(notes);
    
    if (report) {
      // Add to conversation context
      conversationContext.conversation.push({
        role: 'assistant',
        content: report
      });
      
      // Show the report with feedback input
      displayConversation();
      
      // Enable copy and save buttons
      copyBtn.disabled = false;
      saveBtn.disabled = false;
      
    } else {
      reportOutput.innerHTML = '<p class="error">Failed to generate report. Please check if Ollama is running.</p>';
      generateBtn.textContent = 'Generate Report';
      generateBtn.disabled = false;
    }
  } catch (error) {
    reportOutput.innerHTML = `<p class="error">Error: ${error.message}</p>`;
    generateBtn.textContent = 'Generate Report';
    generateBtn.disabled = false;
  }
}

// Display the current conversation in the output area
function displayConversation() {
  let outputHtml = '';
  
  // Display the last assistant message (the report)
  const lastMessage = conversationContext.conversation[conversationContext.conversation.length - 1];
  if (lastMessage && lastMessage.role === 'assistant') {
    outputHtml = formatReport(lastMessage.content);
  }
  
  // Add feedback input at the bottom if we have at least one message
  if (conversationContext.conversation.length > 0) {
    outputHtml += `
      <div class="feedback-container">
        <h3>Provide Feedback</h3>
        <p>Let us know how you'd like to improve this report:</p>
        <textarea id="feedback-input" class="feedback-textarea" placeholder="Enter your feedback here..."></textarea>
        <div class="feedback-actions">
          <button id="send-feedback-btn" class="primary-button">Send Feedback</button>
        </div>
      </div>
    `;
  }
  
  reportOutput.innerHTML = outputHtml;
  
  // Add event listener to the feedback button
  const sendFeedbackBtn = document.getElementById('send-feedback-btn');
  if (sendFeedbackBtn) {
    sendFeedbackBtn.addEventListener('click', submitFeedback);
  }
}

// Submit feedback and get updated report
async function submitFeedback() {
  const feedbackInput = document.getElementById('feedback-input');
  const feedbackText = feedbackInput.value.trim();
  
  if (!feedbackText) {
    alert('Please provide some feedback before sending.');
    return;
  }
  
  // Add user feedback to conversation
  conversationContext.conversation.push({
    role: 'user',
    content: feedbackText
  });
  
  // Update UI to show loading state
  reportOutput.innerHTML = '<p class="loading">Updating report based on your feedback, please wait...</p>';
  
  try {
    // Build the full context for the model
    const fullContext = buildConversationPrompt();
    
    // Get updated report
    const updatedReport = await window.api.ollama.generateConversationalResponse(fullContext);
    
    if (updatedReport) {
      // Add to conversation
      conversationContext.conversation.push({
        role: 'assistant',
        content: updatedReport
      });
      
      // Update display
      displayConversation();
    } else {
      reportOutput.innerHTML = '<p class="error">Failed to update the report. Please try again.</p>';
    }
  } catch (error) {
    reportOutput.innerHTML = `<p class="error">Error: ${error.message}</p>`;
  }
}

// Build a full conversation prompt for the model
function buildConversationPrompt() {
  let prompt = `
You are a physiotherapy assistant helping to convert clinical notes into a professional report.
Your task is to create or update a physiotherapy report based on the following information.

Original clinical notes:
${conversationContext.initialNotes}

The report should include:
1. Patient information (extract from notes)
2. Assessment summary
3. Treatment provided
4. Recommendations
5. Follow-up plan

Conversation history:
`;

  // Add the conversation history
  conversationContext.conversation.forEach(message => {
    prompt += `\n${message.role.toUpperCase()}: ${message.content}\n`;
  });
  
  // Add final instruction to only output the report
  prompt += `
Based on the above conversation and feedback, please provide an updated physiotherapy report.
IMPORTANT: Respond ONLY with the final report text. Do not include any explanations, your reasoning process, or any text outside the report itself.
`;

  return prompt;
}

// Format the report text with HTML
function formatReport(reportText) {
  // Split by lines and process
  const lines = reportText.split('\n');
  let formattedHtml = '';
  let inList = false;
  
  for (const line of lines) {
    // Handle headers
    if (line.startsWith('# ')) {
      formattedHtml += `<h2>${line.substring(2)}</h2>`;
    } else if (line.startsWith('## ')) {
      formattedHtml += `<h3>${line.substring(3)}</h3>`;
    } else if (line.startsWith('### ')) {
      formattedHtml += `<h4>${line.substring(4)}</h4>`;
    }
    // Handle list items
    else if (line.match(/^\d+\.\s/)) {
      if (!inList) {
        formattedHtml += '<ol>';
        inList = true;
      }
      formattedHtml += `<li>${line.replace(/^\d+\.\s/, '')}</li>`;
    } else if (line.startsWith('- ')) {
      if (!inList) {
        formattedHtml += '<ul>';
        inList = true;
      }
      formattedHtml += `<li>${line.substring(2)}</li>`;
    }
    // Close list if needed
    else if (inList && line.trim() === '') {
      formattedHtml += inList ? '</ol></ul>'.substring(inList === 'ol' ? 0 : 4) : '';
      inList = false;
      formattedHtml += '<p></p>';
    }
    // Regular paragraph
    else {
      if (inList && line.trim() !== '') {
        formattedHtml += inList ? '</ol></ul>'.substring(inList === 'ol' ? 0 : 4) : '';
        inList = false;
      }
      
      if (line.trim() !== '') {
        formattedHtml += `<p>${line}</p>`;
      } else if (formattedHtml.slice(-3) !== '<p>') {
        formattedHtml += '<p></p>';
      }
    }
  }
  
  return formattedHtml;
}

// Clear notes input
function clearNotes() {
  notesInput.value = '';
  notesInput.focus();
  
  // Reset conversation context
  conversationContext = {
    initialNotes: '',
    conversation: []
  };
  
  // Clear output
  reportOutput.innerHTML = '';
  
  // Reset generate button
  generateBtn.textContent = 'Generate Report';
  generateBtn.onclick = generateInitialReport;
  
  // Disable action buttons
  copyBtn.disabled = true;
  saveBtn.disabled = true;
}

// Copy report to clipboard
async function copyToClipboard() {
  // Get the report text (skip the feedback UI)
  const reportElements = reportOutput.querySelectorAll('p:not(.feedback-container p), h2, h3, h4, li');
  const reportText = Array.from(reportElements).map(el => el.textContent).join('\n');
  
  try {
    await navigator.clipboard.writeText(reportText);
    
    // Visual feedback
    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.textContent = originalText;
    }, 2000);
  } catch (error) {
    alert('Failed to copy to clipboard: ' + error.message);
  }
}

// Save report to file
async function saveReport() {
  // Get the report text (skip the feedback UI)
  const reportElements = reportOutput.querySelectorAll('p:not(.feedback-container p), h2, h3, h4, li');
  const reportText = Array.from(reportElements).map(el => el.textContent).join('\n');
  
  if (!reportText) {
    alert('No report to save.');
    return;
  }
  
  // Extract patient name for filename suggestion
  let suggestedName = 'physiotherapy-report.txt';
  const patientMatch = reportText.match(/Patient:?\s*([A-Za-z\s]+)/i);
  if (patientMatch && patientMatch[1]) {
    const patientName = patientMatch[1].trim();
    if (patientName) {
      suggestedName = `${patientName.replace(/\s+/g, '_')}_physio_report.txt`;
    }
  }
  
  try {
    const success = await window.api.files.saveReport(reportText, suggestedName);
    if (success) {
      alert('Report saved successfully!');
    }
  } catch (error) {
    alert('Failed to save report: ' + error.message);
  }
}

// Load notes from file
async function loadNotes() {
  try {
    const notes = await window.api.files.loadNotes();
    if (notes) {
      notesInput.value = notes;
      
      // Reset conversation context
      conversationContext = {
        initialNotes: '',
        conversation: []
      };
      
      // Clear output
      reportOutput.innerHTML = '';
      
      // Reset generate button
      generateBtn.textContent = 'Generate Report';
      generateBtn.onclick = generateInitialReport;
      
      // Disable action buttons
      copyBtn.disabled = true;
      saveBtn.disabled = true;
    }
  } catch (error) {
    alert('Failed to load notes: ' + error.message);
  }
}

// Model selection change
function onModelChange() {
  const selectedModel = modelSelect.value;
  if (selectedModel) {
    currentModelSelection = selectedModel;
    window.api.ollama.setModel(selectedModel);
  }
}

// Event listeners
document.addEventListener('DOMContentLoaded', checkOllamaConnection);
generateBtn.addEventListener('click', generateInitialReport);
clearNotesBtn.addEventListener('click', clearNotes);
copyBtn.addEventListener('click', copyToClipboard);
saveBtn.addEventListener('click', saveReport);
loadNotesBtn.addEventListener('click', loadNotes);
modelSelect.addEventListener('change', onModelChange);

// Start connection check right away
checkOllamaConnection();

// Set up periodic connection checks (but don't reload models each time)
setInterval(async () => {
  try {
    const isConnected = await window.api.ollama.checkConnection();
    if (isConnected) {
      statusDot.classList.add('connected');
      statusDot.classList.remove('disconnected');
      statusText.textContent = 'Ollama Connected';
      
      if (conversationContext.initialNotes === '') {
        generateBtn.disabled = false;
      }
    } else {
      setDisconnectedState();
    }
  } catch (error) {
    setDisconnectedState();
  }
}, 30000); // Check every 30 seconds
