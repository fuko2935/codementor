# 🚀 Quick Setup Guide

## 📋 Prerequisites

- [Node.js](https://nodejs.org/) (v20 or higher)
- [Claude Desktop](https://claude.ai/download)
- [Gemini CLI](https://www.npmjs.com/package/@google/gemini-cli) (recommended) or [Gemini API Key](https://makersuite.google.com/app/apikey) (alternative)

## 💫 5-Minute Setup

### Option 1: Gemini CLI Provider (Recommended - No API Key Required)

**Why Gemini CLI?** Uses OAuth authentication, no API keys to manage, more secure!

1. **Install Gemini CLI:**
   ```bash
   npm install -g @google/gemini-cli
   ```

2. **Authenticate:**
   ```bash
   gemini
   # Select "Login with Google" when prompted
   ```

3. **Configure Claude Desktop:**
   - Open Claude Desktop
   - Settings ⚙️ → Developer → "Edit Config"
   - Copy from `claude_desktop_config.example.json`
   - Replace `"/ABSOLUTE/PATH/TO/YOUR/REPO/dist/index.js"` with your actual path
   - **Important:** The config already uses `gemini-cli` provider, no API key needed!

4. **Restart Claude Desktop**

### Option 2: API Key Authentication (Alternative)

**⚠️ SECURITY WARNING:** Never hardcode API keys in config files! Use environment variables instead.

1. **Get your API key:**
   - Visit https://makersuite.google.com/app/apikey
   - Create or copy your API key

2. **Set environment variable:**
   
   **Windows (PowerShell):**
   ```powershell
   $env:GOOGLE_API_KEY="your-api-key-here"
   ```
   
   **macOS/Linux:**
   ```bash
   export GOOGLE_API_KEY="your-api-key-here"
   ```
   
   **Or add to your shell profile** (`~/.bashrc`, `~/.zshrc`, etc.):
   ```bash
   export GOOGLE_API_KEY="your-api-key-here"
   ```

3. **Configure Claude Desktop:**
   - Open Claude Desktop
   - Settings ⚙️ → Developer → "Edit Config"
   - Copy from `claude_desktop_config.example.json`
   - Replace `"/ABSOLUTE/PATH/TO/YOUR/REPO/dist/index.js"` with your actual path
   - Set `LLM_DEFAULT_PROVIDER=gemini` (already in example config)
   - **DO NOT** add `GOOGLE_API_KEY` to the config file - it will be read from environment variables

4. **Restart Claude Desktop**

## ✅ Test It

Ask Claude: _"Analyze the current directory using projectPath '.'"_

If you see the analysis tools, you're all set! 🎉

## 🆘 Troubleshooting

**Server won't start?**

- Check the path in your config is correct (should be `dist/index.js`, not `simple-server.js`)
- Make sure you ran `npm run build`
- Verify your Gemini CLI is authenticated (if using gemini-cli) or API key is set in environment variables (if using API key)

**Need logs?**

- Check `%APPDATA%/Claude/` (Windows) or `~/Library/Application Support/Claude/` (macOS)
- Look for MCP server logs

**API Key not working?**

- Make sure you set it as an environment variable, not in the config file
- Verify the key is valid and has proper permissions
- Check that `LLM_DEFAULT_PROVIDER=gemini` is set in your config
