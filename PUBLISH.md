# 📦 NPM Publishing Guide

## Prerequisites

1. **NPM Account**: Create account at [npmjs.com](https://www.npmjs.com/)
2. **NPM CLI**: `npm login` to authenticate

## Publishing Steps

### 1. Verify Package Name
The published name is `gemini-mcp-local` (unscoped). Ensure `package.json` reflects this before publishing.

### 2. Build the Project
```bash
npm run build
```

### 3. Test Locally (Optional)
```bash
npm pack
# This creates a .tgz file you can test with
```

### 4. Publish to NPM
```bash
npm publish
```

## After Publishing

Users can now use your MCP server with:

```json
{
  "mcpServers": {
    "gemini-mcp-local": {
      "command": "npx",
      "args": ["-y", "gemini-mcp-local"],
      "env": {
        "GOOGLE_API_KEY": "their-api-key"
      }
    }
  }
}
```

## Updates

To publish updates:
1. Update version in `package.json`
2. `npm run build`
3. `npm publish`

## Scoped Package Benefits

- **Namespace**: `@username/package-name` avoids conflicts
- **Public**: `publishConfig.access: "public"` makes scoped packages public
- **Professional**: Looks more official and organized

## File Structure for NPM

The `files` array in `package.json` includes:
- `dist/` - Compiled JavaScript
- `README.md` - Package documentation
- `claude_desktop_config.example.json` - Ready-to-use config

Perfect for plug-and-play installation! 🚀
