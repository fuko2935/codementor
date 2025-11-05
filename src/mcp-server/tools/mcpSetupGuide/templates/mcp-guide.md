
# 🚀 MCP Gemini Local - AI Usage Guide

**⚠️ IMPORTANT: DO NOT DELETE THIS SECTION ⚠️**
This section is automatically managed by the MCP Gemini Local tool. It provides essential information for AI assistants to use the MCP tools effectively.

---

## 📋 Available MCP Tools

### 1. `gemini_codebase_analyzer`
**Purpose:** Analyzes entire project codebases with multiple analysis modes.

**When to use:**
- Small to medium projects (< 1000 files)
- Quick general analysis
- Single-pass comprehensive review

**Parameters:**
- `projectPath`: Project directory path (relative or absolute)
- `question`: Your analysis question (required)
- `analysisMode`: Choose from: general, implementation, refactoring, explanation, debugging, audit, security, performance, testing, documentation, review
- `geminiApiKey`: Optional API key (uses default if not provided)
- `includeChanges`: (Only for review mode) Analyze git diffs

**⚠️ Warning:** May timeout on very large projects. For large codebases, use the orchestrator workflow instead.

**Example:**
```
Use gemini_codebase_analyzer to analyze this project:
- projectPath: "."
- question: "What security vulnerabilities exist in this codebase?"
- analysisMode: "security"
```

---

### 2. `project_orchestrator_create` (Step 1)
**Purpose:** Creates intelligent file groups for massive projects to stay within token limits.

**When to use:**
- Large projects (> 1000 files or > 200,000 tokens)
- Projects that fail with gemini_codebase_analyzer
- When you need stable multi-step analysis

**Parameters:**
- `projectPath`: Project directory path
- `question`: Your analysis question (optional, helps AI group files intelligently)
- `analysisMode`: Same modes as codebase analyzer
- `maxTokensPerGroup`: Max tokens per group (default: 900000, max: 950000)

**Output:** Returns `fileGroupsData` - a JSON string containing structured group information (file lists, metadata, tokens). This should be passed unmodified to `project_orchestrator_analyze`.

**⚠️ Important:** This is Step 1 of a 2-step workflow. Always follow up with `project_orchestrator_analyze`.

---

### 3. `project_orchestrator_analyze` (Step 2)
**Purpose:** Analyzes the file groups created in Step 1 and synthesizes results.

**When to use:**
- Always after `project_orchestrator_create`
- This is Step 2 of the orchestrator workflow

**Parameters:**
- `projectPath`: Same project path from Step 1
- `question`: Your analysis question (required)
- `fileGroupsData`: The JSON string from `project_orchestrator_create` output (contains group information - pass unmodified)
- `analysisMode`: Same as Step 1
- `maxTokensPerGroup`: Same as Step 1

**Output:** Comprehensive analysis synthesized from all groups

---

### 4. `gemini_dynamic_expert_create`
**Purpose:** Generates a custom expert persona prompt tailored to your project.

**When to use:**
- You need domain-specific expertise (e.g., React expert, Security auditor)
- You want specialized analysis perspective

**Parameters:**
- `projectPath`: Project directory path
- `expertiseHint`: Brief description of expertise needed (e.g., "React and TypeScript expert")

**Output:** Returns `expertPrompt` string to use in `gemini_dynamic_expert_analyze`

---

### 5. `gemini_dynamic_expert_analyze`
**Purpose:** Uses a custom expert persona to analyze your project.

**When to use:**
- After creating an expert with `gemini_dynamic_expert_create`
- When you want specialized, domain-specific analysis

**Parameters:**
- `projectPath`: Project directory path
- `question`: Your analysis question
- `expertPrompt`: The expert prompt from `gemini_dynamic_expert_create`

---

### 6. `calculate_token_count`
**Purpose:** Counts tokens for text or across a project using Gemini tokenizer.

**When to use:**
- Before deciding between codebase_analyzer vs orchestrator workflow
- To check if project is within token limits
- To estimate API costs

