import os
import argparse
import chromadb
import openai
from dotenv import load_dotenv
from chromadb.utils import embedding_functions

load_dotenv()

# Initialize OpenAI client
openai.api_key = os.getenv("OPENAI_API_KEY")

# --- Configuration for files and folders to ignore during indexing ---
IGNORE_DIRECTORIES = {
    "node_modules", ".git", "__pycache__", "dist", "build", ".vscode", 
    "venv", ".venv", "env", "out", "vscode-extension", "cody_chroma_db"
}
# File extensions to ignore
IGNORE_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".svg", ".ico", ".webp",
    ".mp4", ".mov", ".avi", ".mp3", ".wav",
    ".zip", ".tar", ".gz", ".rar",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".db", ".sqlite3",
    ".lock", ".log"
}
# Standalone files to ignore
IGNORE_FILES = {"package-lock.json", "yarn.lock"}

def should_index_file(file_path):
    """Check if a file should be indexed based on its path and extension."""
    if os.path.basename(file_path) in IGNORE_FILES:
        return False
    if any(part in IGNORE_DIRECTORIES for part in file_path.split(os.sep)):
        return False
    if any(file_path.endswith(ext) for ext in IGNORE_EXTENSIONS):
        return False
    return True

def get_file_content(file_path):
    """Read file content, handling potential encoding errors."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read()
    except (UnicodeDecodeError, IOError):
        # If utf-8 fails, try to ignore errors or skip the file
        print(f"Warning: Could not read file {file_path}. Skipping.")
        return None

def main():
    parser = argparse.ArgumentParser(description="Index a codebase using ChromaDB and OpenAI embeddings.")
    parser.add_argument("path", type=str, help="The path to the codebase directory to index.")
    args = parser.parse_args()

    codebase_path = args.path

    if not os.path.isdir(codebase_path):
        print(f"Error: Path '{codebase_path}' is not a valid directory.")
        return

    # Initialize ChromaDB client (persistent)
    client = chromadb.PersistentClient(path="./cody_chroma_db")
    
    # Set up OpenAI embedding function
    openai_ef = embedding_functions.OpenAIEmbeddingFunction(
        api_key=os.getenv("OPENAI_API_KEY"),
        model_name="text-embedding-3-small"
    )

    # Create or get the collection with the embedding function
    collection = client.get_or_create_collection(
        name="codebase",
        embedding_function=openai_ef
    )

    print(f"Starting to index codebase at: {codebase_path}")
    
    documents = []
    metadatas = []
    ids = []
    
    for root, _, files in os.walk(codebase_path):
        for file in files:
            file_path = os.path.join(root, file)
            relative_path = os.path.relpath(file_path, codebase_path)
            
            if should_index_file(file_path):
                print(f"  - Indexing: {relative_path}")
                content = get_file_content(file_path)
                if content:
                    documents.append(content)
                    metadatas.append({"path": relative_path})
                    ids.append(relative_path)

    if not documents:
        print("No files found to index.")
        return

    print(f"\nFound {len(documents)} files to index. Adding to the vector database...")

    # We add the documents to the collection in batches. This is a good practice
    # to avoid overwhelming the database or hitting API limits with very large codebases.
    batch_size = 100
    for i in range(0, len(documents), batch_size):
        batch_docs = documents[i:i+batch_size]
        batch_metadatas = metadatas[i:i+batch_size]
        batch_ids = ids[i:i+batch_size]
        
        # The embedding function we configured for the collection will automatically
        # generate the embeddings for the documents before they are added.
        try:
            collection.add(
                documents=batch_docs,
                metadatas=batch_metadatas,
                ids=batch_ids
            )
            print(f"  - Added batch {i//batch_size + 1} to ChromaDB.")
        except Exception as e:
            print(f"Error adding batch to ChromaDB: {e}")
            # In a real-world application, you might add more robust error
            # handling or retry logic here.

    print("\nIndexing complete!")
    print(f"Total documents in collection: {collection.count()}")

if __name__ == "__main__":
    main() 