#!/usr/bin/env python3
"""
Startup script for the Flask backend server
"""
import subprocess
import sys
import os

def install_requirements():
    """Install required packages"""
    print("Installing Python requirements...")
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"])
        print("✅ Requirements installed successfully")
    except subprocess.CalledProcessError as e:
        print(f"❌ Failed to install requirements: {e}")
        return False
    return True

def start_server():
    """Start the Flask server"""
    print("Starting Flask backend server...")
    print("Server will run on http://127.0.0.1:5328")
    print("Press Ctrl+C to stop the server")
    print("-" * 50)
    
    try:
        # Change to the directory containing the script
        os.chdir(os.path.dirname(os.path.abspath(__file__)))
        
        # Start the Flask server
        subprocess.run([sys.executable, "api/index.py"])
    except KeyboardInterrupt:
        print("\n🛑 Server stopped by user")
    except Exception as e:
        print(f"❌ Error starting server: {e}")

if __name__ == "__main__":
    print("🚀 Weather Fetcher Backend Startup")
    print("=" * 40)
    
    # Install requirements first
    if install_requirements():
        start_server()
    else:
        print("❌ Failed to start server due to dependency issues")
        sys.exit(1)
