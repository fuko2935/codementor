# 📦 NPM Publishing Guide

## Prerequisites

1. **NPM Account**: Create account at [npmjs.com](https://www.npmjs.com/)
2. **NPM CLI**: `npm login` to authenticate

## Publishing Steps

### 1. Verify Package Name

The published name is `codementor` (unscoped). Ensure `package.json` reflects this before publishing.

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

### Cursor Kullanıcıları İçin

Kullanıcılar artık Cursor'da MCP server'ınızı şu şekilde kullanabilir:

**Cursor MCP Config:** `cursor_mcp_config.json` dosyasını kullanarak Cursor'a ekleyin. Detaylar için `CURSOR_SETUP.md` dosyasına bakın.

**Gemini CLI Provider ile (Önerilen):**

```json
{
  "mcpServers": {
    "codementor": {
      "command": "npx",
      "args": ["-y", "codementor"],
      "env": {
        "LLM_DEFAULT_PROVIDER": "gemini-cli"
      }
    }
  }
}
```

**API Key ile:**

```json
{
  "mcpServers": {
    "codementor": {
      "command": "npx",
      "args": ["-y", "codementor"],
      "env": {
        "LLM_DEFAULT_PROVIDER": "gemini",
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
