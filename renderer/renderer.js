// DOM Elements
const sidebar = document.getElementById('sidebar');
const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
const sessionsList = document.getElementById('sessions-list');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const modelSelect = document.getElementById('model-select');
const conversationHistory = document.getElementById('conversation-history');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const loadFileBtn = document.getElementById('load-file-btn');
const newSessionBtn = document.getElementById('new-session-btn');
const confirmModal = document.getElementById('confirm-modal');
const modalTitle = document.getElementById('modal-title');
const modalMessage = document.getElementById('modal-message');
const closeModalBtn = document.getElementById('close-modal-btn');
const cancelModalBtn = document.getElementById('cancel-modal-btn');
const confirmModalBtn = document.getElementById('confirm-modal-btn');
const nodeVersionElement = document.getElementById('node-version');
const electronVersionElement = document.getElementById('electron-version');
let modelCompatibilityCache = {};

// Model status element has been removed

// Current session state
let currentSession = {
  id: null,
  title: null,
  patientName: null,
  model: '',
  messages: [],
  currentReportIndex: -1,
  isInitialMessage: true,
  lastSaved: null
};

// Autosave timer
let autosaveTimer = null;
const AUTOSAVE_DELAY = 5000; // 5 seconds

// Helper function to clean up empty/problematic sessions
async function cleanupProblematicSessions() {
  console.log('Starting cleanup of problematic sessions...');
  
  try {
    // Use the centralized cleanup method from SessionManager
    const deletedCount = await window.api.sessions.cleanup();
    
    console.log(`Cleanup complete. Removed ${deletedCount} problematic sessions.`);
    return deletedCount > 0;
  } catch (error) {
    console.error('Error during cleanup:', error);
    return false;
  }
}

// Initialize app
async function initializeApp() {
  // Check connection and load models
  await checkOllamaConnection();
  
  // Clean up any problematic sessions
  const cleanupPerformed = await cleanupProblematicSessions();
  
  // Load sessions (will be clean after cleanup)
  await loadSessions();
  
  // Show sidebar by default
  sidebar.classList.add('open');
  
  // Create new session if none exists or we just did a cleanup
  if (sessionsList.innerHTML === '<div class="empty-state">No saved sessions</div>' || cleanupPerformed) {
    startNewSession();
  } else {
    // Try to load most recent session
    const latestSession = sessionsList.querySelector('.session-item');
    if (latestSession) {
      await loadSession(latestSession.dataset.id);
    }
  }
  
  // Set up the new session button once during initialization
  newSessionBtn.addEventListener('click', () => startNewSession());
}

// Check Ollama connection
async function checkOllamaConnection() {
  try {
    const isConnected = await window.api.ollama.checkConnection();
    if (isConnected) {
      statusDot.classList.add('connected');
      statusDot.classList.remove('disconnected');
      statusText.textContent = 'Ollama Connected';
      sendBtn.disabled = false;
      
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
  sendBtn.disabled = true;
  modelSelect.disabled = true;
}

// System information
let systemInfo = null;
let modelCompatibilityInfo = {};

// Get system info at startup
async function getSystemInfo() {
  try {
    systemInfo = await window.api.ollama.getSystemInfo();
    console.log('System info:', systemInfo);
    return systemInfo;
  } catch (error) {
    console.error('Failed to get system info:', error);
    return null;
  }
}

// Evaluate model compatibility
async function evaluateModelCompatibility(modelName, forceRefresh = false) {
  try {
    // Return cached result unless forceRefresh is true
    if (!forceRefresh && modelCompatibilityCache[modelName]) {
      console.log(`Using cached compatibility for ${modelName}`);
      return modelCompatibilityCache[modelName];
    }
    
    // Always get fresh evaluation from backend
    const compatibility = await window.api.ollama.evaluateModelCompatibility(modelName);
    
    // Cache the result
    modelCompatibilityCache[modelName] = compatibility;
    
    console.log(`Evaluated compatibility for ${modelName}:`, compatibility);
    return compatibility;
  } catch (error) {
    console.error(`Failed to evaluate compatibility for ${modelName}:`, error);
    return {
      modelSizeInB: null,
      comfortLevel: 'Unknown',
      message: 'Could not determine compatibility',
      loadingMessage: null
    };
  }
}

// Load available models from Ollama
async function loadModels() {
  try {
    const models = await window.api.ollama.getModels();
    
    // Get system info first if not already available
    if (!systemInfo) {
      await getSystemInfo();
    }
    
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
      currentSession.model = 'deepseek-r1:8b';
    } else {
      // Process each model with compatibility info
      const modelPromises = models.map(async (model) => {
        const compatibility = await evaluateModelCompatibility(model);
        return { name: model, compatibility };
      });
      
      // Wait for all compatibility evaluations
      const modelData = await Promise.all(modelPromises);
      
      // Add models to dropdown with compatibility information
      modelData.forEach(({ name, compatibility }) => {
        const option = document.createElement('option');
        option.value = name;
        
        // Build a label with status included
        let statusEmoji = '';
        if (compatibility.comfortLevel === 'Easy') {
          statusEmoji = ' ✓';
        } else if (compatibility.comfortLevel === 'Difficult') {
          statusEmoji = ' ⚠️';
        } else if (compatibility.comfortLevel === 'Impossible') {
          statusEmoji = ' ❌';
        }
        
        // Include the message directly in the option text
        option.textContent = `${name}${statusEmoji} (${compatibility.message})`;
        
        // Set tooltip for extra context
        option.title = compatibility.message;
        
        // Keep the data attribute for potential future use
        option.dataset.comfortLevel = compatibility.comfortLevel;
        
        // Style option based on comfort level
        if (compatibility.comfortLevel === 'Easy') {
          option.style.color = '#2c7a51';
        } else if (compatibility.comfortLevel === 'Difficult') {
          option.style.color = '#a86616';
        } else if (compatibility.comfortLevel === 'Impossible') {
          option.style.color = '#c53030';
        }
        
        modelSelect.appendChild(option);
      });
      
      // Restore selection or use first model
      if (currentSelection && models.includes(currentSelection)) {
        modelSelect.value = currentSelection;
        updateModelStatusDisplay(modelCompatibilityCache[modelSelect.value] || { comfortLevel: 'Unknown', message: 'Checking compatibility...' });
        currentSession.model = currentSelection;
      } else {
        currentSession.model = models[0];
        modelSelect.value = models[0];
      }
    }
    
    modelSelect.disabled = false;
    
    // Update the model in Ollama client
    window.api.ollama.setModel(currentSession.model);
    
    // Update compatibility info display for selected model
    updateModelCompatibilityDisplay(currentSession.model);
  } catch (error) {
    console.error('Failed to load models:', error);
    
    // Set a default option
    modelSelect.innerHTML = '';
    const option = document.createElement('option');
    option.value = 'deepseek-r1:8b';
    option.textContent = 'DeepSeek 8B (default)';
    modelSelect.appendChild(option);
    
    currentSession.model = 'deepseek-r1:8b';
    modelSelect.disabled = false;
  }
}

function updateModelStatusDisplay(compatInfo) {
  // Legacy function kept for compatibility
}

// Update compatibility info display
async function updateModelCompatibilityDisplay(modelName) {
  try {
    updateModelStatusDisplay(await evaluateModelCompatibility(modelName));
  } catch (error) {
    console.error('Error updating model compatibility display:', error);
  }
}

// Handle sending messages
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text) return;
  
  // Clear input
  userInput.value = '';
  
  // Add user message to UI
  addMessageToUI('user', text);
  
  // Add to session
  currentSession.messages.push({
    role: 'user',
    content: text,
    timestamp: new Date().toISOString()
  });
  
  // Check if this is the initial message (clinical notes)
  if (currentSession.isInitialMessage) {
    await generateInitialReport(text);
    currentSession.isInitialMessage = false;
    
    // Generate a meaningful title for the session
    await generateSessionTitle();
  } else {
    await generateResponse();
  }
  
  // Schedule autosave
  scheduleAutosave();
  
  // Scroll to bottom
  scrollToBottom();
}

