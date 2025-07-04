from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import openai
import os
from dotenv import load_dotenv
import chromadb
from chromadb.utils import embedding_functions

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

@app.get("/")
def read_root():
    return {"Hello": "World"} 