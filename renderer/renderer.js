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
    // Get all sessions
    const sessions = await window.api.sessions.loadList();
    
    // Find empty/problematic sessions
    const problematicSessions = sessions.filter(session => {
      return !session.title && !session.patientName;
    });
    
    console.log(`Found ${problematicSessions.length} potentially problematic sessions`);
    
    // Delete them
    for (const session of problematicSessions) {
      console.log(`Cleaning up empty session: ${session.id}`);
      try {
        await window.api.sessions.delete(session.id);
      } catch (err) {
        console.error(`Failed to delete problematic session ${session.id}:`, err);
      }
    }
    
    console.log('Cleanup complete');
    return problematicSessions.length > 0;
  } catch (error) {
    console.error('Error during cleanup:', error);
    return false;
  }
}

// Initialize app
async function initializeApp() {
  console.log('Initializing app...');
  
  // Verify DOM elements are correctly loaded
  console.log('DOM Elements check:');
  console.log('- newSessionBtn:', newSessionBtn);
  console.log('- sidebar:', sidebar);
  console.log('- sessionsList:', sessionsList);
  
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
    console.log('No saved sessions found or cleanup performed, starting new session');
    startNewSession();
  } else {
    // Try to load most recent session
    const latestSession = sessionsList.querySelector('.session-item');
    console.log('Found latest session:', latestSession);
    if (latestSession) {
      await loadSession(latestSession.dataset.id);
    }
  }
  
  // Re-attach event listener to ensure it works
  console.log('Re-attaching newSessionBtn event listener');
  newSessionBtn.addEventListener('click', (event) => {
    console.log('New Session button clicked (re-attached listener) - event:', event.type);
    startNewSession();
  });
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
        
        // Build a more descriptive label with status included
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
  // Function kept for compatibility, but doesn't update any UI elements now
  console.log('Model compatibility info:', compatInfo);
}

// Update compatibility info display
async function updateModelCompatibilityDisplay(modelName) {
  try {
    // Get compatibility info from cache or evaluate if needed
    const compatInfo = await evaluateModelCompatibility(modelName);
    updateModelStatusDisplay(compatInfo);
    console.log(`Updated model compatibility display for ${modelName}: ${compatInfo.comfortLevel}`);
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
    // Use the generateReport method which already uses the configured prompt file
    const response = await window.api.ollama.generateReport(notes);
    
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
      addSystemMessage("I have some questions that may help improve this report:");
      
      // Create HTML for questions
      const questionsHtml = `
        <div class="clarification-questions">
          <h4>Clarification Questions:</h4>
          <ul>
            ${questions.map(q => `<li>${q.replace(/^\d+\.\s*/, '')}</li>`).join('')}
          </ul>
          <div class="clarification-actions">
            <button class="secondary-button small-button answer-questions-btn" style="background-color: #f0ebff; color: #6B3FA0; border-color: #d4c6ff;">
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
    const prompt = await buildConversationPrompt();
    
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
  if (deleteBtn) {
    // Add a more visible style to the delete button to ensure it's clickable
    deleteBtn.style.cursor = 'pointer';
    deleteBtn.style.padding = '8px';
    deleteBtn.style.backgroundColor = '#f8e5e5';
    deleteBtn.style.borderRadius = '4px';
    deleteBtn.style.zIndex = '100';
    
    // Add both click and mousedown events to ensure it registers
    const handleDeleteClick = (e) => {
      console.log('Delete button clicked for session:', session.id);
      e.stopPropagation();
      e.preventDefault();
      
      // Directly delete problematic empty sessions
      if (!session.title && !session.patientName && (!session.messages || session.messages.length === 0)) {
        console.log('Detected empty session, deleting directly without confirmation');
        deleteSession(session.id);
      } else {
        // Regular confirmation for non-empty sessions
        showDeleteConfirmation(session.id, session.title || session.patientName || 'this session');
      }
      
      return false;
    };
    
    deleteBtn.addEventListener('click', handleDeleteClick);
    deleteBtn.addEventListener('mousedown', handleDeleteClick);
  } else {
    console.error('Delete button not found in session item');
  }
  
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
  console.log('Starting new session...');
  
  try {
    // Clear conversation history
    conversationHistory.innerHTML = '';
    
    // Add initial system message
    console.log('Adding system message');
    addSystemMessage('Enter clinical notes to generate a report');
    
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
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM fully loaded');
  initializeApp();
  
  // Add debug button listener
  setTimeout(() => {
    const debugBtn = document.getElementById('debug-new-session');
    if (debugBtn) {
      console.log('Debug button found, attaching listener');
      debugBtn.addEventListener('click', (e) => {
        console.log('Debug new session button clicked');
        startNewSession();
      });
    } else {
      console.error('Debug button not found in DOM');
    }
  }, 1000); // Delay to ensure DOM is fully loaded
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
// Replace the existing event listener with a direct function reference 
// for simpler debugging and potentially avoiding any event propagation issues
if (newSessionBtn) {
  console.log('Adding event listener to newSessionBtn directly');
  
  // Remove any existing event listeners by cloning the node
  const newBtn = newSessionBtn.cloneNode(true);
  newSessionBtn.parentNode.replaceChild(newBtn, newSessionBtn);
  
  // Get the new DOM element reference
  const newSessionBtnRef = document.getElementById('new-session-btn');
  
  // Add the new event listener to the new reference
  newSessionBtnRef.onclick = function(event) {
    event.preventDefault();
    event.stopPropagation();
    console.log('New Session button clicked (direct onclick handler)');
    
    try {
      startNewSession();
    } catch (error) {
      console.error('Error in startNewSession:', error);
      alert('Error creating new session: ' + error.message);
    }
    
    return false; // Prevent default and stop propagation
  };
} else {
  console.error('newSessionBtn is null or undefined - cannot attach click handler');
}

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