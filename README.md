# Cody: Your Personal AI Code Assistant

Cody is a personal AI-powered code assistant designed to be your pair programmer. It started as a simple web-based code generator and has evolved into a powerful, context-aware VS Code extension that understands your entire codebase.

This project is a multi-part application demonstrating how to build a sophisticated AI tool from the ground up, combining a Python backend, a React frontend, and a native VS Code extension.

Video : https://tinyurl.com/475y4ww5
---

## Features

-   **Code Generation**: Generate functions, classes, or code snippets from a natural language prompt.
-   **Context-Aware Responses**: Provide existing code as context to get more accurate and relevant results.
-   **VS Code Integration**:
    -   Right-click on selected code to refactor, explain, or generate tests.
    -   Seamlessly inserts generated code back into your editor.
-   **Codebase Awareness (RAG)**:
    -   Cody can index your entire project to understand its structure and content.
    -   It automatically retrieves relevant code snippets from your codebase to provide highly contextual answers, even for code you haven't selected.
-   **Explain Code**: Select a block of code and get a clear, structured explanation of its purpose, inputs, and outputs.
-   **Generate Unit Tests**: Automatically generate unit tests for your functions or classes using popular testing frameworks.

---

## Tech Stack

-   **Backend**: Python with **FastAPI** for a high-performance REST API.
-   **AI Model**: **OpenAI GPT-4o** (or any other major LLM) for code generation and understanding.
-   **Frontend**: **React** (built with Vite) for a fast and modern user interface.
-   **Styling**: **Tailwind CSS** for utility-first styling.
-   **Code Highlighting**: `react-syntax-highlighter` for displaying code beautifully.
-   **VS Code Extension**: Built with **TypeScript** and the VS Code Extension API.
-   **Vector Database**: **ChromaDB** for local, persistent storage of codebase embeddings.
-   **Embeddings Model**: OpenAI `text-embedding-3-small` for creating vector representations of code.

---

## Getting Started: Running Cody Locally

To run the full Cody suite (backend, frontend, and VS Code extension), follow these steps.

### Prerequisites

-   Python 3.10+ (preferably managed with Conda or Pyenv)
-   Node.js v18+ and npm
-   An OpenAI API Key

### 1. Clone & Setup the Backend

First, set up and run the FastAPI backend server.

```bash
# Clone the repository (if you haven't already)
git clone https://github.com/DishankChauhan/Cody
cd cody

# Navigate to the backend directory
cd backend

# Create a .env file from the example
cp .env.example .env

# Add your OpenAI API key to the .env file
# OPENAI_API_KEY=your_openai_api_key_here

# Install the required Python packages
# (Use the correct python/pip for your environment, e.g., from conda)
pip install -r requirements.txt

# Run the backend server
uvicorn main:app --reload
```
The backend will be running at `http://localhost:8000`.

### 2. Run the Frontend Web App

In a new terminal, start the React frontend.

```bash
# Navigate to the frontend directory from the project root
cd frontend

# Install npm dependencies
npm install

# Start the development server
npm run dev
```
The web interface will be available at `http://localhost:5173`.

### 3. Index Your Codebase (for RAG)

To enable codebase awareness, you need to run the indexing script.

```bash
# From the project root directory
# Make sure you use the same Python environment as the backend
pip install -r backend/requirements.txt # Ensure dependencies are installed
python backend/index_codebase.py .
```
This command will scan the current project (`.`), create embeddings, and store them in a local `cody_chroma_db` directory. You only need to do this once per project, or re-run it to update the index.

### 4. Run the VS Code Extension

Finally, to use Cody inside your editor:

1.  Open the `vscode-extension` folder in a **new VS Code window**.
2.  Install the dependencies: `npm install`.
3.  Press **`F5`** to start the **Extension Development Host**.
4.  A new VS Code window will appear with the extension running. Open any code file in this new window.
5.  Select some code, right-click, and use one of the "Cody" commands! 
