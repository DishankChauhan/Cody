#!/usr/bin/env python3
"""
Simple test runner for Cody backend tests
Run with: python test_runner.py
"""

import subprocess
import sys
import os

def main():
    """Run all backend tests"""
    print("🧪 Running Cody Backend Tests")
    print("=" * 50)
    
    # Check if we're in the right directory
    if not os.path.exists("main.py"):
        print("❌ Error: Please run this script from the backend directory")
        sys.exit(1)
    
    # Check if pytest is installed
    try:
        subprocess.run([sys.executable, "-m", "pytest", "--version"], 
                      check=True, capture_output=True)
    except subprocess.CalledProcessError:
        print("❌ Error: pytest not installed. Run: pip install -r requirements-dev.txt")
        sys.exit(1)
    
    # Run tests
    try:
        print("\n🚀 Starting test execution...")
        result = subprocess.run([
            sys.executable, "-m", "pytest", 
            "-v", 
            "--cov=.",
            "--cov-report=term-missing",
            "--cov-report=html:htmlcov",
            "tests/"
        ], check=False)
        
        if result.returncode == 0:
            print("\n✅ All tests passed!")
            print("📊 Coverage report saved to htmlcov/index.html")
        else:
            print(f"\n❌ Tests failed with exit code {result.returncode}")
            
        return result.returncode
        
    except KeyboardInterrupt:
        print("\n⚠️  Test execution interrupted by user")
        return 1
    except Exception as e:
        print(f"\n❌ Error running tests: {e}")
        return 1

if __name__ == "__main__":
    sys.exit(main()) 