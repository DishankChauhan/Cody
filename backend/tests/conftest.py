import pytest
import os
import tempfile
import shutil
from unittest.mock import Mock, patch
from fastapi.testclient import TestClient
import chromadb
from chromadb.utils import embedding_functions

# Import the app and config from main
import sys
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from main import app, Config
import main

@pytest.fixture(scope="session", autouse=True)
def setup_test_environment():
    """Set up test environment variables"""
    os.environ["OPENAI_API_KEY"] = "test_key_12345"
    os.environ["DEBUG"] = "true"
    os.environ["CHROMADB_PATH"] = tempfile.mkdtemp()
    yield
    # Cleanup
    if "CHROMADB_PATH" in os.environ:
        shutil.rmtree(os.environ["CHROMADB_PATH"], ignore_errors=True)

@pytest.fixture(autouse=True)
def disable_rate_limiting():
    """Disable rate limiting for tests"""
    # Create a mock that returns a passthrough decorator
    def mock_limit(rate_string):
        def decorator(func):
            return func  # Return function unchanged
        return decorator
    
    with patch('main.limiter.limit', side_effect=mock_limit):
        yield

@pytest.fixture
def test_config():
    """Provide test configuration"""
    return {
        "OPENAI_API_KEY": "test_key_12345",
        "DEBUG": True,
        "CHROMADB_PATH": tempfile.mkdtemp(),
        "HOST": "127.0.0.1",
        "PORT": 8001,
        "OPENAI_MODEL_GENERATE": "gpt-4o",
        "OPENAI_MODEL_CHAT": "gpt-3.5-turbo",
        "OPENAI_MODEL_EMBEDDING": "text-embedding-3-small",
        "OPENAI_MAX_TOKENS": 1000,
        "OPENAI_TEMPERATURE": 0.7,
        "CORS_ORIGINS": ["http://localhost:3000", "http://localhost:5173"]
    }

@pytest.fixture
def mock_chromadb():
    """Mock ChromaDB for testing"""
    mock_client = Mock()
    mock_collection = Mock()
    
    # Mock collection methods
    mock_collection.count.return_value = 5
    mock_collection.query.return_value = {
        'documents': [['test code snippet 1', 'test code snippet 2']],
        'metadatas': [{'path': 'test.py'}, {'path': 'example.js'}]
    }
    mock_collection.add = Mock()
    
    # Mock client methods
    mock_client.get_or_create_collection.return_value = mock_collection
    
    return mock_client, mock_collection

@pytest.fixture
def mock_openai():
    """Mock OpenAI API responses"""
    mock_response = Mock()
    mock_response.choices = [Mock()]
    mock_response.choices[0].message.content = "Generated code or response"
    
    with patch('openai.chat.completions.create', return_value=mock_response):
        yield mock_response

@pytest.fixture
def client(mock_chromadb, mock_openai):
    """Create test client with mocked dependencies"""
    mock_client, mock_collection = mock_chromadb
    
    # Patch the global variables in main
    with patch.object(main, 'client', mock_client), \
         patch.object(main, 'code_collection', mock_collection):
        
        # Create test client
        test_client = TestClient(app)
        yield test_client

@pytest.fixture
def sample_generate_request():
    """Sample generate request data"""
    return {
        "prompt": "Refactor this function",
        "language": "python",
        "context": "def hello():\n    print('hello')"
    }

@pytest.fixture
def sample_chat_request():
    """Sample chat request data"""
    return {
        "prompt": "How can I improve this code?",
        "language": "python", 
        "context": "def add(a, b):\n    return a + b",
        "history": [
            {
                "role": "user",
                "content": "Hello",
                "timestamp": "2023-01-01T00:00:00Z"
            }
        ],
        "includeCodeEdits": True,
        "currentFile": "test.py"
    }

@pytest.fixture
def sample_bug_fix_request():
    """Sample bug fix request data"""
    return {
        "code": "items.forEach(item => console.log(item.name.toUpperCase()))",
        "errorMessage": "TypeError: Cannot read property 'toUpperCase' of undefined",
        "language": "javascript"
    }

@pytest.fixture
def temp_project_dir():
    """Create a temporary project directory for testing"""
    temp_dir = tempfile.mkdtemp()
    
    # Create some test files
    os.makedirs(os.path.join(temp_dir, "src"), exist_ok=True)
    with open(os.path.join(temp_dir, "src", "main.py"), "w") as f:
        f.write("def main():\n    print('Hello World')")
    
    with open(os.path.join(temp_dir, "README.md"), "w") as f:
        f.write("# Test Project")
    
    yield temp_dir
    
    # Cleanup
    shutil.rmtree(temp_dir, ignore_errors=True) 