// Generate initial letter with clarification questions
async function generateInitialReport(notes) {
  // Show loading message
  const loadingId = addLoadingMessage('letter');
  
  try {
    // Use the generateReport method which already uses the configured prompt file
    const response = await window.api.ollama.generateReport(notes);
    
    // Remove loading message
    removeLoadingMessage(loadingId);
    
    if (response) {
      // Try to extract patient name from letter
      const patientNameMatch = response.match(/Patient(?:\sName)?:\s*([A-Za-z\s]+)(?:,|\n|$)/i);
      if (patientNameMatch && patientNameMatch[1]) {
        currentSession.patientName = patientNameMatch[1].trim();
        updateSessionInSidebar();
      }
      
      // Small delay to ensure loading message is gone
      setTimeout(() => {
        // Add the letter to the conversation
        addMessageToUI('letter', response);
        
        // Add system message indicating letter is ready
        addSystemMessage("Your letter is ready.");
        
        // Generate clarification questions with a small delay
        setTimeout(() => {
          generateClarificationQuestions(notes, response);
        }, 300);
      }, 300);
      
      // Add to session
      currentSession.messages.push({
        role: 'assistant',
        content: response,
        timestamp: new Date().toISOString(),
        isReport: true
      });
      
      // Update current report index
      currentSession.currentReportIndex = currentSession.messages.length - 1;
    } else {
      addErrorMessage("Failed to generate letter. Please check if Ollama is running.");
    }
  } catch (error) {
    // Remove loading message
    removeLoadingMessage(loadingId);
    addErrorMessage(`Error: ${error.message}`);
  }
}

// Generate clarification questions based on the notes and generated report
async function generateClarificationQuestions(notes, reportText) {
  // Show loading message for questions generation
  const loadingId = addLoadingMessage('clarification');
  
  try {
    const questionsResponse = await window.api.ollama.generateClarificationQuestions(notes, reportText);
    
    // Remove loading message
    removeLoadingMessage(loadingId);
    
    // Check model compatibility for tea-time message
    const compatibility = await evaluateModelCompatibility(currentSession.model);
    
    // Process the response - could be raw text with thinking tags
    let extractedQuestions = [];
    
    // Check if the response is already an array of questions
    if (Array.isArray(questionsResponse) && questionsResponse.length > 0) {
      extractedQuestions = questionsResponse;
    } else if (typeof questionsResponse === 'string') {
      // Extract thinking part to display separately
      const thinkingContent = extractThinking(questionsResponse);
      
      // Get the cleaned content (without thinking tags)
      const cleanedContent = removeThinking(questionsResponse);
      
      // Try to extract numbered questions from the cleaned content
      extractedQuestions = cleanedContent.split('\n')
        .filter(line => /^\d+\./.test(line.trim()))
        .map(line => line.trim());
      
      // If no questions were found in the expected format, use the whole content
      if (extractedQuestions.length === 0) {
        extractedQuestions = [cleanedContent.trim()];
      }
    }
    
    if (extractedQuestions.length > 0) {
      // Small delay to ensure loading message is gone
      setTimeout(() => {
        // Add the questions with the original response content
        // This will include the thinking section if present
        addMessageToUI('questions', questionsResponse);
        
        // Store questions in the session
        currentSession.messages.push({
          role: 'system',
          content: questionsResponse,
          timestamp: new Date().toISOString(),
          isQuestions: true,
          questions: extractedQuestions
        });
      }, 300);
    }
  } catch (error) {
    removeLoadingMessage(loadingId);
    console.error('Error generating clarification questions:', error);
  }
}

// Function to show a dialog for answering clarification questions
function showAnswerQuestionsDialog(questions) {
  // Create modal for answering questions
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'questions-modal';
  
  let questionsHtml = '';
  questions.forEach((q, index) => {
    const questionText = q.replace(/^\d+\.\s*/, ''); // Remove numbers from beginning
    questionsHtml += `
      <div class="question-item">
        <p class="question-text">${questionText}</p>
        <textarea id="answer-${index}" placeholder="Your answer..." rows="3" class="question-answer"></textarea>
      </div>
    `;
  });
  
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Answer Clarification Questions</h3>
        <button class="icon-button close-questions-modal-btn">
          <i class="fa-solid fa-times"></i>
        </button>
      </div>
      <div class="modal-body">
        <p>Your answers will be used to improve the report:</p>
        <div class="questions-list">
          ${questionsHtml}
        </div>
      </div>
      <div class="modal-footer">
        <button class="secondary-button cancel-questions-btn">Cancel</button>
        <button class="primary-button submit-answers-btn">Update Report</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Add event listeners
  const closeBtn = modal.querySelector('.close-questions-modal-btn');
  const cancelBtn = modal.querySelector('.cancel-questions-btn');
  const submitBtn = modal.querySelector('.submit-answers-btn');
  
  closeBtn.addEventListener('click', () => {
    modal.remove();
  });
  
  cancelBtn.addEventListener('click', () => {
    modal.remove();
  });
  
  submitBtn.addEventListener('click', () => {
    // Collect answers
    const answers = [];
    questions.forEach((q, index) => {
      const answerEl = document.getElementById(`answer-${index}`);
      if (answerEl && answerEl.value.trim()) {
        answers.push(`Q: ${q.replace(/^\d+\.\s*/, '')}\nA: ${answerEl.value.trim()}`);
      }
    });
    
    if (answers.length > 0) {
      // Submit answers and generate updated report
      submitClarificationAnswers(answers);
      modal.remove();
    } else {
      // Show error if no answers provided
      const errorMsg = document.createElement('div');
      errorMsg.className = 'error-message';
      errorMsg.textContent = 'Please provide at least one answer.';
      modal.querySelector('.modal-body').prepend(errorMsg);
    }
  });
  
  // Close when clicking outside
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
  
  // Show modal
  setTimeout(() => {
    modal.classList.add('show');
  }, 10);
}

