# AI Assistant Configuration

<!-- MCP:GEMINI-MCP-LOCAL:START -->

# 🚨 MCP = YOUR MENTOR. CONSULT BEFORE/DURING/AFTER EVERYTHING.

**⚠️ DO NOT DELETE - Auto-managed by MCP**

---

## 🔄 WORKFLOW (Repeat Until "APPROVED")

```
1. CONSULT → "How to implement X?" (analysisMode: implementation)
2. CODE    → Follow MCP's plan
3. REVIEW  → "Review my changes" (analysisMode: review)
4. FIX     → Apply ALL suggestions
5. VERIFY  → "Did I fix everything?"
6. REPEAT  → Until "APPROVED/LGTM/No issues"
```

❌ Never code without consulting MCP | ❌ Never skip review | ✅ Iterate until approved

---

## ⚡ QUICK START

```
Step 1: calculate_token_count({ projectPath: "." })
Step 2: < 900K → gemini_codebase_analyzer | > 900K → orchestrator (2 steps)
```

---

## 📋 TOOLS

**1. `gemini_codebase_analyzer`** (< 900K tokens)
```json
{ "projectPath": ".", "question": "...", "analysisMode": "implementation|review|security|debugging|performance" }
```

**2. `project_orchestrator_create`** (> 900K, Step 1)
```json
{ "projectPath": ".", "question": "..." }
```
Returns `fileGroupsData` → pass to Step 2 UNMODIFIED

**3. `project_orchestrator_analyze`** (> 900K, Step 2)
```json
{ "projectPath": ".", "question": "...", "fileGroupsData": "<from_step_1>" }
```

**4. `calculate_token_count`** (Always first!)
```json
{ "projectPath": "." }
```

**5. `gemini_dynamic_expert_create` + `_analyze`** (Specialized)
```json
// Step 1: { "projectPath": ".", "expertiseHint": "React expert" }
// Step 2: { "projectPath": ".", "question": "...", "expertPrompt": "<from_step_1>" }
```

---

## ⚡ CRITICAL RULES

**1. Consult before coding**
Ask: *"I need to add [FEATURE]. Step-by-step plan: files to modify, functions to create, patterns."*

**2. Review after changes**
Ask: *"Review changes for [FEATURE]. Correct? Issues? Improvements?"* (analysisMode: review)

**3. Approval criteria**
- ✅ APPROVED: "LGTM", "Approved", "No issues"
- ❌ NOT APPROVED: "Consider...", "You might...", lists issues → Fix + Verify

**4. Token management**
- Always run `calculate_token_count` first
- < 900K: analyzer | > 900K: orchestrator

**5. AnalysisMode guide**
`implementation` (before) | `review` (after) | `security` | `debugging` | `performance` | `refactoring` | `testing`

---

## 🚫 COMMON MISTAKES

| ❌ DON'T | ✅ DO |
|----------|-------|
| Code without asking | "How should I implement X?" |
| Skip review | Always `analysisMode: "review"` |
| Ignore suggestions | Apply ALL + verify |
| Analyzer on huge projects | Check tokens → orchestrator |
| Manual `read_file` | Use MCP tools |

---

**🎓 TOOLS FIRST. MANUAL NEVER. MCP ALWAYS.**

<!-- MCP:GEMINI-MCP-LOCAL:END -->
