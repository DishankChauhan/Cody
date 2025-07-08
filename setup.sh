#!/bin/bash

echo "🚀 Setting up Cody AI..."

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "Visit https://docs.docker.com/get-docker/ for installation instructions."
    exit 1
fi

# Check if docker-compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    echo "Visit https://docs.docker.com/compose/install/ for installation instructions."
    exit 1
fi

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "Creating .env file..."
    echo "OPENAI_API_KEY=" > .env
    echo "⚠️ Please edit .env file and add your OpenAI API key"
fi

# Build and start containers
echo "🏗️ Building and starting containers..."
docker-compose up -d

echo """
✅ Setup complete!

To use Cody AI:
1. Make sure you've added your OpenAI API key to .env file
2. Install the Cody AI VS Code extension
3. The backend is running at http://localhost:8000

To check logs: docker-compose logs -f
To stop: docker-compose down
""" 