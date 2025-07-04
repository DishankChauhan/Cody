import { useState } from 'react'
import axios from 'axios'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { dracula } from 'react-syntax-highlighter/dist/esm/styles/prism'

function App() {
  const [prompt, setPrompt] = useState('')
  const [language, setLanguage] = useState('python')
  const [context, setContext] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const generateCode = async () => {
    setLoading(true)
    setError(null)
    setCode('')
    try {
      const response = await axios.post('http://localhost:8000/generate', {
        prompt,
        language,
        context,
      })
      if (response.data.error) {
        setError(response.data.error)
      } else {
        setCode(response.data.code)
      }
    } catch (err) {
      setError('An error occurred while generating the code.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-4">
      <div className="w-full max-w-4xl">
        <h1 className="text-4xl font-bold text-center mb-8">Cody: Your Personal Code Assistant</h1>
        
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg mb-8">
          <textarea
            className="w-full h-24 p-4 bg-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
            placeholder="Paste your existing code here (optional context)..."
            value={context}
            onChange={(e) => setContext(e.target.value)}
          />
          <textarea
            className="w-full h-32 p-4 bg-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter your coding prompt... e.g., 'Write a function to process the data from the context'"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="flex items-center justify-between mt-4">
            <select
              className="p-2 bg-gray-700 rounded-md focus:outline-none"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              <option value="python">Python</option>
              <option value="javascript">JavaScript</option>
            </select>
            <button
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md disabled:bg-gray-500"
              onClick={generateCode}
              disabled={loading || !prompt}
            >
              {loading ? 'Generating...' : 'Generate Code'}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-500 text-white p-4 rounded-lg mb-8">
            <strong>Error:</strong> {error}
          </div>
        )}

        {code && (
          <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
            <h2 className="text-2xl font-semibold mb-4">Generated Code</h2>
            <div className="relative">
              <SyntaxHighlighter language={language} style={dracula} customStyle={{borderRadius: "0.5rem"}}>
                {code}
              </SyntaxHighlighter>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
