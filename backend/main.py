from fastapi import FastAPI
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

load_dotenv()

app = FastAPI()

# Connect to the persistent ChromaDB vector database on startup.
client = chromadb.PersistentClient(path="./cody_chroma_db")
openai_ef = embedding_functions.OpenAIEmbeddingFunction(
    api_key=os.getenv("OPENAI_API_KEY"),
    model_name="text-embedding-3-small"
)
code_collection = client.get_or_create_collection(
    name="codebase",
    embedding_function=openai_ef
)

# Configure CORS to allow requests from the frontend development server.
origins = [
    "http://localhost:3000",
    "http://localhost:5173", # Vite default
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

openai.api_key = os.getenv("OPENAI_API_KEY")

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
    code_edits = []
    cleaned_response = response

    # Pattern for code edit blocks
    edit_pattern = r"```edit:(\S+)\n(.*?)```"
    
    # Find all code edit blocks
    matches = re.finditer(edit_pattern, response, re.DOTALL)
    
    for match in matches:
        file_path = match.group(1) or current_file
        if not file_path:
            continue
            
        edit_content = match.group(2).strip()
        
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

@app.post("/generate")
async def generate_code(request: GenerateRequest):
    # First, query the vector database to find relevant code snippets from the
    # indexed codebase based on the user's prompt.
    try:
        retrieved_results = code_collection.query(
            query_texts=[request.prompt],
            n_results=3,
        )
        retrieved_context = "\n---\n".join(retrieved_results['documents'][0])
    except Exception as e:
        print(f"ChromaDB query failed: {e}")
        retrieved_context = "" # Continue without retrieved context if the DB query fails.

    # Then, construct the final prompt by combining the retrieved context from the
    # database and the code the user has explicitly selected.
    system_message = f"You are an expert {request.language} programmer. Write clean, elegant, and efficient code. Do not include any explanations or markdown formatting, just the raw code."
    
    user_message_parts = []
    
    if retrieved_context:
        user_message_parts.append("Given the following relevant code from the codebase as context:\n\n---\n" + retrieved_context + "\n---")

    if request.context:
        user_message_parts.append("And given this specific code I have selected:\n\n---\n" + request.context + "\n---")

    user_message_parts.append(f"Please fulfill the following request: {request.prompt}")
    
    user_message = "\n\n".join(user_message_parts)

    # Finally, choose the right "personality" for the AI based on the prompt.
    # If the user is asking for an explanation, we use a different system message.
    if "explain" in request.prompt.lower():
        system_message = "You are an expert code explainer. Provide a clear, concise, and easy-to-understand explanation of the code. Structure your answer with clear headings for 'Purpose', 'Inputs', and 'Outputs'. Do not return any code or markdown formatting."

    try:
        completion = openai.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_message}
            ]
        )
        return {"code": completion.choices[0].message.content}
    except Exception as e:
        return {"error": str(e)}

@app.post("/chat")
async def chat_with_cody(request: ChatRequest):
    """
    Interactive chat endpoint that maintains conversation history and supports code editing
    """
    try:
        # Query vector database for relevant context
        retrieved_results = code_collection.query(
            query_texts=[request.prompt],
            n_results=3,
        )
        retrieved_context = "\n---\n".join(retrieved_results['documents'][0])
    except Exception as e:
        print(f"ChromaDB query failed: {e}")
        retrieved_context = ""

    # Build system message for chat
    system_message = f"""You are Cody, an expert {request.language} programming assistant. You are having a conversation with a developer.

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
    
    # Add conversation history
    for msg in request.history[-10:]:  # Keep last 10 messages for context
        messages.append({"role": msg.role, "content": msg.content})
    
    # Add context information
    context_parts = []
    if retrieved_context:
        context_parts.append(f"Relevant codebase context:\n---\n{retrieved_context}\n---")
    
    if request.context:
        context_parts.append(f"Current editor selection:\n---\n{request.context}\n---")
    
    if request.currentFile:
        context_parts.append(f"Current file being edited: {request.currentFile}")
    
    if context_parts:
        context_message = "\n\n".join(context_parts) + f"\n\nUser request: {request.prompt}"
    else:
        context_message = request.prompt
    
    messages.append({"role": "user", "content": context_message})

    try:
        completion = openai.chat.completions.create(
            model="gpt-3.5-turbo",  # Using more cost-effective model
            messages=messages,
            max_tokens=1000,
            temperature=0.7  # Slightly creative but still focused
        )

        response = completion.choices[0].message.content
        
        # Parse code edits if requested
        if request.includeCodeEdits:
            cleaned_response, code_edits = parse_code_edits(response, request.currentFile)
            return ChatResponse(response=cleaned_response, codeEdits=code_edits)
        
        return ChatResponse(response=response)
    except Exception as e:
        return {"error": str(e)}

@app.post("/fix-bug")
async def fix_bug(request: BugFixRequest):
    """
    Automated bug fixing endpoint
    """
    try:
        # Query vector database for similar code patterns
        retrieved_results = code_collection.query(
            query_texts=[f"fix {request.errorMessage} in {request.language}"],
            n_results=3,
        )
        retrieved_context = "\n---\n".join(retrieved_results['documents'][0])
    except Exception as e:
        print(f"ChromaDB query failed: {e}")
        retrieved_context = ""

    system_message = f"""You are an expert {request.language} debugger. Your task is to fix the provided code that has an error.

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
    
    user_message_parts.append(f"Code with error:\n---\n{request.code}\n---")
    user_message_parts.append(f"Error message: {request.errorMessage}")
    user_message_parts.append("Please provide the fixed code:")
    
    user_message = "\n\n".join(user_message_parts)

    try:
        completion = openai.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_message}
            ]
        )
        return {"fixedCode": completion.choices[0].message.content}
    except Exception as e:
        return {"error": str(e)}

@app.post("/reindex")
async def reindex_project(request: ReindexRequest):
    """
    Re-index the project codebase
    """
    try:
        # Run the indexing script
        result = subprocess.run([
            sys.executable, 
            "index_codebase.py", 
            request.projectPath
        ], capture_output=True, text=True, cwd=os.path.dirname(__file__))
        
        if result.returncode == 0:
            return {"message": "Project reindexed successfully", "output": result.stdout}
        else:
            return {"error": f"Indexing failed: {result.stderr}"}
    except Exception as e:
        return {"error": str(e)}

@app.get("/")
def read_root():
    return {"Hello": "World"} 