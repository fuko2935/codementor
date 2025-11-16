# Implementation Plan

- [x] 1. Create tool directory structure and core files
  - Create `src/mcp-server/tools/createAnalysisMode/` directory
  - Create `index.ts`, `logic.ts`, and `registration.ts` files
  - _Requirements: 1.1, 2.1, 3.1_

- [x] 2. Implement input schema and types in logic.ts
  - [x] 2.1 Define `CreateAnalysisModeInputSchema` with Zod
    - Add `expertiseHint` field with validation
    - Add `withAi` boolean field with default false
    - Add optional `projectPath` field
    - Add optional `geminiApiKey` and `temporaryIgnore` fields
    - _Requirements: 1.1, 2.1, 3.1, 6.1_
  - [x] 2.2 Define `CreateAnalysisModeResponse` interface
    - Add `modeType`, `analysisModePrompt`, and `sourceHint` fields
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [x] 2.3 Export input type using `z.infer`
    - _Requirements: 1.1_

- [x] 3. Implement mode detection logic
  - [x] 3.1 Create `detectMode` helper function
    - Return "manual" when `withAi` is false
    - Return "ai_project_generated" when `withAi` is true and `projectPath` exists
    - Return "ai_generated" when `withAi` is true and no `projectPath`
    - _Requirements: 1.1, 2.1, 3.1_

- [x] 4. Implement manual mode processing
  - [x] 4.1 Create `processManualMode` function
    - Validate `expertiseHint` is non-empty
    - Return structured response with `modeType: "manual"`
    - Use `expertiseHint` directly as `analysisModePrompt`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 5. Implement AI-assisted general mode processing
  - [x] 5.1 Create `processAiGeneralMode` function
    - Construct AI prompt using general template
    - Invoke Gemini API with prompt
    - Extract generated prompt from response
    - Return structured response with `modeType: "ai_generated"`
    - Handle API errors with SERVICE_UNAVAILABLE
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 6. Implement project-specific mode processing
  - [x] 6.1 Create `processProjectSpecificMode` function
    - Validate `projectPath` with `validateSecurePath`
    - Check directory exists, throw NOT_FOUND if missing
    - Read project context using `prepareFullContext`
    - Construct AI prompt with project-specific template
    - Invoke Gemini API with prompt and context
    - Extract generated prompt from response
    - Return structured response with `modeType: "ai_project_generated"`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 7. Implement main logic function
  - [x] 7.1 Create `createAnalysisModeLogic` function
    - Accept `params` and `context` parameters
    - Log operation start with sanitized params
    - Detect mode using `detectMode`
    - Route to appropriate processing function
    - Log operation completion
    - Propagate errors as McpError
    - _Requirements: 1.1, 2.1, 3.1, 6.5, 7.1, 7.2, 7.3, 7.4_

- [-] 8. Implement MCP registration
  - [x] 8.1 Create registration handler in registration.ts
    - Register tool with MCP server
    - Create request context from mcpContext
    - Wrap logic call in try-catch
    - Format success response as CallToolResult
    - Handle errors with ErrorHandler
    - Convert to McpError and format error response
    - Log all operations with context
    - _Requirements: 5.1, 5.2, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3_

- [x] 9. Create barrel export
  - Export `registerCreateAnalysisMode` from index.ts
  - _Requirements: 5.1_

- [x] 10. Register tool in server
  - [x] 10.1 Import tool in server.ts
    - Add import statement for `registerCreateAnalysisMode`
    - _Requirements: 5.1_
  - [x] 10.2 Register in createMcpServerInstance
    - Call `await registerCreateAnalysisMode(server)`
    - _Requirements: 5.1, 5.2_

- [x] 11. Add integration example to README
  - Document two-step workflow (create mode, use in analyzer)
  - Show all three mode examples
  - _Requirements: 5.3_
