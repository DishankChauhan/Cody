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
from starlette.requests import Request
import hashlib
import json
import time
from datetime import datetime, timedelta
import gc
import psutil
import asyncio
from functools import lru_cache
from cachetools import TTLCache
import weakref

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

# Global caches and optimization
class CacheManager:
    """Centralized cache management with TTL and memory optimization"""
    
    def __init__(self):
        # Response cache with 30 minute TTL
        self.response_cache = TTLCache(maxsize=1000, ttl=1800)
        # Context cache with 1 hour TTL  
        self.context_cache = TTLCache(maxsize=500, ttl=3600)
        # Embedding cache with 24 hour TTL
        self.embedding_cache = TTLCache(maxsize=2000, ttl=86400)
        
        # Weak references to track memory usage
        self._tracked_objects = weakref.WeakSet()
        
    def get_cache_key(self, *args, **kwargs) -> str:
        """Generate a cache key from arguments"""
        key_data = {
            'args': args,
            'kwargs': sorted(kwargs.items()) if kwargs else {}
        }
        key_str = json.dumps(key_data, sort_keys=True, default=str)
        return hashlib.md5(key_str.encode()).hexdigest()
    
    def get_response_cache(self, key: str) -> Optional[Any]:
        """Get cached response"""
        return self.response_cache.get(key)
    
    def set_response_cache(self, key: str, value: Any) -> None:
        """Set cached response"""
        try:
            self.response_cache[key] = value
            logger.debug(f"Cached response for key: {key[:8]}...")
        except Exception as e:
            logger.warning(f"Failed to cache response: {e}")
    
    def get_context_cache(self, key: str) -> Optional[Any]:
        """Get cached context"""
        return self.context_cache.get(key)
    
    def set_context_cache(self, key: str, value: Any) -> None:
        """Set cached context"""
        try:
            self.context_cache[key] = value
            logger.debug(f"Cached context for key: {key[:8]}...")
        except Exception as e:
            logger.warning(f"Failed to cache context: {e}")
    
    def clear_cache(self, cache_type: str = "all") -> None:
        """Clear specific or all caches"""
        if cache_type == "response" or cache_type == "all":
            self.response_cache.clear()
        if cache_type == "context" or cache_type == "all":
            self.context_cache.clear()
        if cache_type == "embedding" or cache_type == "all":
            self.embedding_cache.clear()
        logger.info(f"Cleared {cache_type} cache(s)")
    
    def get_cache_stats(self) -> Dict[str, Any]:
        """Get cache statistics"""
        return {
            "response_cache": {
                "size": len(self.response_cache),
                "maxsize": self.response_cache.maxsize,
                "ttl": self.response_cache.ttl
            },
            "context_cache": {
                "size": len(self.context_cache),
                "maxsize": self.context_cache.maxsize,
                "ttl": self.context_cache.ttl
            },
            "embedding_cache": {
                "size": len(self.embedding_cache),
                "maxsize": self.embedding_cache.maxsize,
                "ttl": self.embedding_cache.ttl
            }
        }

class MemoryManager:
    """Memory management and optimization"""
    
    def __init__(self):
        self.last_gc_time = time.time()
        self.gc_interval = 300  # 5 minutes
        self.memory_threshold = 1024 * 1024 * 1024  # 1GB
        
    def check_memory_usage(self) -> Dict[str, Any]:
        """Check current memory usage"""
        try:
            process = psutil.Process()
            memory_info = process.memory_info()
            memory_percent = process.memory_percent()
            
            return {
                "rss": memory_info.rss,
                "vms": memory_info.vms,
                "percent": memory_percent,
                "available": psutil.virtual_memory().available,
                "threshold_exceeded": memory_info.rss > self.memory_threshold
            }
        except Exception as e:
            logger.warning(f"Failed to get memory info: {e}")
            return {"error": str(e)}
    
    def should_run_gc(self) -> bool:
        """Determine if garbage collection should run"""
        current_time = time.time()
        memory_info = self.check_memory_usage()
        
        # Run GC if interval passed or memory threshold exceeded
        return (
            current_time - self.last_gc_time > self.gc_interval or
            memory_info.get("threshold_exceeded", False)
        )
    
    def run_gc(self) -> Dict[str, Any]:
        """Run garbage collection and return stats"""
        before_objects = len(gc.get_objects())
        before_memory = self.check_memory_usage()
        
        # Run garbage collection
        collected = gc.collect()
        
        after_objects = len(gc.get_objects())
        after_memory = self.check_memory_usage()
        
        self.last_gc_time = time.time()
        
        stats = {
            "collected": collected,
            "objects_before": before_objects,
            "objects_after": after_objects,
            "objects_freed": before_objects - after_objects,
            "memory_before": before_memory.get("rss", 0),
            "memory_after": after_memory.get("rss", 0),
            "memory_freed": before_memory.get("rss", 0) - after_memory.get("rss", 0)
        }
        
        logger.info(f"GC completed: freed {stats['objects_freed']} objects, "
                   f"{stats['memory_freed'] / 1024 / 1024:.2f}MB memory")
        
        return stats

