# Cody AI Code Assistant

A comprehensive AI-powered code assistant that integrates directly into VS Code, providing context-aware code generation, interactive chat, automated bug fixing, and live project awareness.

## 🎥 Demo Video

<div align="center">

[![Cody AI Demo Video](https://img.shields.io/badge/▶️%20WATCH%20DEMO%20VIDEO-Click%20to%20Play-FF0000?style=for-the-badge&logo=youtube&logoColor=white)](https://drive.google.com/file/d/13DqJivJA5pGYROAb9knnJLGfCPtI6NHm/view?usp=sharing)

</div>

*🎬 See Cody AI in action: context-aware chat, code generation, bug fixes, and intelligent assistance*

## 🚀 Quick Install

**Install from VS Code Marketplace:**
[![Install Extension](https://img.shields.io/badge/Install%20from-VS%20Code%20Marketplace-blue?style=for-the-badge&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=cody-dev.cody-ai-personal)

Or search "**Cody AI**" in VS Code Extensions panel.

## 📊 Extension Stats

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/cody-dev.cody-ai-personal?label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=cody-dev.cody-ai-personal)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/cody-dev.cody-ai-personal)](https://marketplace.visualstudio.com/items?itemName=cody-dev.cody-ai-personal)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/cody-dev.cody-ai-personal)](https://marketplace.visualstudio.com/items?itemName=cody-dev.cody-ai-personal)

## 🏗️ Architecture Diagram

![cody diagram](https://github.com/user-attachments/assets/50ab3a40-9d76-4a8c-8efe-1ef55e32aaa9)

## ✨ Features

### Phase 1: Basic Web App
- **Web-based Code Generator**: FastAPI backend with React frontend
- **Multi-language Support**: Supports multiple programming languages
- **Syntax Highlighting**: Beautiful code display with syntax highlighting
- **Real-time Generation**: Instant code generation with OpenAI GPT-4o

### Phase 2: Context-Aware Generation
- **RAG (Retrieval-Augmented Generation)**: Uses ChromaDB vector database for codebase awareness
- **Contextual Understanding**: Incorporates existing code context for better results
- **Intelligent Suggestions**: Leverages project-specific patterns and conventions

### Phase 3: VS Code Extension
- **Native Integration**: Right-click context menu commands
- **Generate Code**: Refactor and modify selected code
- **Explain Code**: Get detailed explanations in a beautiful webview
- **Generate Tests**: Automatically create unit tests

### Phase 4: Advanced Features ✨ **NEW**

#### 1. Interactive Chat Panel
- **Sidebar Chat**: Persistent chat panel in VS Code sidebar
- **Conversation History**: Maintains context across multiple interactions
- **Follow-up Questions**: Natural conversation flow ("Now refactor that", "Make it more performant")
- **Context Awareness**: Automatically includes current editor selection
- **Beautiful UI**: Themed chat interface with timestamps and formatting

#### 2. Automated Bug Fixing
- **"Fix This Bug" Command**: Right-click on buggy code
- **Error Analysis**: Paste error messages for targeted fixes
- **Diff Viewer**: Shows original vs fixed code with visual diff
- **One-click Apply**: Review and apply fixes with a single click
- **Smart Suggestions**: Uses vector database to find similar patterns

#### 3. Live Project Awareness
- **Automatic File Watching**: Monitors project files for changes
- **Background Reindexing**: Automatically updates vector database
- **Intelligent Debouncing**: Avoids excessive reindexing
- **Always Up-to-date**: Ensures latest project context

## 🛠️ Installation & Setup

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
1. Open the `vscode-extension` folder in a **new VS Code window**
2. Install the dependencies: `npm install`
3. Press **`F5`** to start the **Extension Development Host**
4. A new VS Code window will appear with the extension running. Open any code file in this new window
5. Select some code, right-click, and use one of the "Cody" commands!

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
# Backend
cd backend
pip install -r requirements.txt

# Frontend
cd frontend
npm run build

# Extension
cd vscode-extension
npm run compile
```

## 🔮 Future Roadmap

### Phase 5: Marketplace & Distribution
- [ ] Publish to VS Code Marketplace
- [ ] Package as standalone installer
- [ ] Add telemetry and analytics

### Phase 6: Advanced AI Features
- [ ] Multi-file refactoring
- [ ] Automated code reviews
- [ ] Performance optimization suggestions
- [ ] Security vulnerability detection

### Phase 7: Collaboration & Scaling
- [ ] Team collaboration features
- [ ] Cloud-hosted backend option
- [ ] Enterprise deployment guide
- [ ] Custom model fine-tuning

## 📄 License

MIT License - see LICENSE file for details.

## 👨‍💻 Author

**Dishank Chauhan**
- GitHub: [@DishankChauhan](https://github.com/DishankChauhan)
- Extension: [Cody AI on VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=cody-dev.cody-ai-personal)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

---

**Made with ❤️ by [Dishank Chauhan](https://github.com/DishankChauhan)**

*Transform your coding experience with AI-powered assistance!*

## 🙏 Acknowledgments

- OpenAI for GPT-4o API
- ChromaDB for vector database
- VS Code team for excellent extension APIs
- React and FastAPI communities

---

**Built with ❤️ for developers by developers**
