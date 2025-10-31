# 🚀 Quick Setup Guide

## 📋 Prerequisites

- [Node.js](https://nodejs.org/) (v20 or higher)
- [Claude Desktop](https://claude.ai/download)
- [Gemini API Key](https://makersuite.google.com/app/apikey)

## 💫 5-Minute Setup

### 1. Clone & Build
```bash
git clone https://github.com/cyanheads/mcp-ts-template.git
cd mcp-ts-template
npm install
npm run build
```

### 2. Get Your Paths Ready
**Copy your repo path:**
- **Windows:** `C:/Users/YourName/path/to/mcp-ts-template/dist/simple-server.js`
- **macOS/Linux:** `/Users/YourName/path/to/mcp-ts-template/dist/simple-server.js`

### 3. Configure Claude Desktop
1. Open Claude Desktop
2. Settings ⚙️ → Developer → "Edit Config"
3. Copy from `claude_desktop_config.example.json`
4. Replace:
   - `"/ABSOLUTE/PATH/TO/YOUR/REPO/dist/simple-server.js"` with your actual path
   - `"your-gemini-api-key-here"` with your real API key

### 4. Restart Claude Desktop

## ✅ Test It

Ask Claude: *"Analyze the current directory using projectPath '.'"*

If you see the analysis tools, you're all set! 🎉

## 🆘 Troubleshooting

**Server won't start?**
- Check the path in your config is correct
- Make sure you ran `npm run build`
- Verify your Gemini API key is valid

**Need logs?**
- Check `%APPDATA%/Claude/` (Windows) or `~/Library/Application Support/Claude/` (macOS)
- Look for `mcp-server-gemini-codebase-analyzer.log`