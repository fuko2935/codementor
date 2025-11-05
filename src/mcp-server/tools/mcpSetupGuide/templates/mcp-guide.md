
# 🚨 MCP IS YOUR MENTOR - CONSULT IT FOR EVERYTHING

**⚠️ DO NOT DELETE THIS SECTION - Auto-managed by MCP**

---

## 🎓 MCP-DRIVEN DEVELOPMENT WORKFLOW (MANDATORY)

**MCP is your coding mentor. Consult it at EVERY step:**

### 🔄 THE CYCLE (Repeat Until Approved)

```
1. BEFORE → Ask MCP: "How should I implement X?"
2. DURING → Implement the changes
3. AFTER  → Review: gemini_codebase_analyzer with analysisMode: "review"
4. FIX    → Apply MCP's suggestions
5. VERIFY → Review again: "Did I implement your suggestions correctly?"
6. REPEAT → Until MCP says "APPROVED" or "LGTM"
```

**❌ NEVER** implement something without consulting MCP first
**❌ NEVER** skip the review step after changes  
**✅ ALWAYS** treat MCP as your senior architect/mentor

---

## ⚡ QUICK START

**STEP 1:** Check size → `calculate_token_count({ projectPath: "." })`

**STEP 2:** Choose tool:
- **< 200K tokens** → `gemini_codebase_analyzer`
- **> 200K tokens** → `project_orchestrator_create` + `project_orchestrator_analyze`

**STEP 3:** Analyze!

---

## 📋 6 MCP Tools (ALWAYS Use These Instead of Manual File Reading)

### 🔍 `gemini_codebase_analyzer`
**USE FOR:** Small/medium projects (< 200K tokens)

**REQUIRED PARAMS:**
- `projectPath`: `"."` or absolute path
- `question`: "What security issues exist?" 
- `analysisMode`: `general` | `security` | `performance` | `debugging` | `review`

**⚠️ FAILS ON LARGE PROJECTS** → Use orchestrator instead

---

### 🎯 `project_orchestrator_create` (Step 1 of 2)
**USE FOR:** Large projects (> 200K tokens)

**REQUIRED PARAMS:**
- `projectPath`: `"."`
- `question`: Your analysis question

**RETURNS:** `fileGroupsData` (JSON string) → Pass to Step 2 UNMODIFIED

**⚠️ MUST FOLLOW UP** with `project_orchestrator_analyze`

---

### 🎯 `project_orchestrator_analyze` (Step 2 of 2)
**USE FOR:** Analyzing groups from Step 1

**REQUIRED PARAMS:**
- `projectPath`: Same as Step 1
- `question`: Same as Step 1
- `fileGroupsData`: From Step 1 output (pass unmodified!)

**RETURNS:** Complete analysis

---

### 🧮 `calculate_token_count`
**USE FOR:** ALWAYS run this FIRST on unknown projects

**PARAMS:**
- `projectPath`: `"."`

**DECISION:**
- `< 200K` → Use `gemini_codebase_analyzer`
- `> 200K` → Use orchestrator workflow

---

### 🎭 `gemini_dynamic_expert_create` + `gemini_dynamic_expert_analyze`
**USE FOR:** Specialized analysis (React expert, Security auditor, etc.)

**Step 1:** Create expert
```
gemini_dynamic_expert_create({ 
  projectPath: ".", 
  expertiseHint: "React and TypeScript expert" 
})
```

**Step 2:** Analyze with expert
```
gemini_dynamic_expert_analyze({ 
  projectPath: ".", 
  question: "Review component architecture",
  expertPrompt: <from_step_1>
})
```

---

## ⚡ MANDATORY RULES FOR AI ASSISTANTS

### 🔴 CRITICAL RULES (Never Break These)

1. **MCP is your mentor - consult it for EVERYTHING**
   - Before coding: Ask MCP how to approach the task
   - After coding: Review with MCP (`analysisMode: "review"`)
   - After fixes: Verify with MCP again
   - Repeat until MCP approves