**Parameters:**
- `projectPath`: Project directory path (optional if analyzing text)
- `textToAnalyze`: Direct text to count tokens (optional)
- `tokenizerModel`: "gemini-2.0-flash" or "gpt-4o" (default: gemini-2.0-flash)

**Decision Guide:**
- < 200,000 tokens: Use `gemini_codebase_analyzer`
- > 200,000 tokens: Use orchestrator workflow (`project_orchestrator_create` → `project_orchestrator_analyze`)

---

## 🎯 Workflow Decision Tree

```
START
  ↓
  Is project size unknown?
  ├─ YES → Run calculate_token_count
  │         ↓
  │         < 200K tokens?
  │         ├─ YES → Use gemini_codebase_analyzer
  │         └─ NO  → Use orchestrator workflow
  │
  └─ NO  → Is project large (>1000 files)?
            ├─ YES → Use orchestrator workflow
            │        Step 1: project_orchestrator_create
            │        Step 2: project_orchestrator_analyze
            │
            └─ NO  → Use gemini_codebase_analyzer
                     
Need specialized expertise?
  → Use dynamic_expert_create + dynamic_expert_analyze
```

---

## 📝 Best Practices for AI Assistants

### 1. **Always check token count first for unknown projects**
```
calculate_token_count({ projectPath: "." })
```

### 2. **Use appropriate workflow based on size**
- Small/medium: Direct analysis with `gemini_codebase_analyzer`
- Large: Orchestrator workflow (2 steps)

### 3. **Pass context between orchestrator steps**
```
// Step 1
const result1 = project_orchestrator_create({ 
  projectPath: ".", 
  question: "Find security issues" 
});

// Step 2 - Use fileGroupsData from Step 1
project_orchestrator_analyze({ 
  projectPath: ".", 
  question: "Find security issues",
  fileGroupsData: result1.groupsData  // ← Pass this unmodified!
});
```

### 4. **Choose correct analysisMode**
- `general`: Overview, architecture understanding
- `security`: Security vulnerabilities, best practices
- `performance`: Performance bottlenecks, optimization
- `debugging`: Find bugs, logic errors
- `review`: Code quality review (can include git diffs)

### 5. **Handle errors gracefully**
- If `gemini_codebase_analyzer` times out → Suggest orchestrator workflow
- If token limit exceeded → Suggest filtering with `.mcpignore` or `.gitignore`

### 6. **Project path handling**
- Use relative paths (e.g., `"."`, `"./src"`) when working in project directory
- Absolute paths work but relative is preferred
- All paths must be within workspace for security

---

## 🔐 Security Notes

- All project paths are validated against `process.cwd()` to prevent path traversal
- API keys should be set as environment variables, never in code
- The `.mcpignore` file can exclude sensitive files (works like `.gitignore`)

---

## ⚡ Performance Tips

1. **Use `.mcpignore` to exclude:**
   - `node_modules/`
   - `dist/`, `build/`
   - Binary files, images, videos
   - Generated code

2. **For large projects:**
   - Always use orchestrator workflow
   - Set appropriate `maxTokensPerGroup` (default 900K is optimal)
   - Include a clear `question` parameter to help AI group files intelligently

3. **Rapid-fire processing:**
   - Orchestrator analyze uses parallel processing with 500ms stagger
   - Handles rate limits with exponential backoff (1s, 2s, 4s)

---

## 🚫 Common Mistakes to Avoid

❌ **Don't** use `gemini_codebase_analyzer` on projects > 1000 files
✅ **Do** use orchestrator workflow for large projects

❌ **Don't** forget to pass `fileGroupsData` to Step 2
✅ **Do** capture output from Step 1 and pass to Step 2 unmodified

❌ **Don't** skip token count check on unknown projects
✅ **Do** run `calculate_token_count` first

❌ **Don't** use absolute paths from outside workspace
✅ **Do** use relative paths or validated workspace paths

---

**🎓 End of MCP Gemini Local Usage Guide**