// Submit clarification answers and generate updated report
async function submitClarificationAnswers(answers) {
  // Add user's answers to the conversation
  const answersText = "Here are my answers to your questions:\n\n" + answers.join('\n\n');
  addMessageToUI('user', answersText);
  
  // Add to session
  currentSession.messages.push({
    role: 'user',
    content: answersText,
    timestamp: new Date().toISOString()
  });
  
  // Show loading message
  const loadingId = addLoadingMessage('letter');
  
  try {
    // Get the original notes
    let initialNotes = '';
    if (currentSession.messages.length > 0 && currentSession.messages[0].role === 'user') {
      initialNotes = currentSession.messages[0].content;
    }
    
    // Generate updated letter
    const updatedReport = await window.api.ollama.generateReportWithClarifications(initialNotes, answers);
    
    // Remove loading message
    removeLoadingMessage(loadingId);
    
    if (updatedReport) {
      // Small delay to ensure loading message is gone
      setTimeout(() => {
        // Add the updated letter to the conversation
        addMessageToUI('letter', updatedReport);
        
        // Add system message indicating letter is ready
        addSystemMessage("Your updated letter is ready.");
      }, 300);
      
      // Add to session
      currentSession.messages.push({
        role: 'assistant',
        content: updatedReport,
        timestamp: new Date().toISOString(),
        isReport: true
      });
      
      // Update current report index
      currentSession.currentReportIndex = currentSession.messages.length - 1;
      
      // Schedule autosave
      scheduleAutosave();
    } else {
      addErrorMessage("Failed to generate updated letter.");
    }
  } catch (error) {
    // Remove loading message
    removeLoadingMessage(loadingId);
    addErrorMessage(`Error: ${error.message}`);
  }
}

// Generate response based on conversation history
async function generateResponse() {
  // Show loading message
  const loadingId = addLoadingMessage('response');
  
  try {
    // Build prompt from conversation history
    const prompt = await buildConversationPrompt();
    
    const response = await window.api.ollama.generateConversationalResponse(prompt);
    
    // Remove loading message
    removeLoadingMessage(loadingId);
    
    if (response) {
      // Small delay to ensure loading message is gone
      setTimeout(() => {
        // Add the response to the conversation
        addMessageToUI('letter', response);
        
        // Add system message indicating letter is ready
        addSystemMessage("Your letter is ready.");
      }, 300);
      
      // Add to session
      currentSession.messages.push({
        role: 'assistant',
        content: response,
        timestamp: new Date().toISOString(),
        isReport: true
      });
      
      // Update current report index
      currentSession.currentReportIndex = currentSession.messages.length - 1;
    } else {
      addErrorMessage("Failed to generate response.");
    }
  } catch (error) {
    // Remove loading message
    removeLoadingMessage(loadingId);
    addErrorMessage(`Error: ${error.message}`);
  }
}

// Build conversation prompt
async function buildConversationPrompt() {
  let initialNotes = '';
  
  // Find the first user message (clinical notes)
  if (currentSession.messages.length > 0 && currentSession.messages[0].role === 'user') {
    initialNotes = currentSession.messages[0].content;
  }
  
  try {
    // First get the main prompt template using the configured prompt file
    const promptFile = await window.api.ollama.getPromptFile();
    let mainPromptTemplate = await window.api.files.loadPromptFile(promptFile);
    
    // If loading the main prompt fails, use a default prompt
    if (!mainPromptTemplate) {
      console.warn(`Failed to load prompt file: ${promptFile}, using default`);
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
`;
    }
    
    // Replace notes in main prompt
    const mainPrompt = mainPromptTemplate.replace('{{notes}}', initialNotes);
    
    // Build conversation history
    let conversationText = '';
    for (let i = 1; i < currentSession.messages.length; i++) {
      const message = currentSession.messages[i];
      conversationText += `\n${message.role.toUpperCase()}: ${message.content}\n`;
    }
    
    // Try to load the conversation prompt template
    let convPromptTemplate = await window.api.files.loadPromptFile('conversation-prompt.txt');
    
    if (!convPromptTemplate) {
      console.warn('Failed to load conversation-prompt.txt, using default');
      return `
${mainPrompt}

Conversation history:
${conversationText}

Based on the above conversation and feedback, please provide an updated physiotherapy report.
IMPORTANT: Respond ONLY with the final report text. Do not include any explanations, your reasoning process, or any text outside the report itself.
`;
    }
    
    // Use the conversation prompt template
    return convPromptTemplate
      .replace('{{main_prompt}}', mainPrompt)
      .replace('{{conversation}}', conversationText);
      
  } catch (error) {
    console.error('Error building conversation prompt:', error);
    
    // Fallback to simple prompt if anything fails
    let conversationText = '';
    for (let i = 1; i < currentSession.messages.length; i++) {
      const message = currentSession.messages[i];
      conversationText += `\n${message.role.toUpperCase()}: ${message.content}\n`;
    }
    
    return `
You are a physiotherapy assistant helping to convert clinical notes into a professional report.
Your task is to create or update a physiotherapy report based on the following information.

Original clinical notes:
${initialNotes}

Conversation history:
${conversationText}

Based on the above conversation and feedback, please provide an updated physiotherapy report.
IMPORTANT: Respond ONLY with the final report text. Do not include any explanations.
`;
  }
}

// Session management functions
async function loadSessions() {
  try {
    const sessions = await window.api.sessions.loadList();
    
    // Clear current list
    sessionsList.innerHTML = '';
    
    if (sessions.length === 0) {
      sessionsList.innerHTML = '<div class="empty-state">No saved sessions</div>';
      return;
    }
    
    // Populate session list
    sessions.forEach(session => {
      addSessionToSidebar(session);
    });
    
    // Ensure session handler is set up
    setupSessionListeners();
  } catch (error) {
    console.error('Load sessions error:', error);
    sessionsList.innerHTML = '<div class="error-message">Failed to load sessions</div>';
  }
}

function addSessionToSidebar(session) {
  const sessionItem = document.createElement('div');
  sessionItem.className = 'session-item';
  sessionItem.dataset.id = session.id;
  
  // Store if session has content for easier empty session detection
  sessionItem.dataset.hasContent = (!!(session.title) || 
                                  !!(session.messages && session.messages.length > 0)).toString();
  
  const date = session.savedAt ? new Date(session.savedAt) : new Date();
  const formattedDate = formatDate(date);
  
  sessionItem.innerHTML = `
    <div class="session-title">${session.title || (session.patientName ? `${session.patientName}'s Assessment` : 'Untitled Session')}</div>
    <div class="session-meta">
      <span class="session-date">${formattedDate}</span>
      <div class="session-actions">
        <button class="icon-button delete-session-btn" title="Delete Session">
          <i class="fa-solid fa-trash-alt"></i>
        </button>
      </div>
    </div>
  `;
  
    // Style the delete button consistently
  const deleteBtn = sessionItem.querySelector('.delete-session-btn');
  if (deleteBtn) {
    // Add a more visible style to the delete button to ensure it's clickable
    deleteBtn.style.cursor = 'pointer';
    deleteBtn.style.padding = '8px';
    deleteBtn.style.backgroundColor = '#f8e5e5';
    deleteBtn.style.borderRadius = '4px';
    deleteBtn.style.zIndex = '100';
  } else {
    console.error('Delete button not found in session item');
  }
  
  // No event listeners attached here - using delegation instead
  
  sessionsList.appendChild(sessionItem);
}

function updateSessionInSidebar() {
  if (!currentSession.id) return;
  
  const sessionItem = sessionsList.querySelector(`.session-item[data-id="${currentSession.id}"]`);
  if (sessionItem) {
    const titleEl = sessionItem.querySelector('.session-title');
    if (titleEl) {
      titleEl.textContent = currentSession.title || (currentSession.patientName ? `${currentSession.patientName}'s Assessment` : 'Untitled Session');
    }
    
    const dateEl = sessionItem.querySelector('.session-date');
    if (dateEl && currentSession.lastSaved) {
      dateEl.textContent = formatDate(new Date(currentSession.lastSaved));
    }
  }
}