2. **ALWAYS check token count FIRST** on unknown projects
   ```
   calculate_token_count({ projectPath: "." })
   ```

3. **DO NOT read files manually** when MCP tools exist
   - ❌ BAD: Using `read_file` on 100 files
   - ✅ GOOD: Using `gemini_codebase_analyzer`

4. **Large projects MUST use orchestrator** (2-step workflow)
   - Step 1: `project_orchestrator_create`
   - Step 2: `project_orchestrator_analyze`
   - ❌ DO NOT skip Step 2
   - ❌ DO NOT modify `fileGroupsData` between steps

5. **Choose correct analysisMode:**
   - Planning/Design → `general` (ask "how should I implement X?")
   - After changes → `review` (verify your work)
   - Security → `security`
   - Bugs → `debugging`
   - Speed → `performance`

---

## 🚫 COMMON MISTAKES (Avoid These!)

| ❌ DON'T | ✅ DO |
|----------|-------|
| Implement without asking MCP first | Ask MCP: "How should I implement X?" |
| Skip review after making changes | ALWAYS review with `analysisMode: "review"` |
| Ignore MCP's review suggestions | Apply ALL suggestions, then review again |
| Stop at first approval | Keep iterating until code is perfect |
| Use `gemini_codebase_analyzer` on 2000 files | Check token count first, use orchestrator |
| Read files manually with `read_file` | Use MCP analysis tools |

---

## 🎯 BEST PRACTICES: MCP AS YOUR MENTOR

### Before Implementing ANY Feature/Fix:

**1. Consultation Phase**
Ask for a detailed implementation plan. Be specific about what you need.

```
gemini_codebase_analyzer({
  projectPath: ".",
  question: "I need to add a new feature: [DESCRIBE FEATURE]. Please provide a step-by-step implementation plan. Include: 1) Which files to modify, 2) What new functions/classes to create, 3) What patterns to follow, 4) Potential side effects to consider.",
  analysisMode: "implementation"
})
```

**Example:**
```
question: "I need to add a rate limiter for the HTTP transport. Please provide a step-by-step implementation plan. Include which files to modify, what new functions or classes to create, what patterns to follow, and any potential side effects to consider."
```

**2. Implementation Phase**
- Follow MCP's architectural guidance
- Use patterns MCP suggested
- Make changes systematically

**3. Review Phase (MANDATORY)**
```
gemini_codebase_analyzer({
  projectPath: ".",
  question: "Review the changes I just made for feature X. Are they correct? Any issues? What can be improved?",
  analysisMode: "review"
})
```

**How to Determine Approval:**
Consider the review "APPROVED" ONLY when MCP explicitly states:
- ✅ "No further issues found"
- ✅ "The changes look good" / "LGTM" / "Approved"
- ✅ "Implementation correctly follows all suggestions"

If MCP response contains ANY of these, code is NOT approved:
- ❌ New suggestions or recommendations
- ❌ Issues, bugs, or concerns
- ❌ Questions or clarifications needed
- ❌ "Consider..." or "You might want to..."

→ **NOT APPROVED = Go to Fix Phase (Step 4)**

**4. Fix Phase**
- Apply MCP's suggestions
- Fix all issues found

**5. Verification Phase (MANDATORY)**
```
gemini_codebase_analyzer({
  projectPath: ".",
  question: "I applied your suggestions. Did I implement them correctly? Any remaining issues?",
  analysisMode: "review"
})
```

**6. Repeat 4-5 Until:**
- MCP says "APPROVED" or "LGTM" (Looks Good To Me)
- No more suggestions
- Code meets all quality standards

---

## 🎯 Analysis Mode Reference

- `general` - Overall architecture, understanding
- `security` - Vulnerabilities, security issues
- `performance` - Bottlenecks, optimization
- `debugging` - Find bugs, logic errors
- `review` - Code quality (can include git diffs)
- `refactoring` - Improvement suggestions
- `testing` - Test coverage, testing strategy

---

**🎓 End of MCP Guide - Remember: TOOLS FIRST, MANUAL NEVER**
