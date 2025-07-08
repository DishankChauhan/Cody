from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import openai
import os
from dotenv import load_dotenv
import chromadb
from chromadb.utils import embedding_functions
import subprocess
import sys
from typing import List, Optional, Dict, Any
import re
import logging
from contextlib import asynccontextmanager
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO if os.getenv("DEBUG", "false").lower() == "true" else logging.WARNING,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Rate limiter
limiter = Limiter(key_func=get_remote_address)

# Input validation and security functions
def sanitize_input(text: str, max_length: int = 10000) -> str:
    """Sanitize and validate user input"""
    if not text:
        return ""
    
    if len(text) > max_length:
        raise HTTPException(status_code=400, detail=f"Input too long (max {max_length} characters)")
    
    # Remove potential harmful content
    text = text.strip()
    
    # Basic injection prevention - remove suspicious patterns
    suspicious_patterns = [
        r'<script[^>]*>.*?</script>',
        r'javascript:',
        r'vbscript:',
        r'onload\s*=',
        r'onerror\s*=',
    ]
    
    for pattern in suspicious_patterns:
        text = re.sub(pattern, '', text, flags=re.IGNORECASE | re.DOTALL)
    
    return text

def mask_api_key(key: str) -> str:
    """Mask API key for logging"""
    if not key or len(key) < 8:
        return "****"
    return key[:4] + "****" + key[-4:]

def validate_file_path(file_path: str) -> str:
    """Validate and sanitize file paths"""
    if not file_path:
        return ""
    
    # Remove potentially dangerous path components
    file_path = file_path.replace("../", "").replace("..\\", "")
    file_path = file_path.replace("~/", "").replace("~\\", "")
    
    # Ensure it's a relative path
    if os.path.isabs(file_path):
        file_path = os.path.relpath(file_path)
    
    return file_path

# Configuration class
class Config:
    # Server configuration
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"
    
    # OpenAI configuration
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    OPENAI_MODEL_GENERATE: str = os.getenv("OPENAI_MODEL_GENERATE", "gpt-4o")
    OPENAI_MODEL_CHAT: str = os.getenv("OPENAI_MODEL_CHAT", "gpt-3.5-turbo")
    OPENAI_MODEL_EMBEDDING: str = os.getenv("OPENAI_MODEL_EMBEDDING", "text-embedding-3-small")
    OPENAI_MAX_TOKENS: int = int(os.getenv("OPENAI_MAX_TOKENS", "1000"))
    OPENAI_TEMPERATURE: float = float(os.getenv("OPENAI_TEMPERATURE", "0.7"))
    
    # ChromaDB configuration
    CHROMADB_PATH: str = os.getenv("CHROMADB_PATH", "./cody_chroma_db")
    
    # CORS configuration
    CORS_ORIGINS: List[str] = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173,vscode-webview://").split(",")

    @classmethod
    def validate(cls):
        """Validate required configuration"""
        if not cls.OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY environment variable is required")
        
        logger.info(f"Configuration loaded - Host: {cls.HOST}:{cls.PORT}, Debug: {cls.DEBUG}, API Key: {mask_api_key(cls.OPENAI_API_KEY)}")

# Validate configuration on startup
Config.validate()

