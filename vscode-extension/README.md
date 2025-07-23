# Cody AI - Personal Code Assistant

Transform your VS Code experience with an AI-powered coding companion that understands your project context and helps you code faster, smarter, and with fewer bugs.

## 🎥 Demo Video

[![Cody AI Demo](https://img.shields.io/badge/Watch%20Demo-▶️%20Video-blue?style=for-the-badge)](https://github.com/DishankChauhan/Cody/blob/main/cody%20recording.mp4)

*Watch Cody AI in action - context-aware chat, code generation, and intelligent assistance*

## ✨ Features

### 🤖 Interactive AI Chat
- **Sidebar Chat Panel**: Ask questions and get instant, context-aware responses
- **Project Context**: Automatically understands your codebase structure and patterns
- **Conversation Memory**: Maintains context across multiple interactions
- **Natural Follow-ups**: "Now make it async", "Add error handling", "Explain this function"

### 🔧 Smart Code Actions
- **Generate Code**: Right-click to refactor, enhance, or generate new code
- **Explain Code**: Get detailed explanations of complex code segments
- **Generate Tests**: Auto-create unit tests for your functions and classes
- **Fix Bugs**: Intelligent bug detection and automated fixes with diff preview

### 🧠 Context-Aware Intelligence
- **Vector Database**: Uses ChromaDB for deep codebase understanding
- **Live Project Monitoring**: Automatically stays up-to-date with your changes
- **Pattern Recognition**: Learns from your coding style and project conventions
- **Multi-language Support**: Works with JavaScript, TypeScript, Python, and more

## 🚀 Quick Start

### Prerequisites
- **VS Code**: Version 1.80.0 or higher
- **Backend Server**: Requires running the Cody backend (instructions below)
- **OpenAI API Key**: For AI-powered features

### Installation
1. Install the extension from the VS Code Marketplace
2. Set up the backend server (see [Backend Setup](#backend-setup))
3. Configure your OpenAI API key
4. Start coding with AI assistance!

### Backend Setup
```bash
# Clone the Cody repository
git clone https://github.com/your-username/cody-ai-assistant.git
cd cody-ai-assistant/backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp env.example .env
# Edit .env and add your OPENAI_API_KEY

# Start the backend
python main.py
```

## 📖 Usage

### Chat Panel
1. Click the Cody icon in the sidebar
2. Type your questions in the chat panel
3. Get instant, context-aware responses
4. Continue the conversation naturally

### Code Actions
1. Select code in your editor
2. Right-click to open context menu
3. Choose from Cody actions:
   - **Generate Code**: Enhance or refactor selected code
   - **Explain Code**: Get detailed explanations
   - **Generate Tests**: Create unit tests
   - **Fix Bug**: Analyze and fix issues

### Example Interactions
```
You: "How can I make this function more efficient?"
Cody: [Analyzes your selected code and suggests optimizations]

You: "Now add error handling"
Cody: [Adds try-catch blocks and validation]

You: "Generate tests for this"
Cody: [Creates comprehensive unit tests]
```

## ⚙️ Configuration

Access settings via `File > Preferences > Settings` and search for "Cody":

- **Backend URL**: Default `http://localhost:8000`
- **Request Timeout**: Default 30 seconds
- **Max Retries**: Default 3 attempts
- **Debug Mode**: Enable for troubleshooting

## 🔧 Commands

| Command | Description | Shortcut |
|---------|-------------|----------|
| `Cody: Generate Code` | Enhance selected code | Right-click menu |
| `Cody: Explain Code` | Get code explanations | Right-click menu |
| `Cody: Generate Tests` | Create unit tests | Right-click menu |
| `Cody: Fix Bug` | Analyze and fix issues | Right-click menu |
| `Cody: Re-index Project` | Refresh project context | Command palette |

## 🎯 Best Practices

### Getting Better Results
1. **Be Specific**: "Add input validation" vs "improve this"
2. **Provide Context**: Select relevant code before asking
3. **Follow Up**: Build on previous responses naturally
4. **Use Examples**: "Make it like the UserService class"

### Project Setup
1. **Re-index**: Run "Re-index Project" after major changes
2. **Keep Backend Running**: Ensure backend server is active
3. **Check Settings**: Verify backend URL is correct

## 🐛 Troubleshooting

### Common Issues

**Extension not responding?**
- Check if backend server is running (`http://localhost:8000`)
- Verify OpenAI API key is configured
- Check VS Code Output panel for errors

**Chat not working?**
- Restart VS Code
- Check internet connection
- Verify API key permissions

**Code actions missing?**
- Select code before right-clicking
- Ensure backend is connected
- Try re-indexing the project

### Support
- **Issues**: Report bugs on GitHub
- **Discussions**: Join our community discussions
- **Documentation**: Visit our full documentation

## 📊 Privacy & Data

- **Local Processing**: Your code stays in your environment
- **API Calls**: Only selected code sent to OpenAI (as per their privacy policy)
- **No Tracking**: We don't collect usage analytics
- **Secure**: All communications encrypted

## 🛠️ Development

### Building from Source
```bash
git clone https://github.com/DishankChauhan/Cody.git
cd Cody/vscode-extension
npm install
npm run compile
```

### Contributing
We welcome contributions! See our [Contributing Guide](https://github.com/DishankChauhan/Cody/blob/main/CONTRIBUTING.md) for details.

## 📝 License

MIT License - see [LICENSE](LICENSE) for details.

## 👨‍💻 Author

**Dishank Chauhan**
- GitHub: [@DishankChauhan](https://github.com/DishankChauhan)
- Project: [Cody AI Assistant](https://github.com/DishankChauhan/Cody)

## 🎉 What's Next?

- 🔄 **Auto-completion**: Inline suggestions as you type
- 🌐 **Cloud Backend**: Hosted solution for easier setup
- 🎨 **Custom Themes**: Personalize the chat interface
- 📚 **Documentation Generation**: Auto-generate docs from code

---

**Transform your coding experience today with Cody AI!** ⚡

*Made with ❤️ by [Dishank Chauhan](https://github.com/DishankChauhan) for developers who want to code smarter, not harder.*