class DatabaseOptimizer:
    """ChromaDB optimization and connection management"""
    
    def __init__(self, client, collection):
        self.client = client
        self.collection = collection
        self.query_cache = TTLCache(maxsize=200, ttl=1800)  # 30 min cache
        self.last_optimization = time.time()
        self.optimization_interval = 3600  # 1 hour
        
    def optimized_query(self, query_texts: List[str], n_results: int = 3, **kwargs) -> Any:
        """Optimized query with caching"""
        # Create cache key
        cache_key = hashlib.md5(
            json.dumps({
                "query_texts": query_texts,
                "n_results": n_results,
                "kwargs": sorted(kwargs.items())
            }, sort_keys=True).encode()
        ).hexdigest()
        
        # Check cache first
        cached_result = self.query_cache.get(cache_key)
        if cached_result is not None:
            logger.debug(f"Cache hit for query: {query_texts[0][:50]}...")
            return cached_result
        
        try:
            # Execute query
            result = self.collection.query(
                query_texts=query_texts,
                n_results=n_results,
                **kwargs
            )
            
            # Cache result
            self.query_cache[cache_key] = result
            logger.debug(f"Cached query result: {query_texts[0][:50]}...")
            
            return result
            
        except Exception as e:
            logger.error(f"Database query failed: {e}")
            return {"documents": [[]], "metadatas": [[]], "distances": [[]]}
    
    def should_optimize(self) -> bool:
        """Check if database optimization should run"""
        return time.time() - self.last_optimization > self.optimization_interval
    
    def optimize_database(self) -> Dict[str, Any]:
        """Run database optimization"""
        try:
            start_time = time.time()
            
            # Get collection stats before optimization
            before_count = self.collection.count()
            
            # Clear query cache to free memory
            cache_size_before = len(self.query_cache)
            self.query_cache.clear()
            
            # Force garbage collection
            gc.collect()
            
            optimization_time = time.time() - start_time
            self.last_optimization = time.time()
            
            stats = {
                "documents_count": before_count,
                "cache_cleared": cache_size_before,
                "optimization_time": optimization_time,
                "timestamp": datetime.now().isoformat()
            }
            
            logger.info(f"Database optimization completed in {optimization_time:.2f}s")
            return stats
            
        except Exception as e:
            logger.error(f"Database optimization failed: {e}")
            return {"error": str(e)}

