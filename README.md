# Cody AI Code Assistant

Cody is a personal AI-powered code assistant designed to be your pair programmer. It started as a simple web-based code generator and has evolved into a powerful, context-aware VS Code extension that understands your entire codebase.

This project is a multi-part application demonstrating how to build a sophisticated AI tool from the ground up, combining a Python backend, a React frontend, and a native VS Code extension.

![Cody Screenshot](https://i.imgur.com/example.png) _(Note: Replace with an actual screenshot)_

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
- Python 3.8+
- Node.js 18+
- VS Code 1.80+
- OpenAI API key

### Backend Setup
```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
# Edit .env and add your OpenAI API key
python main.py
```

### Frontend Setup (Optional - for web interface)
```bash
cd frontend
npm install
npm run dev
```

### VS Code Extension Setup
```bash
cd vscode-extension
npm install
npm run compile
```

Then press `F5` in VS Code to launch the extension development host.

## 📖 Usage Guide

### Interactive Chat
1. Open the "Cody Chat" panel in the VS Code sidebar
2. Start typing your questions or requests
3. Cody will maintain conversation context
4. Select code in the editor for automatic context inclusion

**Example Chat Flow:**
```
You: "How can I optimize this function?"
Cody: "I can see the function you've selected. Here are several optimization approaches..."
You: "Now refactor it using the second approach"
Cody: "Here's the refactored version using approach #2..."
```

### Automated Bug Fixing
1. Select the buggy code in your editor
2. Right-click and choose "Cody: Fix This Bug"
3. Enter the error message you're seeing
4. Review the diff showing original vs fixed code
5. Click "Apply Fix" to update your code

**Example:**
- Select: `items.forEach(item => console.log(item.name.toUpperCase()))`
- Error: `TypeError: Cannot read property 'toUpperCase' of undefined`
- Cody provides: `items.forEach(item => console.log(item.name?.toUpperCase() || 'N/A'))`

### Live Project Awareness
- **Automatic**: Works in the background once extension is active
- **Manual Reindex**: Command Palette → "Cody: Re-index Project"
- **Status**: Check notifications for indexing progress
- **Exclusions**: Automatically ignores node_modules, .git, dist, build folders

### Traditional Commands
- **Generate Code**: Select code → Right-click → "Cody: Generate Code"
- **Explain Code**: Select code → Right-click → "Cody: Explain This Code"
- **Generate Tests**: Select code → Right-click → "Cody: Generate Unit Tests"

## 🏗️ Architecture

### Backend (FastAPI)
- **`/generate`**: Traditional code generation
- **`/chat`**: Interactive chat with history
- **`/fix-bug`**: Automated bug fixing
- **`/reindex`**: Manual project reindexing
- **ChromaDB**: Vector database for codebase awareness
- **OpenAI GPT-4o**: Core AI model

### Frontend (React + Vite)
- Modern React application with Tailwind CSS
- Syntax highlighting with Prism.js
- Real-time code generation interface

### VS Code Extension (TypeScript)
- **Chat Provider**: Webview-based chat interface
- **File Watcher**: Chokidar-based file monitoring
- **Diff Viewer**: Visual code comparison
- **Context Menu**: Right-click commands

## 🔧 Configuration

### Environment Variables
```env
OPENAI_API_KEY=your_openai_api_key_here
```

### VS Code Settings
The extension automatically configures itself, but you can customize:
- File watching patterns
- Reindexing frequency
- Chat history length

## 🐛 Troubleshooting

### Common Issues

**Backend won't start:**
- Check Python version (3.8+)
- Verify OpenAI API key in .env
- Install dependencies: `pip install -r requirements.txt`

**Extension not loading:**
- Compile TypeScript: `npm run compile`
- Check VS Code version (1.80+)
- Restart VS Code development host

**File watching not working:**
- Check workspace folder permissions
- Verify chokidar installation: `npm install chokidar`
- Check console for file watching errors

**Chat not responding:**
- Ensure backend is running on localhost:8000
- Check network connectivity
- Verify API key has sufficient credits

## 🚀 Development

### Running in Development
1. Start backend: `cd backend && python main.py`
2. Start frontend: `cd frontend && npm run dev`
3. Open extension: `cd vscode-extension && code .` → Press F5

### Building for Production
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