# Global variables for database
client = None
code_collection = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle startup and shutdown events"""
    global client, code_collection
    
    try:
        # Initialize ChromaDB
        logger.info(f"Initializing ChromaDB at {Config.CHROMADB_PATH}")
        client = chromadb.PersistentClient(path=Config.CHROMADB_PATH)
        
        openai_ef = embedding_functions.OpenAIEmbeddingFunction(
            api_key=Config.OPENAI_API_KEY,
            model_name=Config.OPENAI_MODEL_EMBEDDING
        )
        
        code_collection = client.get_or_create_collection(
            name="codebase",
            embedding_function=openai_ef
        )
        
        logger.info(f"ChromaDB initialized with {code_collection.count()} documents")
        
        # Initialize OpenAI client
        openai.api_key = Config.OPENAI_API_KEY
        
        logger.info("Cody backend started successfully")
        yield
        
    except Exception as e:
        logger.error(f"Failed to initialize backend: {e}")
        raise
    finally:
        logger.info("Cody backend shutting down")

# Create FastAPI app with lifespan
app = FastAPI(
    title="Cody AI Backend",
    description="Backend service for Cody AI Code Assistant",
    version="1.0.0",
    lifespan=lifespan
)

# Add rate limiter to app
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=Config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

openai.api_key = Config.OPENAI_API_KEY

class GenerateRequest(BaseModel):
    prompt: str
    language: str
    context: str | None = None # Code selected by the user in the editor

class CodeEdit(BaseModel):
    file: str
    range: Dict[str, Dict[str, int]]
    newText: str

class ChatMessage(BaseModel):
    role: str
    content: str
    timestamp: str

class ChatResponse(BaseModel):
    response: str
    codeEdits: Optional[List[CodeEdit]] = None

class ChatRequest(BaseModel):
    prompt: str
    language: str
    context: str | None = None
    history: List[ChatMessage] = []
    includeCodeEdits: bool = False
    currentFile: str | None = None  # Current file being edited

class BugFixRequest(BaseModel):
    code: str
    errorMessage: str
    language: str

class ReindexRequest(BaseModel):
    projectPath: str

def parse_code_edits(response: str, current_file: str | None) -> tuple[str, List[CodeEdit]]:
    """
    Parse code edits from AI response.
    Returns tuple of (cleaned_response, list of code edits)
    """
    try:
        code_edits = []
        cleaned_response = response

        # Pattern for code edit blocks - handle both filled and empty filenames
        edit_pattern = r"```edit:(\S*)\n(.*?)```"
        
        # Find all code edit blocks
        matches = re.finditer(edit_pattern, response, re.DOTALL)
        
        for match in matches:
            file_path = match.group(1) if match.group(1) else current_file
            if not file_path:
                continue
            
            # Validate and sanitize file path
            file_path = validate_file_path(file_path)
            if not file_path:
                continue
                
            edit_content = match.group(2).strip()
            
            # Sanitize edit content
            edit_content = sanitize_input(edit_content, max_length=50000)  # Large limit for code
            
            # Basic edit with full file content
            edit = CodeEdit(
                file=file_path,
                range={
                    "start": {"line": 0, "character": 0},
                    "end": {"line": 999999, "character": 999999}  # Will be truncated to file length
                },
                newText=edit_content
            )
            code_edits.append(edit)
            
            # Remove the edit block from response
            cleaned_response = cleaned_response.replace(match.group(0), "")
        
        return cleaned_response.strip(), code_edits
    except Exception as e:
        logger.error(f"Error parsing code edits: {e}")
        return response, []

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Cody AI Backend",
        "version": "1.0.0",
        "documents_indexed": code_collection.count() if code_collection else 0
    }

@app.get("/health")
async def health_check():
    """Detailed health check"""
    try:
        # Check ChromaDB connection
        doc_count = code_collection.count() if code_collection else 0
        
        # Check OpenAI API key
        api_key_valid = bool(Config.OPENAI_API_KEY and len(Config.OPENAI_API_KEY) > 10)
        
        return {
            "status": "healthy",
            "components": {
                "chromadb": {"status": "healthy", "documents": doc_count},
                "openai": {"status": "healthy" if api_key_valid else "error", "configured": api_key_valid}
            }
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(status_code=500, detail=f"Health check failed: {str(e)}")

@app.post("/generate")
@limiter.limit("20/minute")  # 20 requests per minute for code generation
async def generate_code(request: Request, generate_request: GenerateRequest):
    """Generate code based on prompt and context"""
    try:
        # Validate and sanitize inputs
        prompt = sanitize_input(generate_request.prompt, max_length=5000)
        context = sanitize_input(generate_request.context or "", max_length=10000)
        language = sanitize_input(generate_request.language, max_length=50)
        
        if not prompt:
            raise HTTPException(status_code=400, detail="Prompt is required")
        
        logger.info(f"Generate code request for language: {language}")
        
        # Query vector database for relevant context
        retrieved_context = ""
        try:
            if code_collection:
                retrieved_results = code_collection.query(
                    query_texts=[prompt],
                    n_results=3,
                )
                retrieved_context = "\n---\n".join(retrieved_results['documents'][0])
        except Exception as e:
            logger.warning(f"ChromaDB query failed: {e}")

        # Build system message
        system_message = f"You are an expert {language} programmer. Write clean, elegant, and efficient code. Do not include any explanations or markdown formatting, just the raw code."
        
        # Build user message
        user_message_parts = []
        
        if retrieved_context:
            user_message_parts.append("Given the following relevant code from the codebase as context:\n\n---\n" + retrieved_context + "\n---")

        if context:
            user_message_parts.append("And given this specific code I have selected:\n\n---\n" + context + "\n---")

        user_message_parts.append(f"Please fulfill the following request: {prompt}")
        user_message = "\n\n".join(user_message_parts)

        # Handle explanation requests differently
        if "explain" in prompt.lower():
            system_message = "You are an expert code explainer. Provide a clear, concise, and easy-to-understand explanation of the code. Structure your answer with clear headings for 'Purpose', 'Inputs', and 'Outputs'. Do not return any code or markdown formatting."

        # Make OpenAI API call
        completion = openai.chat.completions.create(
            model=Config.OPENAI_MODEL_GENERATE,
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_message}
            ]
        )
        
        return {"code": completion.choices[0].message.content}
        
    except HTTPException:
        # Re-raise HTTPException as-is (for validation errors)
        raise
    except Exception as e:
        logger.error(f"Generate code failed: {e}")
        raise HTTPException(status_code=500, detail=f"Code generation failed: {str(e)}")

@app.post("/chat")
@limiter.limit("15/minute")  # 15 requests per minute for chat
async def chat_with_cody(request: Request, chat_request: ChatRequest):
    """
    Interactive chat endpoint that maintains conversation history and supports code editing
    """
    try:
        # Validate and sanitize inputs
        prompt = sanitize_input(chat_request.prompt, max_length=5000)
        context = sanitize_input(chat_request.context or "", max_length=10000)
        language = sanitize_input(chat_request.language, max_length=50)
        current_file = validate_file_path(chat_request.currentFile or "")
        
        if not prompt:
            raise HTTPException(status_code=400, detail="Prompt is required")
        
        logger.info(f"Chat request for language: {language}")
        
        # Query vector database for relevant context
        retrieved_context = ""
        try:
            if code_collection:
                retrieved_results = code_collection.query(
                    query_texts=[prompt],
                    n_results=3,
                )
                retrieved_context = "\n---\n".join(retrieved_results['documents'][0])
        except Exception as e:
            logger.warning(f"ChromaDB query failed: {e}")

        # Build system message for chat
        system_message = f"""You are Cody, an expert {language} programming assistant. You are having a conversation with a developer.

