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

// Initialize app
async function initializeApp() {
  await checkOllamaConnection();
  await loadSessions();
  
  // Show sidebar by default
  sidebar.classList.add('open');
  
  // Create new session if none exists
  if (sessionsList.innerHTML === '<div class="empty-state">No saved sessions</div>') {
    startNewSession();
  } else {
    // Try to load most recent session
    const latestSession = sessionsList.querySelector('.session-item');
    if (latestSession) {
      await loadSession(latestSession.dataset.id);
    }
  }
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
async function evaluateModelCompatibility(modelName) {
  try {
    if (!modelCompatibilityInfo[modelName]) {
      modelCompatibilityInfo[modelName] = await window.api.ollama.evaluateModelCompatibility(modelName);
    }
    return modelCompatibilityInfo[modelName];
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
      
      // Add models to dropdown
      modelData.forEach(({ name, compatibility }) => {
        const option = document.createElement('option');
        option.value = name;
        
        let displayText = name;
        
        // Add compatibility indicator
        if (compatibility.comfortLevel === 'Easy') {
          displayText += ' ✓';
        } else if (compatibility.comfortLevel === 'Difficult') {
          displayText += ' ⚠️';
        } else if (compatibility.comfortLevel === 'Impossible') {
          displayText += ' ❌';
        }
        
        option.textContent = displayText;
        
        // Set tooltip with compatibility message
        option.title = compatibility.message;
        
        // Add data attributes for compatibility info
        option.dataset.comfortLevel = compatibility.comfortLevel;
        
        modelSelect.appendChild(option);
      });
      
      // Restore selection or use first model
      if (currentSelection && models.includes(currentSelection)) {
        modelSelect.value = currentSelection;
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

// Update compatibility info display
async function updateModelCompatibilityDisplay(modelName) {
  // Get compatibility info if not already available
  const compatInfo = await evaluateModelCompatibility(modelName);
  
  // Update model status display if it exists
  const modelStatusElement = document.getElementById('model-status');
  if (modelStatusElement) {
    // Remove previous classes
    modelStatusElement.classList.remove('easy', 'difficult', 'impossible');
    // Add new class
    modelStatusElement.classList.add(compatInfo.comfortLevel.toLowerCase());
    // Update message
    modelStatusElement.textContent = compatInfo.message;
    // Make sure it's visible
    modelStatusElement.style.display = 'inline-block';
  }
  
  console.log(`Updated model compatibility display for ${modelName}: ${compatInfo.comfortLevel}`);
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
    
    // Add system message prompting for feedback
    addSystemMessage("Your report is ready. Please provide any feedback to improve it.");
    
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

// Generate initial report with clarification questions
async function generateInitialReport(notes) {
  // Show loading message
  const loadingId = addLoadingMessage();
  
  try {
    const reportPrompt = `
# Medical Note to Letter Transformation

You are an experienced physiotherapist writing to a referring colleague. Transform these clinical notes into a professional letter while maintaining the natural, collegial tone used between experienced healthcare professionals.

Clinical Notes to Transform:
${notes}

Please write a professional letter following these guidelines:

1. Tone & Style
- Write as one colleague to another - professional but personable
- Maintain clinical precision while avoiding overly formal language
- Use natural transitions between topics
- Express clinical reasoning conversationally

2. Structure
- Begin with brief thanks for referral
- Weave history, findings and reasoning naturally
- Use paragraph breaks for readability
- End with clear follow-up plans

3. Content Requirements
- Transform clinical shorthand to full terms
- Present findings in a narrative flow
- Maintain all specific measurements and clinical terminology
- Include lifestyle/functional context where relevant

Letter Framework:
Dear [Name],

Thanks for the kind referral of [Patient] for [primary presentation].

[Brief acknowledgment of known history]

[Integrated examination findings and clinical reasoning]

[Management approach and rationale]

[Follow-up plans and timeline]

Yours sincerely,
[Name]
`;

    const response = await window.api.ollama.generateConversationalResponse(reportPrompt);
    
    // Remove loading message
    removeLoadingMessage(loadingId);
    
    if (response) {
      // Try to extract patient name from report
      const patientNameMatch = response.match(/Patient(?:\sName)?:\s*([A-Za-z\s]+)(?:,|\n|$)/i);
      if (patientNameMatch && patientNameMatch[1]) {
        currentSession.patientName = patientNameMatch[1].trim();
        updateSessionInSidebar();
      }
      
      // Add the report to the conversation
      addMessageToUI('report', response);
      
      // Add to session
      currentSession.messages.push({
        role: 'assistant',
        content: response,
        timestamp: new Date().toISOString(),
        isReport: true
      });
      
      // Update current report index
      currentSession.currentReportIndex = currentSession.messages.length - 1;
      
      // Generate clarification questions
      generateClarificationQuestions(notes, response);
    } else {
      addErrorMessage("Failed to generate report. Please check if Ollama is running.");
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
  const loadingId = addLoadingMessage();
  
  try {
    const questions = await window.api.ollama.generateClarificationQuestions(notes, reportText);
    
    // Remove loading message
    removeLoadingMessage(loadingId);
    
    if (questions && questions.length > 0) {
      // Add a message indicating we have questions
      addSystemMessage("I have some clarification questions that may help improve this report:");
      
      // Create HTML for questions
      const questionsHtml = `
        <div class="clarification-questions">
          <h4>Clarification Questions:</h4>
          <ul>
            ${questions.map(q => `<li>${q.replace(/^\d+\.\s*/, '')}</li>`).join('')}
          </ul>
          <div class="clarification-actions">
            <button class="secondary-button small-button answer-questions-btn">
              <i class="fa-solid fa-reply"></i> Answer Questions
            </button>
          </div>
        </div>
      `;
      
      // Add the questions to UI
      const questionsDiv = document.createElement('div');
      questionsDiv.className = 'message questions-message';
      questionsDiv.innerHTML = `
        <div class="message-content">${questionsHtml}</div>
        <div class="message-timestamp">${formatTimestamp(new Date())}</div>
      `;
      
      // Add event listener for the answer button
      const answerBtn = questionsDiv.querySelector('.answer-questions-btn');
      if (answerBtn) {
        answerBtn.addEventListener('click', () => {
          showAnswerQuestionsDialog(questions);
        });
      }
      
      conversationHistory.appendChild(questionsDiv);
      scrollToBottom();
      
      // Store questions in the session
      currentSession.messages.push({
        role: 'system',
        content: 'CLARIFICATION QUESTIONS:\n' + questions.join('\n'),
        timestamp: new Date().toISOString(),
        isQuestions: true,
        questions: questions
      });
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
  const loadingId = addLoadingMessage();
  
  try {
    // Get the original notes
    let initialNotes = '';
    if (currentSession.messages.length > 0 && currentSession.messages[0].role === 'user') {
      initialNotes = currentSession.messages[0].content;
    }
    
    // Generate updated report
    const updatedReport = await window.api.ollama.generateReportWithClarifications(initialNotes, answers);
    
    // Remove loading message
    removeLoadingMessage(loadingId);
    
    if (updatedReport) {
      // Add the updated report to the conversation
      addMessageToUI('report', updatedReport);
      
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
      addErrorMessage("Failed to generate updated report.");
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
  const loadingId = addLoadingMessage();
  
  try {
    // Build prompt from conversation history
    const prompt = buildConversationPrompt();
    
    const response = await window.api.ollama.generateConversationalResponse(prompt);
    
    // Remove loading message
    removeLoadingMessage(loadingId);
    
    if (response) {
      // Add the response to the conversation
      addMessageToUI('report', response);
      
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
function buildConversationPrompt() {
  let initialNotes = '';
  
  // Find the first user message (clinical notes)
  if (currentSession.messages.length > 0 && currentSession.messages[0].role === 'user') {
    initialNotes = currentSession.messages[0].content;
  }
  
  let prompt = `
You are a physiotherapy assistant helping to convert clinical notes into a professional report.
Your task is to create or update a physiotherapy report based on the following information.

Original clinical notes:
${initialNotes}

The report should include:
1. Patient information (extract from notes)
2. Assessment summary
3. Treatment provided
4. Recommendations
5. Follow-up plan

Conversation history:
`;

  // Add conversation history, skipping the first message (already included as notes)
  for (let i = 1; i < currentSession.messages.length; i++) {
    const message = currentSession.messages[i];
    prompt += `\n${message.role.toUpperCase()}: ${message.content}\n`;
  }
  
  prompt += `
Based on the above conversation and feedback, please provide an updated physiotherapy report.
IMPORTANT: Respond ONLY with the final report text. Do not include any explanations, your reasoning process, or any text outside the report itself.
`;

  return prompt;
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
  } catch (error) {
    console.error('Load sessions error:', error);
    sessionsList.innerHTML = '<div class="error-message">Failed to load sessions</div>';
  }
}

function addSessionToSidebar(session) {
  const sessionItem = document.createElement('div');
  sessionItem.className = 'session-item';
  sessionItem.dataset.id = session.id;
  
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
  
  // Add event listeners
  sessionItem.addEventListener('click', (e) => {
    if (!e.target.closest('.delete-session-btn')) {
      loadSession(session.id);
    }
  });
  
  const deleteBtn = sessionItem.querySelector('.delete-session-btn');
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showDeleteConfirmation(session.id, session.title || session.patientName || 'this session');
  });
  
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
    
    const titlePrompt = `
You are helping to generate a short, descriptive title for a physiotherapy session.
Based on the following information, create a concise title (3-5 words) that summarizes the key issue or treatment:

PATIENT NOTES:
${initialNotes.substring(0, 500)}

REPORT EXCERPT:
${firstReport.substring(0, 300)}

Reply ONLY with the title, nothing else. Keep it short and specific to the condition or treatment.
Do not include any explanatory text, thinking process, or tags like <thinking>.
The title must be 30 characters or less to fit in a menu.
`;

    const title = await window.api.ollama.generateConversationalResponse(titlePrompt);
    
    if (title && title.length > 0) {
      // Clean up title - remove quotes, tags, and limit length
      let cleanTitle = title.replace(/["']/g, '').trim();
      // Remove any <thinking> tags and their content
      cleanTitle = cleanTitle.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
      // Remove any other tags
      cleanTitle = cleanTitle.replace(/<[^>]*>/g, '');
      // Ensure title is brief enough for sidebar (max 30 chars)
      cleanTitle = cleanTitle.substring(0, 30);
      currentSession.title = cleanTitle;
      updateSessionInSidebar();
      
      // Schedule autosave to persist the title
      scheduleAutosave();
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
  // Clear conversation history
  conversationHistory.innerHTML = '';
  
  // Add initial system message
  addSystemMessage('Enter clinical notes to generate a report');
  
  // Reset session
  currentSession = {
    id: null,
    title: null,
    patientName: null,
    model: modelSelect.value,
    messages: [],
    currentReportIndex: -1,
    isInitialMessage: true,
    lastSaved: null
  };
  
  // Reset active session in sidebar
  document.querySelectorAll('.session-item').forEach(item => {
    item.classList.remove('active');
  });
  
  // Autosave the new session
  saveSession();
}

async function saveSession() {
  // Don't save empty sessions
  if (currentSession.messages.length === 0) return;
  
  try {
    const timestamp = new Date().toISOString();
    const sessionData = {
      ...currentSession,
      savedAt: timestamp
    };
    
    const result = await window.api.sessions.save(sessionData);
    if (result.success) {
      currentSession.id = result.id || currentSession.id;
      currentSession.lastSaved = timestamp;
      
      // If this is first save, add to sidebar
      if (!document.querySelector(`.session-item[data-id="${currentSession.id}"]`)) {
        const sessionInfo = {
          id: currentSession.id,
          title: currentSession.title,
          patientName: currentSession.patientName,
          savedAt: timestamp
        };
        addSessionToSidebar(sessionInfo);
      } else {
        updateSessionInSidebar();
      }
      
      // Mark as active
      document.querySelectorAll('.session-item').forEach(item => {
        item.classList.remove('active');
      });
      const activeItem = document.querySelector(`.session-item[data-id="${currentSession.id}"]`);
      if (activeItem) {
        activeItem.classList.add('active');
      }
    }
  } catch (error) {
    console.error('Save session error:', error);
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
  try {
    await window.api.sessions.delete(sessionId);
    
    // Remove from sidebar
    const sessionElement = document.querySelector(`.session-item[data-id="${sessionId}"]`);
    if (sessionElement) {
      sessionElement.remove();
    }
    
    // If we deleted the current session, start a new one
    if (currentSession.id === sessionId) {
      startNewSession();
    }
    
    // Check if there are any sessions left
    if (sessionsList.children.length === 0) {
      sessionsList.innerHTML = '<div class="empty-state">No saved sessions</div>';
    }
    
    showToast('Session deleted');
  } catch (error) {
    console.error('Delete session error:', error);
    showToast('Failed to delete session', true);
  }
}

function showDeleteConfirmation(sessionId, sessionName) {
  modalTitle.textContent = 'Delete Session';
  modalMessage.textContent = `Are you sure you want to delete "${sessionName}"? This action cannot be undone.`;
  
  // Set up confirm action
  confirmModalBtn.onclick = () => {
    deleteSession(sessionId);
    confirmModal.classList.add('hidden');
  };
  
  // Show modal
  confirmModal.classList.remove('hidden');
}

// UI helper functions
function addMessageToUI(type, content) {
  const messageDiv = document.createElement('div');
  messageDiv.className = type === 'user' ? 'message user-message' : 
                         type === 'report' ? 'message report-message' : 
                         type === 'questions' ? 'message questions-message' :
                         'message system-message';
  
  if (type === 'report') {
    messageDiv.innerHTML = `
      <div class="message-content">${formatReport(content)}</div>
      <div class="message-timestamp">${formatTimestamp(new Date())}</div>
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
    messageDiv.querySelector('.copy-btn').addEventListener('click', () => {
      copyReportToClipboard(content);
    });
    
    messageDiv.querySelector('.export-btn').addEventListener('click', () => {
      exportReport(content);
    });
  } else if (type === 'questions') {
    // For pre-formatted question content (HTML)
    messageDiv.innerHTML = `
      <div class="message-content">${content}</div>
      <div class="message-timestamp">${formatTimestamp(new Date())}</div>
    `;
    
    // Add event listeners for any answer buttons within the content
    const answerBtn = messageDiv.querySelector('.answer-questions-btn');
    if (answerBtn) {
      // Extract questions from the content
      const questions = [];
      const questionItems = messageDiv.querySelectorAll('.clarification-questions li');
      questionItems.forEach(item => {
        questions.push(item.textContent.trim());
      });
      
      answerBtn.addEventListener('click', () => {
        showAnswerQuestionsDialog(questions);
      });
    }
  } else {
    messageDiv.innerHTML = `
      <div class="message-content">${content.replace(/\n/g, '<br>')}</div>
      <div class="message-timestamp">${formatTimestamp(new Date())}</div>
    `;
  }
  
  conversationHistory.appendChild(messageDiv);
  scrollToBottom();
}

function addSystemMessage(content) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message system-message';
  messageDiv.innerHTML = `
    <div class="message-content">${content}</div>
  `;
  
  conversationHistory.appendChild(messageDiv);
  
  // Add to session messages
  currentSession.messages.push({
    role: 'system',
    content: content,
    timestamp: new Date().toISOString()
  });
  
  scrollToBottom();
}

async function addLoadingMessage() {
  const loadingId = 'loading-' + Date.now();
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'message system-message loading';
  loadingDiv.id = loadingId;
  
  // Check model compatibility for custom loading message
  const compatibility = await evaluateModelCompatibility(currentSession.model);
  
  if (compatibility.comfortLevel === 'Difficult' && compatibility.loadingMessage) {
    // For difficult models, show tea message with animated SVG
    loadingDiv.innerHTML = `
      <div class="loading-tea">
        <div class="tea-animation">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="80" height="80">
            <!-- Tea cup -->
            <g>
              <path d="M20,40 L80,40 L70,80 L30,80 Z" fill="#fff" stroke="#333" stroke-width="2"/>
              <path d="M25,40 L75,40 L67,75 L33,75 Z" fill="#f9d5ba" stroke="none">
                <animate attributeName="fill" values="#f9d5ba;#d4a76a;#f9d5ba" dur="3s" repeatCount="indefinite" />
              </path>
              
              <!-- Tea handle -->
              <path d="M78,50 Q90,50 90,60 Q90,70 80,70" fill="none" stroke="#333" stroke-width="2"/>
              
              <!-- Steam animation -->
              <path d="M40,30 Q45,20 50,30 Q55,20 60,30" fill="none" stroke="#aaa" stroke-width="2" opacity="0.7">
                <animate attributeName="d" values="M40,30 Q45,20 50,30 Q55,20 60,30;M40,20 Q45,10 50,20 Q55,10 60,20;M40,30 Q45,20 50,30 Q55,20 60,30" dur="3s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.7;0.3;0.7" dur="3s" repeatCount="indefinite" />
              </path>
              
              <path d="M35,25 Q40,15 45,25" fill="none" stroke="#aaa" stroke-width="1.5" opacity="0.5">
                <animate attributeName="d" values="M35,25 Q40,15 45,25;M35,15 Q40,5 45,15;M35,25 Q40,15 45,25" dur="2.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.5;0.2;0.5" dur="2.5s" repeatCount="indefinite" />
              </path>
              
              <path d="M55,25 Q60,15 65,25" fill="none" stroke="#aaa" stroke-width="1.5" opacity="0.5">
                <animate attributeName="d" values="M55,25 Q60,15 65,25;M55,15 Q60,5 65,15;M55,25 Q60,15 65,25" dur="2.8s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.5;0.2;0.5" dur="2.8s" repeatCount="indefinite" />
              </path>
            </g>
          </svg>
        </div>
        <p>${compatibility.loadingMessage}</p>
      </div>
    `;
  } else {
    // Default loading message
    loadingDiv.textContent = 'Generating response...';
  }
  
  conversationHistory.appendChild(loadingDiv);
  scrollToBottom();
  
  return loadingId;
}

function removeLoadingMessage(id) {
  const loadingElement = document.getElementById(id);
  if (loadingElement) {
    loadingElement.remove();
  }
}

function addErrorMessage(errorText) {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-message';
  errorDiv.textContent = errorText;
  
  conversationHistory.appendChild(errorDiv);
  scrollToBottom();
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
      if (!inList || inList !== 'ol') {
        if (inList) formattedHtml += inList === 'ul' ? '</ul>' : '';
        formattedHtml += '<ol>';
        inList = 'ol';
      }
      formattedHtml += `<li>${line.replace(/^\d+\.\s/, '')}</li>`;
    } else if (line.startsWith('- ')) {
      if (!inList || inList !== 'ul') {
        if (inList) formattedHtml += inList === 'ol' ? '</ol>' : '';
        formattedHtml += '<ul>';
        inList = 'ul';
      }
      formattedHtml += `<li>${line.substring(2)}</li>`;
    }
    // Close list if needed
    else if (inList && line.trim() === '') {
      formattedHtml += inList === 'ol' ? '</ol>' : '</ul>';
      inList = false;
      formattedHtml += '<p></p>';
    }
    // Regular paragraph
    else {
      if (inList && line.trim() !== '') {
        formattedHtml += inList === 'ol' ? '</ol>' : '</ul>';
        inList = false;
      }
      
      if (line.trim() !== '') {
        formattedHtml += `<p>${line}</p>`;
      } else if (formattedHtml && !formattedHtml.endsWith('<p></p>')) {
        formattedHtml += '<p></p>';
      }
    }
  }
  
  // Close any remaining lists
  if (inList) {
    formattedHtml += inList === 'ol' ? '</ol>' : '</ul>';
  }
  
  return formattedHtml;
}

// Copy report to clipboard
async function copyReportToClipboard(reportText) {
  try {
    // Strip HTML if present
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = reportText;
    const textToCopy = tempDiv.textContent || tempDiv.innerText || reportText;
    
    await navigator.clipboard.writeText(textToCopy);
    showToast('Report copied to clipboard');
  } catch (error) {
    console.error('Failed to copy:', error);
    showToast('Failed to copy report', true);
  }
}

// Export report
async function exportReport(reportText) {
  // Try to get patient name for filename
  let suggestedName = 'physiotherapy-report.txt';
  if (currentSession.patientName) {
    suggestedName = `${currentSession.patientName.replace(/\s+/g, '_')}_report.txt`;
  }
  
// Strip HTML if present
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = reportText;
  const textToExport = tempDiv.textContent || tempDiv.innerText || reportText;
  
  try {
    const success = await window.api.files.saveReport(textToExport, suggestedName);
    if (success) {
      showToast('Report exported successfully');
    }
  } catch (error) {
    console.error('Failed to export report:', error);
    showToast('Failed to export report', true);
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
function toggleSidebar() {
  sidebar.classList.toggle('open');
}

// Modal functions
function hideModal() {
  confirmModal.classList.add('hidden');
}

// Info Modal
const infoBtn = document.getElementById('info-btn');
const infoModal = document.getElementById('info-modal');
const closeInfoModalBtn = document.getElementById('close-info-modal-btn');
const infoContent = document.getElementById('info-content');
const introTab = document.getElementById('intro-tab');
const disclaimerTab = document.getElementById('disclaimer-tab');

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

function showInfoModal(tabName = 'intro') {
  infoModal.classList.remove('hidden');
  
  // Set active tab
  introTab.classList.remove('active');
  disclaimerTab.classList.remove('active');
  
  if (tabName === 'intro') {
    introTab.classList.add('active');
    loadDocContent('intro.txt').then(content => {
      infoContent.textContent = content;
    });
  } else if (tabName === 'disclaimer') {
    disclaimerTab.classList.add('active');
    loadDocContent('disclaimer.txt').then(content => {
      infoContent.textContent = content;
    });
  }
}

function hideInfoModal() {
  infoModal.classList.add('hidden');
}

// Event listeners
document.addEventListener('DOMContentLoaded', initializeApp);

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
newSessionBtn.addEventListener('click', startNewSession);

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
  const newModel = modelSelect.value;
  currentSession.model = newModel;
  window.api.ollama.setModel(newModel);
  
  // Update compatibility info display
  await updateModelCompatibilityDisplay(newModel);
  
  scheduleAutosave();
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