# Initialize global managers
cache_manager = CacheManager()
memory_manager = MemoryManager()
db_optimizer = None  # Will be initialized after database connection

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
db_optimizer = None
openai_client = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle startup and shutdown events"""
    global client, code_collection, db_optimizer, openai_client
    
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
        
        # Initialize database optimizer
        db_optimizer = DatabaseOptimizer(client, code_collection)
        
        logger.info(f"ChromaDB initialized with {code_collection.count()} documents")
        
        # Initialize OpenAI client (new style for v1.0+)
        openai_client = openai.OpenAI(api_key=Config.OPENAI_API_KEY)
        
        # Start background tasks
        asyncio.create_task(background_maintenance())
        
        logger.info("Cody backend started successfully")
        yield
        
    except Exception as e:
        logger.error(f"Failed to initialize backend: {e}")
        raise
    finally:
        logger.info("Cody backend shutting down")

async def background_maintenance():
    """Background task for maintenance operations"""
    while True:
        try:
            # Run garbage collection if needed
            if memory_manager.should_run_gc():
                memory_manager.run_gc()
            
            # Run database optimization if needed
            if db_optimizer and db_optimizer.should_optimize():
                db_optimizer.optimize_database()
            
            # Sleep for 5 minutes before next check
            await asyncio.sleep(300)
            
        except Exception as e:
            logger.error(f"Background maintenance error: {e}")
            await asyncio.sleep(60)  # Wait 1 minute before retrying

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

class CodeRequest(BaseModel):
    code: str
    language: str

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

class CompletionRequest(BaseModel):
    context: str
    language: str
    prefix: str

class ReplaceRange(BaseModel):
    start: int
    end: int

class CompletionSuggestion(BaseModel):
    text: str
    explanation: Optional[str] = None
    replaceRange: Optional[ReplaceRange] = None

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
    memory_info = memory_manager.check_memory_usage()
    cache_stats = cache_manager.get_cache_stats()
    
    return {
        "status": "healthy",
        "service": "Cody AI Backend",
        "version": "1.0.0",
        "documents_indexed": code_collection.count() if code_collection else 0,
        "memory_usage_mb": round(memory_info.get("rss", 0) / 1024 / 1024, 2),
        "cache_stats": cache_stats
    }

@app.get("/health")
async def health_check():
    """Detailed health check"""
    try:
        # Check ChromaDB connection
        doc_count = code_collection.count() if code_collection else 0
        
        # Check OpenAI API key
        api_key_valid = bool(Config.OPENAI_API_KEY and len(Config.OPENAI_API_KEY) > 10)
        
        # Get system stats
        memory_info = memory_manager.check_memory_usage()
        cache_stats = cache_manager.get_cache_stats()
        
        return {
            "status": "healthy",
            "components": {
                "chromadb": {"status": "healthy", "documents": doc_count},
                "openai": {"status": "healthy" if api_key_valid else "error", "configured": api_key_valid}
            },
            "system": {
                "memory": memory_info,
                "cache": cache_stats
            }
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(status_code=500, detail=f"Health check failed: {str(e)}")

@app.get("/cache/stats")
async def get_cache_stats():
    """Get cache statistics"""
    return cache_manager.get_cache_stats()

@app.post("/cache/clear")
async def clear_cache(cache_type: str = "all"):
    """Clear cache"""
    cache_manager.clear_cache(cache_type)
    return {"message": f"Cleared {cache_type} cache(s)"}

@app.get("/system/memory")
async def get_memory_stats():
    """Get memory statistics"""
    return memory_manager.check_memory_usage()

@app.post("/system/gc")
async def force_garbage_collection():
    """Force garbage collection"""
    return memory_manager.run_gc()

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
        
        # Check cache first
        cache_key = cache_manager.get_cache_key(prompt, context, language, "generate")
        cached_response = cache_manager.get_response_cache(cache_key)
        if cached_response:
            logger.info(f"Cache hit for generate request: {prompt[:50]}...")
            return cached_response
        
        logger.info(f"Generate code request for language: {language}")
        
        # Query vector database for relevant context
        retrieved_context = ""
        try:
            if db_optimizer:
                retrieved_results = db_optimizer.optimized_query(
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
        completion = openai_client.chat.completions.create(
            model=Config.OPENAI_MODEL_GENERATE,
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_message}
            ]
        )
        
        response = {"code": completion.choices[0].message.content}
        
        # Cache the response
        cache_manager.set_response_cache(cache_key, response)
        
        return response
        
    except HTTPException:
        # Re-raise HTTPException as-is (for validation errors)
        raise
    except Exception as e:
        logger.error(f"Generate code failed: {e}")
        raise HTTPException(status_code=500, detail=f"Code generation failed: {str(e)}")

@app.post("/chat")
@limiter.limit("15/minute")
async def chat(request: Request, chat_request: ChatRequest) -> dict:
    """Chat endpoint that handles code analysis and suggestions"""
    try:
        # Check cache first (only for non-code-edit requests)
        if not chat_request.includeCodeEdits:
            cache_key = cache_manager.get_cache_key(
                chat_request.prompt, 
                chat_request.context, 
                chat_request.language,
                len(chat_request.history),
                "chat"
            )
            cached_response = cache_manager.get_response_cache(cache_key)
            if cached_response:
                logger.info(f"Cache hit for chat request: {chat_request.prompt[:50]}...")
                return cached_response
        
        # Prepare system message with enhanced context
        system_message = f"""You are Cody, an expert programming AI assistant. 
        Analyze code thoroughly and provide detailed explanations covering:
        - Architecture and design patterns
        - Code functionality and business logic
        - Performance considerations
        - Best practices and potential improvements
        - Security implications
        - Edge cases and error handling
        
        Current file: {chat_request.currentFile if chat_request.currentFile else 'No file selected'}
        Language: {chat_request.language}
        """

        messages = [
            {"role": "system", "content": system_message},
            *[{"role": msg.role, "content": msg.content} for msg in chat_request.history[-10:]]  # Keep last 10 messages
        ]

        # Add code context with better formatting
        if chat_request.context:
            messages.append({
                "role": "system",
                "content": f"Here is the relevant code context:\n```{chat_request.language}\n{chat_request.context}\n```"
            })

        # Add the user's current question
        messages.append({"role": "user", "content": chat_request.prompt})

        # Make OpenAI API call
        completion = openai_client.chat.completions.create(
            model="gpt-4",  # Use GPT-4 for better analysis
            messages=messages,
            temperature=0.7,
            max_tokens=2000,  # Increased token limit
            presence_penalty=0.6,
            frequency_penalty=0.3
        )

        response_data = {
            "success": True,
            "data": {
                "response": completion.choices[0].message.content,
                "codeEdits": parse_code_edits(completion.choices[0].message.content, chat_request.currentFile)[1] if chat_request.includeCodeEdits else None
            }
        }
        
        # Cache non-code-edit responses
        if not chat_request.includeCodeEdits:
            cache_manager.set_response_cache(cache_key, response_data)
        
        return response_data
        
    except Exception as e:
        logger.error(f"Chat error: {str(e)}")
        return {"success": False, "error": str(e)}

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
        completion = openai_client.chat.completions.create(
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

@app.post("/completions")
@limiter.limit("30/minute")
async def get_completions(request: Request, completion_request: CompletionRequest) -> dict:
    """Get code completion suggestions"""
    try:
        # Validate and sanitize inputs
        context = sanitize_input(completion_request.context, max_length=10000)
        prefix = sanitize_input(completion_request.prefix, max_length=1000)
        language = sanitize_input(completion_request.language, max_length=50)

        if not prefix:
            return {"success": True, "data": []}

        system_message = f"""You are an AI code completion assistant. Based on the code context and current line,
        suggest natural and helpful code completions. Consider:
        - Variable and function names in scope
        - Common patterns in the codebase
        - Best practices for {language}
        - Likely next steps based on context
        
        Return only the code completion, no explanations or markdown formatting.
        """

        messages = [
            {"role": "system", "content": system_message},
            {"role": "user", "content": f"Code context:\n```{language}\n{context}\n```\nComplete this line: {prefix}"}
        ]

        logger.info(f"Getting completions for language: {language}, prefix: {prefix}")

        # Make OpenAI API call
        completion = openai_client.chat.completions.create(
            model="gpt-4",
            messages=messages,
            temperature=0.2,  # Lower temperature for more focused suggestions
            max_tokens=100,
            presence_penalty=0.0,
            frequency_penalty=0.0,
            n=3  # Generate 3 completions
        )

        suggestions = []
        for choice in completion.choices:
            text = choice.message.content.strip()
            # Remove any markdown code blocks
            text = re.sub(r'```.*?\n(.*?)```', r'\1', text, flags=re.DOTALL).strip()
            
            suggestion = {
                "text": text,
                "explanation": "Suggested completion",
                "replaceRange": {
                    "start": len(prefix.rstrip()),
                    "end": len(prefix)
                }
            }
            suggestions.append(suggestion)

        return {
            "success": True,
            "data": suggestions
        }
    except openai.APIError as e:
        logger.error(f"OpenAI API error in completions: {str(e)}")
        return {"success": False, "error": f"OpenAI API error: {str(e)}"}
    except Exception as e:
        logger.error(f"Completion error: {str(e)}")
        return {"success": False, "error": str(e)}

@app.post("/generate-tests")
async def generate_tests(request: CodeRequest) -> dict:
    """Generate unit tests for given code"""
    try:
        system_message = f"""Generate comprehensive unit tests for the following {request.language} code.
        Include:
        - Test setup and teardown
        - Edge cases and error conditions
        - Mocking of external dependencies
        - Clear test descriptions
        - Proper assertions
        """

        messages = [
            {"role": "system", "content": system_message},
            {"role": "user", "content": f"Generate unit tests for:\n```{request.language}\n{request.code}\n```"}
        ]

        response = openai_client.chat.completions.create(
            model="gpt-4",
            messages=messages,
            temperature=0.7,
            max_tokens=3000,  # Higher limit for test generation
            presence_penalty=0.6,
            frequency_penalty=0.3
        )

        return {
            "success": True,
            "data": {
                "code": response.choices[0].message.content
            }
        }
    except Exception as e:
        print(f"Test generation error: {str(e)}")
        return {"success": False, "error": str(e)}

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