# Requirements Document

## Introduction

This document defines requirements for a flexible analysis mode creation tool within the MCP server. The tool enables users to create custom expert system prompts through three distinct approaches: manual definition, AI-assisted generation, or project-specific AI generation. These modes integrate with the existing `gemini_codebase_analyzer` tool via its `customExpertPrompt` parameter.

## Glossary

- **Analysis Mode**: A specialized expert system prompt that guides code analysis behavior
- **MCP Server**: Model Context Protocol server that hosts analysis tools
- **Expert Prompt**: A system instruction that defines the expertise and focus of code analysis
- **Manual Mode**: User directly provides the complete expert prompt without AI assistance
- **AI-Assisted Mode**: AI generates a general expert prompt based on user's hint
- **Project-Specific Mode**: AI generates an expert prompt tailored to the specific project's codebase
- **gemini_codebase_analyzer**: Existing MCP tool that performs code analysis using expert prompts
- **Zod Schema**: TypeScript schema validation library used for input validation

## Requirements

### Requirement 1

**User Story:** As a developer, I want to manually define my own expert prompt, so that I have complete control over the analysis behavior without AI intervention.

#### Acceptance Criteria

1. WHEN the user provides `expertiseHint` with `withAi: false`, THE System SHALL use the `expertiseHint` text directly as the analysis mode prompt
2. THE System SHALL return a structured response with `modeType: "manual"`, the original prompt text, and the source hint
3. THE System SHALL NOT invoke any AI service when `withAi` is false
4. THE System SHALL validate that `expertiseHint` is a non-empty string

### Requirement 2

**User Story:** As a developer, I want AI to generate a general expert mode based on my description, so that I can quickly create specialized analysis modes without writing detailed prompts.

#### Acceptance Criteria

1. WHEN the user provides `expertiseHint` with `withAi: true` and no `projectPath`, THE System SHALL invoke the AI service to generate a general expert prompt
2. THE System SHALL construct an AI prompt requesting an expert system prompt based on the user's hint
3. THE System SHALL return a structured response with `modeType: "ai_generated"`, the AI-generated prompt, and the source hint
4. IF the AI service fails, THEN THE System SHALL throw a SERVICE_UNAVAILABLE error with provider details

### Requirement 3

**User Story:** As a developer, I want AI to analyze my project and create a project-specific expert mode, so that the analysis is tailored to my codebase's architecture and patterns.

#### Acceptance Criteria

1. WHEN the user provides `expertiseHint` with `withAi: true` and a valid `projectPath`, THE System SHALL read the project's code content
2. THE System SHALL validate the `projectPath` using `validateSecurePath` to prevent path traversal
3. THE System SHALL invoke the AI service with both the project context and user's hint to generate a project-specific prompt
4. THE System SHALL return a structured response with `modeType: "ai_project_generated"`, the AI-generated prompt, and the source hint
5. IF the project path does not exist, THEN THE System SHALL throw a NOT_FOUND error

### Requirement 4

**User Story:** As a developer, I want the tool to return structured JSON output, so that I can easily integrate the generated mode with other tools programmatically.

#### Acceptance Criteria

1. THE System SHALL return a JSON object containing `modeType`, `analysisModePrompt`, and `sourceHint` fields
2. THE `modeType` field SHALL be one of: "manual", "ai_generated", or "ai_project_generated"
3. THE `analysisModePrompt` field SHALL contain the complete expert prompt text
4. THE `sourceHint` field SHALL contain the original user-provided `expertiseHint`

### Requirement 5

**User Story:** As a developer, I want the generated analysis mode to integrate seamlessly with `gemini_codebase_analyzer`, so that I can use custom modes in my code analysis workflow.

#### Acceptance Criteria

1. THE System SHALL generate prompts compatible with the `customExpertPrompt` parameter of `gemini_codebase_analyzer`
2. WHEN a generated `analysisModePrompt` is provided to `gemini_codebase_analyzer` as `customExpertPrompt`, THE analyzer SHALL use it as the system instruction
3. THE System SHALL document the integration workflow in the tool description

### Requirement 6

**User Story:** As a developer, I want proper error handling and validation, so that I receive clear feedback when inputs are invalid or operations fail.

#### Acceptance Criteria

1. THE System SHALL validate all input parameters using Zod schema before processing
2. IF `expertiseHint` is empty, THEN THE System SHALL throw a VALIDATION_ERROR
3. IF `withAi: true` and AI service is unavailable, THEN THE System SHALL throw a SERVICE_UNAVAILABLE error
4. IF `projectPath` contains path traversal attempts, THEN THE System SHALL throw a VALIDATION_ERROR
5. THE System SHALL log all operations with request context for traceability

### Requirement 7

**User Story:** As a developer, I want the tool to follow the project's security practices, so that my codebase remains protected from vulnerabilities.

#### Acceptance Criteria

1. THE System SHALL validate all file paths using `validateSecurePath` with `BASE_DIR` constraint
2. THE System SHALL sanitize all logged parameters to prevent secret leakage
3. THE System SHALL use structured logging with request context
4. THE System SHALL throw McpError with appropriate error codes for all failure scenarios