// Generate a meaningful title for the conversation
async function generateSessionTitle() {
  // Only generate title after we have at least one response
  if (currentSession.messages.length < 2) return;
  
  try {
    const initialNotes = currentSession.messages[0].content;
    const firstReport = currentSession.messages.find(m => m.role === 'assistant' && m.isReport)?.content || '';
    
    // Try to load the session title prompt template
    let titlePromptTemplate = await window.api.files.loadPromptFile('session-title.txt');
    
    // If the prompt file fails to load, use a default
    if (!titlePromptTemplate) {
      console.warn('Failed to load session-title.txt, using default');
      titlePromptTemplate = `
You are helping to generate a short, descriptive title for a physiotherapy session.
Based on the following information, create a concise title (3-5 words) that summarizes the key issue or treatment:

PATIENT NOTES:
{{notes}}

REPORT EXCERPT:
{{report}}

Reply ONLY with the title, nothing else. Keep it short and specific to the condition or treatment.
Do not include any explanatory text, thinking process, or tags like <thinking>.
The title must be 30 characters or less to fit in a menu.
`;
    }
    
    // Replace placeholders in the template
    const titlePrompt = titlePromptTemplate
      .replace('{{notes}}', initialNotes.substring(0, 500))
      .replace('{{report}}', firstReport.substring(0, 300));

    const title = await window.api.ollama.generateConversationalResponse(titlePrompt);
    
    if (title && title.length > 0) {
      // Clean up title - remove quotes, tags, and limit length
      let cleanTitle = title.replace(/["']/g, '').trim();
      
      // Check for TITLE: format first
      const titleMatch = cleanTitle.match(/TITLE:\s*(.*)/i);
      if (titleMatch && titleMatch[1]) {
        cleanTitle = titleMatch[1].trim();
      } else {
        // Remove any <thinking> tags and their content if TITLE: format not found
        cleanTitle = cleanTitle.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
        // Remove any other tags
        cleanTitle = cleanTitle.replace(/<[^>]*>/g, '');
        
        // If there's a colon in the text, take everything after the last colon
        const colonIndex = cleanTitle.lastIndexOf(':');
        if (colonIndex !== -1 && colonIndex < cleanTitle.length - 1) {
          cleanTitle = cleanTitle.substring(colonIndex + 1).trim();
        }
      }
      
      // Ensure title is brief enough for sidebar (max 30 chars)
      cleanTitle = cleanTitle.substring(0, 30);
      currentSession.title = cleanTitle;
      updateSessionInSidebar();
      
      // Schedule autosave to persist the title
    }
  } catch (error) {
    console.error('Failed to generate session title:', error);
    // Fallback to patient name if available
    if (currentSession.patientName && !currentSession.title) {
      currentSession.title = `${currentSession.patientName}'s Assessment`;
      updateSessionInSidebar();
    }
  }
}

async function loadSession(sessionId) {
  // Check if we're already on this session
  if (currentSession.id === sessionId) return;
  
  try {
    const session = await window.api.sessions.load(sessionId);
    if (session) {
      // Clear current conversation
      conversationHistory.innerHTML = '';
      
      // Update current session
      currentSession = session;
      
      // Update model selection if available
      if (session.model && !modelSelect.disabled) {
        modelSelect.value = session.model;
        window.api.ollama.setModel(session.model);
      }
      
      // Display messages
      session.messages.forEach(message => {
        if (message.role === 'user') {
          addMessageToUI('user', message.content);
        } else if (message.role === 'assistant') {
          if (message.isReport) {
            addMessageToUI('report', message.content);
          } else {
            addMessageToUI('system', message.content);
          }
        } else if (message.role === 'system') {
          addSystemMessage(message.content);
        }
      });
      
      // Update UI state
      currentSession.isInitialMessage = false;
      
      // Mark session as active in sidebar
      document.querySelectorAll('.session-item').forEach(item => {
        item.classList.remove('active');
      });
      const activeItem = document.querySelector(`.session-item[data-id="${sessionId}"]`);
      if (activeItem) {
        activeItem.classList.add('active');
      }
      
      showToast('Session loaded');
    }
  } catch (error) {
    console.error('Load session error:', error);
    showToast('Failed to load session', true);
  }
}

function startNewSession() {
  console.log('Starting new session...');
  
  try {
    // Clear conversation history
    conversationHistory.innerHTML = '';
    
    // Add initial system message
    console.log('Adding system message');
    addSystemMessage('Enter clinical notes to generate a letter');
    
    // Reset session
    console.log('Resetting session state, current model value:', modelSelect.value);
    currentSession = {
      id: null,
      title: null,
      patientName: null,
      model: modelSelect.value || store.get('ollamaModel', 'deepseek-r1:8b'),
      messages: [],
      currentReportIndex: -1,
      isInitialMessage: true,
      lastSaved: null
    };
    
    // Reset active session in sidebar
    console.log('Resetting active sessions in sidebar');
    document.querySelectorAll('.session-item').forEach(item => {
      item.classList.remove('active');
    });
    
    // Autosave the new session
    console.log('Saving the new session');
    saveSession();
    
    console.log('New session creation complete');
  } catch (error) {
    console.error('Error creating new session:', error);
  }
}

async function saveSession() {
  console.log('saveSession called with session data:', JSON.stringify(currentSession, null, 2));
  
  try {
    const timestamp = new Date().toISOString();
    const sessionData = {
      ...currentSession,
      savedAt: timestamp
    };
    
    console.log('Sending session data to window.api.sessions.save');
    const result = await window.api.sessions.save(sessionData);
    console.log('Save result:', result);
    
    if (result.success) {
      console.log('Session saved successfully with ID:', result.id);
      currentSession.id = result.id || currentSession.id;
      currentSession.lastSaved = timestamp;
      
      // If this is first save, add to sidebar
      if (!document.querySelector(`.session-item[data-id="${currentSession.id}"]`)) {
        console.log('Adding new session to sidebar');
        const sessionInfo = {
          id: currentSession.id,
          title: currentSession.title,
          patientName: currentSession.patientName,
          savedAt: timestamp
        };
        addSessionToSidebar(sessionInfo);
      } else {
        console.log('Updating existing session in sidebar');
        updateSessionInSidebar();
      }
      
      // Mark as active
      console.log('Marking session as active in sidebar');
      document.querySelectorAll('.session-item').forEach(item => {
        item.classList.remove('active');
      });
      const activeItem = document.querySelector(`.session-item[data-id="${currentSession.id}"]`);
      if (activeItem) {
        activeItem.classList.add('active');
      }
    } else {
      console.error('Session save failed:', result);
    }
  } catch (error) {
    console.error('Save session error:', error);
    console.error('Error stack:', error.stack);
  }
}

function scheduleAutosave() {
  // Clear any existing timer
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
  }
  
  // Set new timer
  autosaveTimer = setTimeout(() => {
    saveSession();
  }, AUTOSAVE_DELAY);
}

async function deleteSession(sessionId) {
  console.log('Attempting to delete session with ID:', sessionId);
  
  try {
    // First find and remove the element from the DOM to ensure UI is responsive
    const sessionElement = document.querySelector(`.session-item[data-id="${sessionId}"]`);
    console.log('Found session element in DOM:', sessionElement);
    
    if (sessionElement) {
      // Remove the element immediately for better UX
      sessionElement.remove();
      console.log('Removed session element from DOM');
    }
    
    // Then attempt to delete from the data store
    console.log('Deleting session from data store...');
    const result = await window.api.sessions.delete(sessionId);
    console.log('Delete session result:', result);
    
    // Handle the case where the current session was deleted
    if (currentSession.id === sessionId) {
      console.log('Current session was deleted, starting new session');
      startNewSession();
    }
    
    // Check if there are any sessions left and update UI accordingly
    if (sessionsList.children.length === 0) {
      console.log('No sessions left, showing empty state');
      sessionsList.innerHTML = '<div class="empty-state">No saved sessions</div>';
    }
    
    showToast('Session deleted');
    
    // Force a clean refresh of the sessions list after a short delay
    setTimeout(() => {
      console.log('Refreshing sessions list');
      loadSessions();
    }, 500);
    
  } catch (error) {
    console.error('Delete session error:', error);
    console.error('Error stack:', error.stack);
    
    // Even if the backend delete fails, make sure the UI is consistent
    const sessionElement = document.querySelector(`.session-item[data-id="${sessionId}"]`);
    if (sessionElement) {
      sessionElement.remove();
      console.log('Force-removed problematic session element from DOM');
    }
    
    showToast('Failed to delete session - trying to clean up UI', true);
    
    // Force a refresh of the sessions list
    setTimeout(() => {
      console.log('Forcing sessions list refresh after error');
      loadSessions();
    }, 500);
  }
}

function showDeleteConfirmation(sessionId, sessionName) {
  showModal(
    'Delete Session', 
    `Are you sure you want to delete "${sessionName}"? This action cannot be undone.`, 
    () => deleteSession(sessionId)
  );
}

// UI helper functions
function addMessageToUI(type, content, options = {}) {
  const messageDiv = document.createElement('div');
  
  // determine appropriate message class
  const messageClasses = {
    user: 'message user-message',
    letter: 'message letter-message',
    report: 'message letter-message',
    questions: 'message questions-message',
    system: 'message system-message',
    thinking: 'thinking-message'
  };
  
  messageDiv.className = messageClasses[type] || 'message system-message';
  
  // render message
  renderMessage(messageDiv, content, { type, ...options });
  
  conversationHistory.appendChild(messageDiv);
  scrollToBottom();
  
  return messageDiv;
}

// Base message renderer that handles common rendering logic
function renderMessage(element, content, options = {}) {
  // common rendering logic
  const timestamp = formatTimestamp(new Date());
  let messageContent = '';
  
  // extract thinking content if present
  const thinkingContent = extractThinking(content);
  const mainContent = removeThinking(content);
  
  // render thinking part if present
  if (thinkingContent) {
    const thinkingDiv = document.createElement('div');
    thinkingDiv.className = 'thinking-message';
    renderThinkingContent(thinkingDiv, thinkingContent);
    conversationHistory.appendChild(thinkingDiv);
  }
  
  // type-specific rendering
  switch(options.type) {
    case 'letter':
    case 'report':
      messageContent = formatReport(mainContent);
      element.innerHTML = `
        <div class="message-content">${messageContent}</div>
        <div class="message-timestamp">${timestamp}</div>
        <div class="message-controls">
          <button class="secondary-button small-button copy-btn">
            <i class="fa-solid fa-copy"></i> Copy
          </button>
          <button class="secondary-button small-button export-btn">
            <i class="fa-solid fa-file-export"></i> Export
          </button>
        </div>
      `;
      
      // Add event listeners for the buttons
      element.querySelector('.copy-btn').addEventListener('click', () => {
        copyReportToClipboard(mainContent);
      });
      
      element.querySelector('.export-btn').addEventListener('click', () => {
        exportReport(mainContent);
      });
      break;
      
    case 'questions':
      // Process questions - extract numbered items
      const questionLines = mainContent.split('\n')
        .filter(line => /^\d+\./.test(line.trim()))
        .map(line => `<li>${line.replace(/^\d+\./, '').trim().replace(/^["']|["']$/g, '')}</li>`)
        .join('');
      
      // Create HTML for questions
      const questionsHTML = `
        <div class="clarification-questions">
          <h4>Clarification Questions:</h4>
          <ul>
            ${questionLines}
          </ul>
          <div class="clarification-actions">
            <button class="secondary-button small-button answer-questions-btn" style="background-color: #f0ebff; color: #6B3FA0; border-color: #d4c6ff;">
              <i class="fa-solid fa-reply"></i> Answer Questions
            </button>
          </div>
        </div>
      `;
      
      element.innerHTML = `
        <div class="message-content">${questionsHTML}</div>
        <div class="message-timestamp">${timestamp}</div>
      `;
      
      // Add event listener for the answer button
      const answerBtn = element.querySelector('.answer-questions-btn');
      if (answerBtn) {
        const questions = [];
        const questionItems = element.querySelectorAll('.clarification-questions li');
        questionItems.forEach(item => {
          questions.push(item.textContent.trim());
        });
        
        answerBtn.addEventListener('click', () => {
          showAnswerQuestionsDialog(questions);
        });
      }
      break;
      
    default:
      // basic message (user, system, etc)
      messageContent = mainContent.replace(/\n/g, '<br>');
      element.innerHTML = `
        <div class="message-content">${messageContent}</div>
        <div class="message-timestamp">${timestamp}</div>
      `;
  }
}

// Helper for rendering just the thinking content
function renderThinkingContent(element, content) {
  // Format thinking content with markdown-like styling
  const formattedThinking = content
    .split('\n')
    .map(line => {
      if (line.startsWith('-')) {
        return `<li>${line.substring(1).trim()}</li>`;
      } else if (line.trim().length > 0) {
        return `<p>${line}</p>`;
      } else {
        return '';
      }
    })
    .join('');

  element.innerHTML = `
    <div class="thinking-content">
      <h4>AI Thinking:</h4>
      <ul>${formattedThinking}</ul>
    </div>
  `;
}

function addSystemMessage(content) {
  const messageDiv = addMessageToUI('system', content);
  
  // Add to session messages
  currentSession.messages.push({
    role: 'system',
    content: content,
    timestamp: new Date().toISOString()
  });
}

class LoadingManager {
  constructor() {
    this.verbList = [
      'Generating', 'Discombobulating', 'Kerfuffling', 'Noodling', 'Hatching', 'Brewing', 
      'Fashioning', 'Weaving', 'Cobbling', 'Wrangling', 'Spooling', 'Smithing', 
      'Manifesting', 'Cultivating', 'Harvesting', 'Spinning', 'Crafting', 'Assembling', 
      'Fabricating', 'Minting', 'Sculpting', 'Orchestrating', 'Incubating', 'Summoning', 
      'Unearthing', 'Unravelling', 'Churning', 'Distilling', 'Kindling', 'Birthing', 
      'Rigging', 'Flumoxing', 'Cockamamying', 'Wonkifying', 'Cobbling-together', 
      'Hamfisting', 'Faffing-about with', 'Paddling-through', 'Wizarding', 'Speedrunning', 
      'Shredding', 'Turbocharging', 'Mobilising'
    ];
    this.activeLoaders = new Map();
  }
  
  addLoader(stage = 'letter') {
    const loadingId = 'loading-' + Date.now();
    const verb = this.verbList[Math.floor(Math.random() * this.verbList.length)];
    const loadingDiv = this.createLoader(loadingId, verb, stage);
    
    conversationHistory.appendChild(loadingDiv);
    scrollToBottom();
    
    // Cycle verbs periodically
    const intervalId = this.startVerbCycling(loadingDiv, stage);
    this.activeLoaders.set(loadingId, intervalId);
    
    return loadingId;
  }
  
  removeLoader(id) {
    const element = document.getElementById(id);
    const intervalId = this.activeLoaders.get(id);
    
    if (intervalId) {
      clearInterval(intervalId);
      this.activeLoaders.delete(id);
    }
    
    if (element) {
      element.classList.add('removing');
      element.style.opacity = '0';
      
      setTimeout(() => {
        if (document.body.contains(element)) {
          element.remove();
        }
        
        // Check for any orphaned loading messages
        document.querySelectorAll('.loading').forEach(msg => {
          if (!msg.id || msg.id !== id) {
            console.log('Removing orphaned loading message');
            msg.remove();
          }
        });
      }, 300);
    } else {
      // Fallback cleanup if element not found
      console.log('Loading element not found, checking for any loading messages');
      document.querySelectorAll('.loading').forEach(msg => {
        msg.remove();
      });
    }
  }
  
  createLoader(id, verb, stage) {
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message system-message loading';
    loadingDiv.id = id;
    
    let message = '';
    switch (stage) {
      case 'letter':
      case 'report':
        message = `${verb} the letter for you...`;
        break;
      case 'clarification':
        message = `${verb} my questions for you...`;
        break;
      case 'response':
        message = `${verb} response...`;
        break;
      default:
        message = `${verb}...`;
    }
    
    loadingDiv.innerHTML = this.renderLoadingAnimation(message);
    return loadingDiv;
  }
  
  startVerbCycling(loadingElement, stage) {
    return setInterval(() => {
      if (loadingElement && document.body.contains(loadingElement)) {
        const newVerb = this.verbList[Math.floor(Math.random() * this.verbList.length)];
        const messageElement = loadingElement.querySelector('.loading-tea p');
        
        if (messageElement) {
          let message = '';
          switch (stage) {
            case 'letter':
            case 'report':
              message = `${newVerb} the letter for you...`;
              break;
            case 'clarification':
              message = `${newVerb} my questions for you...`;
              break;
            case 'response':
              message = `${newVerb} response...`;
              break;
            default:
              message = `${newVerb}...`;
          }
          messageElement.textContent = message;
        }
      }
    }, 60000); // Change every 60 seconds
  }
  
  renderLoadingAnimation(message) {
    return `
      <div class="loading-tea">
        <div class="tea-animation">
          <img src="../assets/tea-animation.svg" width="80" height="80" alt="Loading animation" />
        </div>
        <p>${message}</p>
      </div>
    `;
  }
}

// Create a single instance
const loadingManager = new LoadingManager();

// Simplified message handling functions
const addLoadingMessage = (stage = 'letter') => loadingManager.addLoader(stage);
const removeLoadingMessage = (id) => loadingManager.removeLoader(id);
const addErrorMessage = (errorText) => {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-message';
  errorDiv.textContent = errorText;
  
  conversationHistory.appendChild(errorDiv);
  scrollToBottom();
  
  return errorDiv;
}

function scrollToBottom() {
  conversationHistory.scrollTop = conversationHistory.scrollHeight;
}

function formatTimestamp(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(date) {
  // For today, show only the time
  const today = new Date();
  const isToday = date.getDate() === today.getDate() && 
                  date.getMonth() === today.getMonth() && 
                  date.getFullYear() === today.getFullYear();
                  
  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  
  // For this year, show day and month
  const isThisYear = date.getFullYear() === today.getFullYear();
  if (isThisYear) {
    return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
  }
  
  // Otherwise show date with year
  return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

// Format the report text with HTML
// Extract thinking content from text
function extractThinking(text) {
  // Method 1: Try to extract content from thinking tags
  const thinkingMatch = text.match(/<thinking>[\s\S]*?<\/thinking>/i);
  if (thinkingMatch && thinkingMatch[0]) {
    // Extract just the content inside the tags
    const contentMatch = thinkingMatch[0].match(/<thinking>([\s\S]*?)<\/thinking>/i);
    if (contentMatch && contentMatch[1]) {
      return contentMatch[1].trim();
    }
    return thinkingMatch[0].replace(/<\/?thinking>/gi, '').trim();
  }
  
  // Method 2: If no thinking tags, try to extract everything before marker
  if (text.includes('**REFERRAL LETTER**')) {
    const parts = text.split('**REFERRAL LETTER**');
    if (parts.length > 1 && parts[0].trim().length > 0) {
      return parts[0].trim();
    }
  }
  
  // Method 3: Check for title marker
  if (text.includes('**TITLE:**')) {
    const parts = text.split('**TITLE:**');
    if (parts.length > 1 && parts[0].trim().length > 0) {
      return parts[0].trim();
    }
  }
  
  return null;
}

// Remove thinking tags and their content from text
function removeThinking(text) {
  // First try to remove any complete thinking blocks
  const withoutThinking = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
  
  // Also remove any potentially unmatched thinking tags
  let cleanedText = withoutThinking.replace(/<\/?thinking>/gi, '').trim();
  
  // Check for marker fallbacks if thinking tags weren't found or didn't work
  if (text === cleanedText || !text.match(/<thinking>[\s\S]*?<\/thinking>/gi)) {
    // Check for REFERRAL LETTER marker (for letters)
    if (cleanedText.includes('**REFERRAL LETTER**')) {
      const parts = cleanedText.split('**REFERRAL LETTER**');
      if (parts.length > 1) {
        // Take everything after the REFERRAL LETTER marker
        return parts[1].trim();
      }
    }
    
    // Check for TITLE marker (for session titles)
    if (cleanedText.includes('**TITLE:**')) {
      const parts = cleanedText.split('**TITLE:**');
      if (parts.length > 1) {
        // Take everything after the TITLE marker
        return parts[1].trim();
      }
    }
  }
  
  return cleanedText;
}

function formatReport(reportText) {
  // Use marked to parse markdown
  return marked.parse(reportText);
}

// Copy report to clipboard
async function copyReportToClipboard(reportText) {
  try {
    // Strip HTML if present
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = reportText;
    const textToCopy = tempDiv.textContent || tempDiv.innerText || reportText;
    
    await navigator.clipboard.writeText(textToCopy);
    showToast('Letter copied to clipboard');
  } catch (error) {
    console.error('Failed to copy:', error);
    showToast('Failed to copy letter', true);
  }
}

// Export letter
async function exportReport(reportText) {
  // Try to get patient name for filename
  let suggestedName = 'physiotherapy-letter.txt';
  if (currentSession.patientName) {
    suggestedName = `${currentSession.patientName.replace(/\s+/g, '_')}_letter.txt`;
  }
  
// Strip HTML if present
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = reportText;
  const textToExport = tempDiv.textContent || tempDiv.innerText || reportText;
  
  try {
    const success = await window.api.files.saveReport(textToExport, suggestedName);
    if (success) {
      showToast('Letter exported successfully');
    }
  } catch (error) {
    console.error('Failed to export letter:', error);
    showToast('Failed to export letter', true);
  }
}

// File operations
async function loadNotesFromFile() {
  try {
    const notes = await window.api.files.loadNotes();
    if (notes) {
      userInput.value = notes;
      userInput.focus();
    }
  } catch (error) {
    console.error('Load notes error:', error);
    showToast('Failed to load notes from file', true);
  }
}

// Toast notification
function showToast(message, isError = false) {
  // Remove any existing toast
  const existingToast = document.querySelector('.toast');
  if (existingToast) {
    existingToast.remove();
  }
  
  const toast = document.createElement('div');
  toast.className = `toast ${isError ? 'toast-error' : 'toast-success'}`;
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  // Animate in
  setTimeout(() => {
    toast.classList.add('show');
  }, 10);
  
  // Remove after 3 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3000);
}

// Sidebar toggle
const toggleSidebar = () => sidebar.classList.toggle('open');

// Create a reusable modal component
class ModalManager {
  constructor() {
    this.activeModals = new Map();
  }
  
  showModal(modalElement, options = {}) {
    modalElement.classList.remove('hidden');
    
    if (options.onConfirm) {
      const confirmBtn = modalElement.querySelector('[data-action="confirm"]');
      if (confirmBtn) {
        // Store original listener if exists
        const originalListener = confirmBtn.onclick;
        this.activeModals.set(modalElement.id, { element: modalElement, originalListener });
        
        // Set new listener
        confirmBtn.onclick = () => {
          options.onConfirm();
          this.hideModal(modalElement);
        };
      }
    }
    
    return modalElement;
  }
  
  hideModal(modalElement) {
    modalElement.classList.add('hidden');
    
    // Restore original listeners if any
    const modalData = this.activeModals.get(modalElement.id);
    if (modalData && modalData.originalListener) {
      const confirmBtn = modalElement.querySelector('[data-action="confirm"]');
      if (confirmBtn) {
        confirmBtn.onclick = modalData.originalListener;
      }
    }
    
    this.activeModals.delete(modalElement.id);
  }
}

// Create single instance
const modalManager = new ModalManager();

// Simplified modal functions
const hideModal = () => modalManager.hideModal(confirmModal);
const showModal = (title, message, onConfirm) => {
  modalTitle.textContent = title;
  modalMessage.textContent = message;
  return modalManager.showModal(confirmModal, { onConfirm });
};

// Info Modal
const infoBtn = document.getElementById('info-btn');
const infoModal = document.getElementById('info-modal');
const closeInfoModalBtn = document.getElementById('close-info-modal-btn');
const infoContent = document.getElementById('info-content');
const introTab = document.getElementById('intro-tab');
const disclaimerTab = document.getElementById('disclaimer-tab');
const appInfoTooltip = document.getElementById('app-info-tooltip');

// Load and display documentation
async function loadDocContent(filename) {
  try {
    const content = await window.api.files.loadDocFile(filename);
    if (content.startsWith('Error:')) {
      return content;
    }
    return content;
  } catch (error) {
    console.error(`Error loading doc content for ${filename}:`, error);
    return `Error loading content: ${error.message}`;
  }
}

// Load tooltip content when page loads
async function loadTooltipContent() {
  try {
    const introContent = await loadDocContent('intro.txt');
    const disclaimerContent = await loadDocContent('disclaimer.txt');
    const combinedContent = `${introContent}\n\n${disclaimerContent}`;
    appInfoTooltip.innerHTML = marked.parse(combinedContent);
  } catch (error) {
    console.error('Error loading tooltip content:', error);
    appInfoTooltip.textContent = 'Error loading information';
  }
}

// Make sure this runs after DOM is loaded and marked library is available
document.addEventListener('DOMContentLoaded', () => {
  // Small delay to ensure marked is loaded
  setTimeout(loadTooltipContent, 100);
});

function showInfoModal(tabName = 'intro') {
  // Set active tab
  introTab.classList.remove('active');
  disclaimerTab.classList.remove('active');
  
  // Set active tab and load content
  const tabConfig = {
    'intro': { element: introTab, file: 'intro.txt' },
    'disclaimer': { element: disclaimerTab, file: 'disclaimer.txt' }
  };
  
  if (tabConfig[tabName]) {
    tabConfig[tabName].element.classList.add('active');
    loadDocContent(tabConfig[tabName].file).then(content => {
      infoContent.textContent = content;
    });
  }
  
  modalManager.showModal(infoModal);
}

const hideInfoModal = () => modalManager.hideModal(infoModal);

// Event delegation for session list clicks
function setupSessionListeners() {
  sessionsList.addEventListener('click', handleSessionClick);
}

function handleSessionClick(event) {
  const deleteBtn = event.target.closest('.delete-session-btn');
  const sessionItem = event.target.closest('.session-item');
  
  if (!sessionItem) return;
  
  const sessionId = sessionItem.dataset.id;
  
  if (deleteBtn) {
    // Prevent event from bubbling to session item
    event.stopPropagation();
    event.preventDefault();
    
    // Empty sessions get deleted directly, others get confirmation
    const isEmpty = !sessionItem.querySelector('.session-title').textContent || 
                    sessionItem.querySelector('.session-title').textContent === 'Untitled Session' ||
                    sessionItem.dataset.hasContent === 'false';
    
    if (isEmpty) {
      deleteSession(sessionId);
    } else {
      const sessionName = sessionItem.querySelector('.session-title').textContent;
      showDeleteConfirmation(sessionId, sessionName);
    }
    
    return false;
  } else {
    // Load the session (not clicking delete button)
    loadSession(sessionId);
  }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  initializeApp();
  
  // Set up session delegation
  setupSessionListeners();
});

toggleSidebarBtn.addEventListener('click', toggleSidebar);
sendBtn.addEventListener('click', sendMessage);
userInput.addEventListener('input', () => {
  sendBtn.disabled = userInput.value.trim() === '';
});

// Info modal event listeners
infoBtn.addEventListener('click', () => showInfoModal('intro'));
closeInfoModalBtn.addEventListener('click', hideInfoModal);
introTab.addEventListener('click', () => showInfoModal('intro'));
disclaimerTab.addEventListener('click', () => showInfoModal('disclaimer'));

// Close modal when clicking outside
infoModal.addEventListener('click', (e) => {
  if (e.target === infoModal) {
    hideInfoModal();
  }
});

userInput.addEventListener('keydown', (e) => {
  // Send on Ctrl+Enter or Command+Enter
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    if (userInput.value.trim() !== '') {
      sendMessage();
      e.preventDefault();
    }
  }
});

loadFileBtn.addEventListener('click', loadNotesFromFile);
// Event listener for the New Session button is set in initializeApp

// Modal event listeners
closeModalBtn.addEventListener('click', hideModal);
cancelModalBtn.addEventListener('click', hideModal);

// Clicking outside modal closes it
confirmModal.addEventListener('click', (e) => {
  if (e.target === confirmModal) {
    hideModal();
  }
});

modelSelect.addEventListener('change', async () => {
  console.log('Dropdown changed to:', modelSelect.value);

  const newModel = modelSelect.value;
  currentSession.model = newModel;
  await window.api.ollama.setModel(newModel);
  
  // Just use the cache we already built - no need to re-evaluate
  if (modelCompatibilityCache[newModel]) {
    updateModelStatusDisplay(modelCompatibilityCache[newModel]);
  } else {
    // Fallback if somehow not in cache
    const compatibility = await evaluateModelCompatibility(newModel);
    updateModelStatusDisplay(compatibility);
  }
  
  scheduleAutosave();
  console.log('Model compatibility cache:', modelCompatibilityCache);

});

// Set up periodic connection checks
setInterval(async () => {
  try {
    const isConnected = await window.api.ollama.checkConnection();
    if (isConnected) {
      statusDot.classList.add('connected');
      statusDot.classList.remove('disconnected');
      statusText.textContent = 'Ollama Connected';
      sendBtn.disabled = userInput.value.trim() === '';
    } else {
      setDisconnectedState();
    }
  } catch (error) {
    setDisconnectedState();
  }
}, 30000); // Check every 30 seconds