Key guidelines:
- Be conversational and helpful
- Provide clear, actionable advice
- When showing code, use proper formatting
- Reference previous conversation context when relevant
- Ask clarifying questions if needed
- Be concise but thorough

If you need to edit code, use the following format:
```edit:filepath
// Your code here
```

For example:
```edit:src/main.ts
function hello() {{
    console.log("Hello World");
}}
```

- Only include code that needs to be changed
- Use relative file paths
- If no filepath is specified, changes will apply to the current file
"""

        # Build conversation messages
        messages = [{"role": "system", "content": system_message}]
        
        # Add conversation history (limit to last 10 messages for context)
        for msg in chat_request.history[-10:]:
            # Sanitize history messages
            sanitized_content = sanitize_input(msg.content, max_length=5000)
            messages.append({"role": msg.role, "content": sanitized_content})
        
        # Add context information
        context_parts = []
        if retrieved_context:
            context_parts.append(f"Relevant codebase context:\n---\n{retrieved_context}\n---")
        
        if context:
            context_parts.append(f"Current editor selection:\n---\n{context}\n---")
        
        if current_file:
            context_parts.append(f"Current file being edited: {current_file}")
        
        if context_parts:
            context_message = "\n\n".join(context_parts) + f"\n\nUser request: {prompt}"
        else:
            context_message = prompt
        
        messages.append({"role": "user", "content": context_message})

        # Make OpenAI API call
        completion = openai.chat.completions.create(
            model=Config.OPENAI_MODEL_CHAT,
            messages=messages,
            max_tokens=Config.OPENAI_MAX_TOKENS,
            temperature=Config.OPENAI_TEMPERATURE
        )

        response = completion.choices[0].message.content
        
        # Parse code edits if requested
        if chat_request.includeCodeEdits:
            cleaned_response, code_edits = parse_code_edits(response, current_file)
            return ChatResponse(response=cleaned_response, codeEdits=code_edits)
        
        return ChatResponse(response=response)
        
    except HTTPException:
        # Re-raise HTTPException as-is (for validation errors)
        raise
    except Exception as e:
        logger.error(f"Chat failed: {e}")
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")

@app.post("/fix-bug")
@limiter.limit("10/minute")  # 10 requests per minute for bug fixes
async def fix_bug(request: Request, bug_request: BugFixRequest):
    """
    Automated bug fixing endpoint
    """
    try:
        # Validate and sanitize inputs
        code = sanitize_input(bug_request.code, max_length=20000)  # Larger limit for code
        error_message = sanitize_input(bug_request.errorMessage, max_length=2000)
        language = sanitize_input(bug_request.language, max_length=50)
        
        if not code:
            raise HTTPException(status_code=400, detail="Code is required")
        if not error_message:
            raise HTTPException(status_code=400, detail="Error message is required")
        
        logger.info(f"Bug fix request for language: {language}")
        
        # Query vector database for similar code patterns
        retrieved_context = ""
        try:
            if code_collection:
                retrieved_results = code_collection.query(
                    query_texts=[f"fix {error_message} in {language}"],
                    n_results=3,
                )
                retrieved_context = "\n---\n".join(retrieved_results['documents'][0])
        except Exception as e:
            logger.warning(f"ChromaDB query failed: {e}")

        system_message = f"""You are an expert {language} debugger. Your task is to fix the provided code that has an error.

Guidelines:
- Analyze the error message carefully
- Identify the root cause
- Provide a fixed version of the code
- Keep the same functionality and structure
- Only fix what's necessary
- Return ONLY the corrected code, no explanations"""

        user_message_parts = []
        
        if retrieved_context:
            user_message_parts.append(f"Similar code patterns from the codebase:\n---\n{retrieved_context}\n---")
        
        user_message_parts.append(f"Code with error:\n---\n{code}\n---")
        user_message_parts.append(f"Error message: {error_message}")
        user_message_parts.append("Please provide the fixed code:")
        
        user_message = "\n\n".join(user_message_parts)

        # Make OpenAI API call
        completion = openai.chat.completions.create(
            model=Config.OPENAI_MODEL_GENERATE,
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_message}
            ]
        )
        
        return {"fixedCode": completion.choices[0].message.content}
        
    except HTTPException:
        # Re-raise HTTPException as-is (for validation errors)
        raise
    except Exception as e:
        logger.error(f"Bug fix failed: {e}")
        raise HTTPException(status_code=500, detail=f"Bug fix failed: {str(e)}")

@app.post("/reindex")
@limiter.limit("2/minute")  # 2 requests per minute for reindexing (resource intensive)
async def reindex_project(request: Request, reindex_request: ReindexRequest):
    """
    Re-index the project codebase
    """
    try:
        # Validate and sanitize project path
        project_path = validate_file_path(reindex_request.projectPath)
        if not project_path:
            raise HTTPException(status_code=400, detail="Project path is required")
        
        logger.info(f"Reindexing project: {project_path}")
        
        # Validate project path exists
        if not os.path.exists(project_path):
            raise HTTPException(status_code=400, detail=f"Project path does not exist: {project_path}")
        
        # Run the indexing script
        script_path = os.path.join(os.path.dirname(__file__), "index_codebase.py")
        result = subprocess.run([
            sys.executable, 
            script_path, 
            project_path
        ], capture_output=True, text=True, timeout=300)  # 5 minute timeout
        
        if result.returncode == 0:
            logger.info(f"Project reindexed successfully: {project_path}")
            return {"message": "Project reindexed successfully", "output": result.stdout}
        else:
            logger.error(f"Indexing failed for {project_path}: {result.stderr}")
            raise HTTPException(status_code=500, detail=f"Indexing failed: {result.stderr}")
            
    except subprocess.TimeoutExpired:
        logger.error(f"Indexing timeout for {project_path}")
        raise HTTPException(status_code=500, detail="Indexing timeout - project too large")
    except HTTPException:
        # Re-raise HTTPException as-is (for validation errors)
        raise
    except Exception as e:
        logger.error(f"Reindex failed: {e}")
        raise HTTPException(status_code=500, detail=f"Reindex failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    
    logger.info(f"Starting Cody backend on {Config.HOST}:{Config.PORT}")
    
    uvicorn.run(
        "main:app",
        host=Config.HOST,
        port=Config.PORT,
        reload=Config.DEBUG,
        log_level="info" if Config.DEBUG else "warning"
    ) 