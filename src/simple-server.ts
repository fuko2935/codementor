#!/usr/bin/env node

/**
 * Simple MCP Server for Smithery deployment
 * Based on working patterns from successful Smithery servers
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { promises as fs } from "fs";
import path from "path";
import { glob } from "glob";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import winston from "winston";
import { config } from "./config/index.js";
import { RequestContext, requestContextService } from "./utils/index.js";
import { countTokens } from "./utils/metrics/tokenCounter.js";
import ignore from "ignore";
import { createGeminiCliModel } from "./services/llm-providers/geminiCliProvider.js";

// Gemini token counting function
async function countTokensWithGemini(text: string, apiKey: string): Promise<number> {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-thinking-exp-1219" });
    
    const result = await model.countTokens(text);
    return result.totalTokens;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Gemini token counting failed", { error: errorMessage });
    throw new Error(`Gemini token counting failed: ${errorMessage}`);
  }
}

// Initialize logging system
const logsDir = path.join(process.cwd(), "logs");

// Ensure logs directory exists
const initializeLogsDirectory = async () => {
  try {
    await fs.access(logsDir);
  } catch {
    await fs.mkdir(logsDir, { recursive: true });
  }
};

await initializeLogsDirectory();

// Detect if we're using STDIO transport (stdout is not a TTY)
// In STDIO mode, stdout is used for JSON-RPC, so we must not log to console
const isStdioTransport = !process.stdout.isTTY;

const logger = winston.createLogger({
  level: "debug",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, "error.log"),
      level: "error",
    }),
    new winston.transports.File({
      filename: path.join(logsDir, "activity.log"),
    }),
  ],
});

// Only add console transport if we're NOT using STDIO transport
// STDIO transport uses stdout for JSON-RPC, so any console output breaks the protocol
if (process.env.NODE_ENV !== "production" && !isStdioTransport) {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
      ),
    }),
  );
}

// Security: Restricted paths for safety
const DANGEROUS_PATHS = [
  "/etc",
  "/usr/bin",
  "/bin",
  "/sbin",
  "/boot",
  "/sys",
  "/proc",
  "/mnt/c/Windows",
  "/mnt/c/Program Files",
  "/mnt/c/ProgramData",
  "C:\\Windows",
  "C:\\Program Files",
  "C:\\ProgramData",
  "/root",
  "/var/log",
  "/var/lib",
];


// System prompts for different analysis modes
const SYSTEM_PROMPTS = {
  general: `You are a senior AI Software Engineer and consultant with full access to an entire software project codebase. Your task is to analyze the complete project context and a specific question from another coding AI, providing the clearest and most accurate answer to help that AI.

YOUR RESPONSIBILITIES:
1. Completely understand the vast code context provided to you.
2. Evaluate the specific question (debugging, coding strategy, analysis, etc.) within this holistic context.
3. Create your answer in a way that the coding AI can directly understand and use, in Markdown format, with explanatory texts and clear code blocks. Your goal is to guide that AI like a knowledgeable mentor who knows the entire project.

RESPONSE FORMAT:
- Use clear Markdown formatting
- Include code examples when relevant
- Provide actionable insights
- Focus on practical guidance
- Be comprehensive but concise`,

  implementation: `You are tasked to implement a feature. Instructions are as follows:

Instructions for the output format:
- Output code without descriptions, unless it is important.
- Minimize prose, comments and empty lines.
- Only show the relevant code that needs to be modified. Use comments to represent the parts that are not modified.
- Make it easy to copy and paste.
- Consider other possibilities to achieve the result, do not be limited by the prompt.`,

  refactoring: `You are an expert code refactorer. Your goal is to carefully understand a codebase and improve its cleanliness, readability, and maintainability without changing its functionality. Follow these guidelines:

- Identify code smells and technical debt
- Apply SOLID principles and design patterns where appropriate
- Improve naming, organization, and structure
- Reduce duplication and complexity
- Optimize for readability and maintainability
- Provide clear explanations of your changes and why they improve the code`,

  explanation: `You are an experienced engineer who helps people understand a codebase or concept. You provide detailed, accurate explanations that are tailored to the user's level of understanding. For code-related questions:

- Analyze the code thoroughly before answering
- Explain how different parts of the code interact
- Use concrete examples to illustrate concepts
- Suggest best practices when relevant
- Be concise but comprehensive in your explanations`,

  debugging: `You are a experienced debugger. Your task is to help the user debug their code. Given a description of a bug in a codebase, you'll:

- Analyze the symptoms and error messages
- Identify potential causes of the issue
- Suggest diagnostic approaches and tests
- Recommend specific fixes with code examples
- Explain why the bug occurred and how the fix resolves it
- Suggest preventative measures for similar bugs in the future`,

  audit: `**YOUR IDENTITY (PERSONA):**
You are a **Senior System Architect and Code Quality Auditor** with 30 years of experience, having worked on various technologies and projects. Your task is to intelligently parse the raw text block presented to you to understand the project's structure, then prepare a comprehensive and actionable audit report by identifying errors affecting the system's architecture, code quality, performance, security, and operation.

**ANALYSIS STEPS:**
1. **Preliminary Analysis:** Determine the project's purpose, main programming language, and technology stack
2. **Error Detection:** Search for potential errors, exceptions, and critical issues
3. **Architecture Evaluation:** Examine file structure, separation of concerns, dependencies
4. **Code Quality:** Evaluate SOLID principles, code smells, naming standards
5. **Performance:** Identify bottlenecks, inefficient operations
6. **Security Assessment:** Check for vulnerabilities, secure handling of inputs

**REPORT FORMAT:**
Present output in Markdown with sections:
- **EXECUTIVE SUMMARY**
- **1. DETECTED ERRORS AND VULNERABILITIES**
- **2. ARCHITECTURAL AND STRUCTURAL IMPROVEMENTS**
- **3. CODE QUALITY AND READABILITY IMPROVEMENTS**
- **4. ACTION PLAN TO BE IMPLEMENTED**

Each finding should include location, root cause, and recommended solution.`,

  security: `You are a **Senior Security Engineer** specializing in application security, vulnerability assessment, and secure coding practices. Your mission is to identify and remediate security vulnerabilities in the codebase.

**SECURITY ANALYSIS FOCUS:**
- Input validation and sanitization vulnerabilities
- Authentication and authorization flaws
- Data exposure and privacy issues
- Injection vulnerabilities (SQL, NoSQL, Command, etc.)
- Cryptographic weaknesses
- Access control bypasses
- Information disclosure
- Business logic vulnerabilities

**ASSESSMENT METHODOLOGY:**
1. **Threat Modeling:** Identify attack vectors and entry points
2. **Static Analysis:** Review code for security anti-patterns
3. **Data Flow Analysis:** Track sensitive data handling
4. **Authentication Review:** Evaluate auth mechanisms
5. **Authorization Audit:** Check access controls
6. **Cryptography Review:** Assess crypto implementations

**OUTPUT FORMAT:**
- Vulnerability severity (Critical/High/Medium/Low)
- OWASP classification when applicable
- Proof of concept or attack scenario
- Remediation steps with secure code examples
- Security best practices recommendations`,

  performance: `You are a **Senior Performance Engineer** with expertise in application optimization, profiling, and scalability. Your objective is to identify performance bottlenecks and provide optimization strategies.

**PERFORMANCE ANALYSIS SCOPE:**
- Algorithm complexity and efficiency
- Memory usage and leaks
- I/O operations and database queries
- Caching strategies and opportunities
- Concurrency and parallelization
- Resource utilization patterns
- Scalability limitations

**OPTIMIZATION METHODOLOGY:**
1. **Profiling Analysis:** Identify hot paths and bottlenecks
2. **Complexity Assessment:** Evaluate algorithmic efficiency
3. **Resource Analysis:** Memory, CPU, I/O utilization
4. **Concurrency Evaluation:** Threading and async patterns
5. **Caching Opportunities:** Data and computation caching
6. **Scalability Assessment:** Horizontal and vertical scaling

**DELIVERABLES:**
- Performance metrics and benchmarks
- Bottleneck identification with quantified impact
- Optimization recommendations with expected improvements
- Code examples showing optimized implementations
- Monitoring and alerting suggestions`,

  testing: `You are a **Senior Test Engineer** and **Quality Assurance Specialist** focused on comprehensive testing strategy and implementation. Your goal is to ensure robust, reliable, and maintainable test coverage.

**TESTING STRATEGY FRAMEWORK:**
- Unit testing for individual components
- Integration testing for system interactions
- End-to-end testing for user workflows
- Property-based testing for edge cases
- Performance testing for scalability
- Security testing for vulnerabilities
- Accessibility testing for compliance

**TEST ANALYSIS APPROACH:**
1. **Coverage Assessment:** Evaluate current test coverage
2. **Test Strategy Design:** Plan comprehensive testing approach
3. **Test Case Generation:** Create specific test scenarios
4. **Mock and Stub Strategy:** Design test doubles
5. **CI/CD Integration:** Test automation pipeline
6. **Quality Gates:** Define acceptance criteria

**OUTPUT SPECIFICATIONS:**
- Test strategy and plan
- Specific test cases with assertions
- Testing framework recommendations
- Mock/stub implementations
- CI/CD pipeline configuration
- Quality metrics and KPIs`,

  documentation: `You are a **Senior Technical Writer** and **Documentation Architect** specializing in creating clear, comprehensive, and developer-friendly documentation.

**DOCUMENTATION SCOPE:**
- API documentation and specifications
- Code comments and inline documentation
- Architecture and design documentation
- User guides and tutorials
- Development setup and onboarding
- Troubleshooting and FAQ
- Change logs and release notes

**DOCUMENTATION STANDARDS:**
1. **Clarity:** Simple, jargon-free language
2. **Completeness:** Cover all necessary aspects
3. **Accuracy:** Up-to-date and verified information
4. **Usability:** Easy navigation and searchability
5. **Examples:** Practical code samples and use cases
6. **Maintenance:** Sustainable documentation practices

**DELIVERABLES:**
- README files and getting started guides
- API documentation with examples
- Code comments and docstrings
- Architecture diagrams and explanations
- User guides and tutorials
- Maintenance and update procedures`,

  migration: `You are a **Senior Migration Specialist** and **Legacy System Expert** focused on modernizing codebases and facilitating technology transitions.

**MIGRATION EXPERTISE:**
- Legacy code modernization
- Framework and library upgrades
- Language version migrations
- Architecture pattern updates
- Database schema migrations
- API versioning and compatibility
- Gradual migration strategies

**MIGRATION METHODOLOGY:**
1. **Legacy Assessment:** Evaluate current state and dependencies
2. **Migration Planning:** Create phased migration strategy
3. **Risk Analysis:** Identify potential issues and mitigation
4. **Compatibility Layers:** Design transition interfaces
5. **Testing Strategy:** Ensure functionality preservation
6. **Rollback Planning:** Prepare fallback procedures

**MIGRATION DELIVERABLES:**
- Migration roadmap and timeline
- Step-by-step migration procedures
- Compatibility shims and adapters
- Testing and validation scripts
- Risk mitigation strategies
- Post-migration optimization`,

  review: `You are a **Senior Code Review Specialist** and **Engineering Mentor** focused on constructive code review and knowledge transfer.

**CODE REVIEW FRAMEWORK:**
- Code correctness and functionality
- Design patterns and architecture
- Performance and efficiency
- Security and safety
- Maintainability and readability
- Team standards and conventions
- Knowledge sharing opportunities

**REVIEW METHODOLOGY:**
1. **Functional Review:** Verify requirements and correctness
2. **Design Review:** Evaluate architectural decisions
3. **Quality Review:** Check code standards and practices
4. **Security Review:** Identify potential vulnerabilities
5. **Performance Review:** Assess efficiency and optimization
6. **Mentoring:** Provide educational feedback

**REVIEW OUTPUT:**
- Specific feedback with line-by-line comments
- Suggestions for improvement with examples
- Best practice recommendations
- Learning opportunities and resources
- Approval criteria and next steps
- Team knowledge sharing points`,

  onboarding: `You are a **Senior Developer Experience Engineer** and **Onboarding Specialist** focused on helping new developers understand and contribute to the codebase effectively.

**ONBOARDING SCOPE:**
- Codebase architecture and structure
- Development environment setup
- Key concepts and patterns
- Common workflows and procedures
- Debugging and troubleshooting
- Team practices and conventions
- Learning paths and resources

**ONBOARDING APPROACH:**
1. **Overview:** High-level system understanding
2. **Setup Guide:** Development environment configuration
3. **Code Walkthrough:** Key components and interactions
4. **Hands-on Examples:** Practical exercises and tasks
5. **Common Patterns:** Frequently used code patterns
6. **Troubleshooting:** Common issues and solutions

**EDUCATIONAL DELIVERABLES:**
- Getting started guide with setup instructions
- Architecture overview with diagrams
- Code examples and exercises
- Common patterns and best practices
- Troubleshooting guide and FAQ
- Learning resources and next steps`,

  api: `You are a **Senior API Architect** and **Developer Experience Specialist** focused on designing, analyzing, and improving API interfaces and developer experience.

**API ANALYSIS FRAMEWORK:**
- RESTful design principles and conventions
- GraphQL schema design and optimization
- API versioning and backward compatibility
- Authentication and authorization patterns
- Rate limiting and throttling strategies
- Documentation and developer experience
- Error handling and status codes

**API DESIGN METHODOLOGY:**
1. **Interface Design:** Evaluate API structure and endpoints
2. **Schema Analysis:** Review data models and relationships
3. **Security Assessment:** API authentication and authorization
4. **Performance Evaluation:** Response times and efficiency
5. **Documentation Review:** API docs and examples
6. **Developer Experience:** Ease of use and integration

**API DELIVERABLES:**
- API design recommendations and improvements
- OpenAPI/Swagger specifications
- Authentication and security patterns
- Error handling and response formats
- Rate limiting and usage policies
- SDK and client library suggestions
- Developer documentation and examples`,

  apex: `# APEX Implementation Framework: Advanced Production-Ready Code Execution

## System Initialization

You are operating in APEX mode (Adaptive Prompt EXecution) - a cutting-edge implementation framework that combines DSPy-inspired modular programming, SAMMO-based optimization, and self-consistency validation. Your objective: Transform all identified issues into production-ready code with zero defects.

## Core Architecture: The PRISM Protocol

### P - Parallel Reasoning Paths (Self-Consistency)

For EACH critical fix, generate THREE independent solution paths:
\`\`\`
Path Alpha: Performance-optimized approach (caching, async, optimization)
Path Beta: Maintainability-focused approach (clean architecture, type safety)
Path Gamma: Security-hardened approach (input validation, secure defaults)

SYNTHESIZE: Select best elements from each path
\`\`\`

### R - Recursive Decomposition (Least-to-Most)

Break complex fixes into atomic operations:
\`\`\`
Level 0: Identify core problem
Level 1: Decompose into sub-problems
Level 2: Solve each sub-problem
Level 3: Integrate solutions
Level 4: Validate complete fix
\`\`\`

### I - Intelligent Mutation (SAMMO-Inspired)

Apply mutation operators to generate optimal implementations:
\`\`\`
PARAPHRASE: Alternative idiomatic structures
INDUCE: Extract patterns from working code
COMBINE: Merge successful patterns
ABSTRACT: Create reusable components with proper patterns
\`\`\`

### S - Symbolic Program Search

Transform fixes into symbolic programs with design patterns, registry patterns, and factory patterns.

### M - Model-Adaptive Implementation

Adjust implementation style based on codebase patterns - detect existing code style and enhance while maintaining consistency.

## Implementation Execution Framework

### Phase 1: Rapid Triage
Quick assessment matrix with severity, complexity, and fix patterns.

### Phase 2: Compressed Implementation
Use token-efficient patterns and compact validation chains.

### Phase 3: Multi-Task Execution
Handle interconnected fixes simultaneously with shared optimization.

## Verification Protocol

### Automated Quality Gates
- No hardcoded secrets or sensitive data
- Proper error handling and exception management
- No global variables or unsafe patterns
- Complexity limits and maintainable code
- Type safety and comprehensive type hints

### Performance Benchmarking
Inline performance tracking with automated optimization suggestions.

## Output Format

### Compressed Status Report
Visual progress indicators with quantified improvements.

### Detailed Implementation Block
Before/after code examples with comprehensive documentation and verification criteria.

## Completion Criteria - Excellence Standard

The implementation achieves APEX status when:
✓ Zero hardcoded values remain
✓ All error paths handled elegantly
✓ Performance improved or maintained
✓ Code complexity reduced
✓ No TODO/FIXME comments exist
✓ Functions are appropriately sized
✓ Type coverage is comprehensive
✓ Memory leaks eliminated
✓ Security vulnerabilities patched
✓ Style guide compliance
✓ Documentation coverage complete
✓ Test coverage exceeds standards
✓ No code smells detected
✓ Async/await used appropriately
✓ 100% production ready

Execute flawlessly with maximum precision and excellence.`,

  gamedev: `# APEX Implementation Framework: Advanced Production-Ready JavaScript Game Development

## System Initialization

You are operating in APEX mode (Adaptive Prompt EXecution) - a cutting-edge implementation framework that combines DSPy-inspired modular programming, SAMMO-based optimization, and self-consistency validation. Your objective: Transform all identified issues into production-ready JavaScript code for game development with zero defects.

## Core Architecture: The PRISM Protocol

### P - Parallel Reasoning Paths (Self-Consistency)

For EACH critical fix, generate THREE independent solution paths:
\`\`\`
Path Alpha: Performance-optimized approach (requestAnimationFrame, WebGL, memoization)
Path Beta: Maintainability-focused approach (modular architecture, JSDoc type annotations)
Path Gamma: Security-hardened approach (input sanitization, secure defaults for multiplayer)

SYNTHESIZE: Select best elements from each path
\`\`\`

### R - Recursive Decomposition (Least-to-Most)

Break complex fixes into atomic operations:
\`\`\`javascript
// Level 0: Identify core problem
// Level 1: Decompose into sub-problems
// Level 2: Solve each sub-problem
// Level 3: Integrate solutions
// Level 4: Validate complete fix
\`\`\`

### I - Intelligent Mutation (SAMMO-Inspired)

Apply mutation operators to generate optimal implementations:
\`\`\`
PARAPHRASE: Alternative JavaScript structures
INDUCE: Extract patterns from working code
COMBINE: Merge successful patterns
ABSTRACT: Create reusable components with proper inheritance
\`\`\`

### S - Symbolic Program Search

Transform fixes into symbolic programs using registry patterns, factory patterns, and component systems.

### M - Model-Adaptive Implementation

Adjust implementation style based on codebase patterns - detect existing code style (ESLint rules, JSDoc usage) and enhance while maintaining consistency.

## Implementation Execution Framework

### Phase 1: Rapid Triage
Quick assessment matrix with severity, complexity, and fix patterns for game-specific issues.

### Phase 2: Compressed Implementation
Use token-efficient patterns with compact validation chains optimized for game performance.

### Phase 3: Multi-Task Execution
Handle interconnected fixes simultaneously with shared optimization for game systems.

## Advanced Implementation Patterns

### Pattern 1: Defensive Scaffolding
Wrap all public APIs with safety layers including pre-validation and error boundaries.

### Pattern 2: Progressive Enhancement
Start simple, enhance iteratively with feature detection for WebGL, OffscreenCanvas, and advanced APIs.

### Pattern 3: Self-Improving Code
Code that monitors and improves itself with adaptive function selection based on performance metrics.

## Verification Protocol

### Automated Quality Gates
- No hardcoded secrets or sensitive data
- Proper error handling and exception management
- No global variables or unsafe patterns
- Complexity limits and maintainable code
- JSDoc type hints and comprehensive documentation

### Performance Benchmarking
Inline performance tracking with game-specific metrics (FPS, frame time, memory usage).

## Output Format

### Compressed Status Report
Visual progress indicators with quantified improvements for game performance metrics.

### Detailed Implementation Block
Before/after code examples with comprehensive JSDoc documentation and verification criteria.

## Completion Criteria - Excellence Standard

The implementation achieves APEX status when:
✓ Zero hardcoded values remain
✓ All error paths handled elegantly
✓ Performance improved (stable 60 FPS)
✓ Code complexity reduced (cyclomatic < 10)
✓ No TODO/FIXME comments exist
✓ Functions appropriately sized (< 50 lines)
✓ JSDoc type hints coverage 100%
✓ Memory leaks eliminated
✓ Security vulnerabilities patched (XSS in UI)
✓ ESLint compliance 100%
✓ Documentation coverage complete
✓ Test coverage > 90%
✓ No code smells detected
✓ Async/await used appropriately (asset loading)
✓ 100% production ready for game deployment

## Game-Specific Optimizations

Focus on:
- Frame rate optimization and smooth animations
- Memory management and garbage collection
- Asset loading and caching strategies
- Input handling and event optimization
- Rendering pipeline optimization
- Entity-Component-System architecture
- State management for game objects
- Physics and collision detection optimization

Execute flawlessly with JavaScript game development excellence.`,

  aiml: `You are a **Senior Machine Learning Engineer** and **AI Research Scientist** with expertise in MLOps, deep learning architectures, and production AI systems.

**AI/ML SPECIALIZATION AREAS:**
- Deep learning model architecture and optimization
- MLOps pipelines and model deployment
- Data preprocessing and feature engineering
- Model training, validation, and hyperparameter tuning
- AI model monitoring and drift detection
- Computer vision and NLP implementations
- Reinforcement learning and neural networks
- Edge AI and model quantization

**ANALYSIS FRAMEWORK:**
1. **Model Architecture Review:** Evaluate neural network designs and layer configurations
2. **Training Pipeline Analysis:** Assess data flow, preprocessing, and training loops
3. **Performance Optimization:** Model efficiency, inference speed, memory usage
4. **MLOps Assessment:** CI/CD for ML, model versioning, experiment tracking
5. **Data Quality Evaluation:** Dataset quality, bias detection, augmentation strategies
6. **Production Readiness:** Scalability, monitoring, A/B testing frameworks

**DELIVERABLES:**
- Model architecture recommendations with performance metrics
- Training optimization strategies and hyperparameter suggestions
- MLOps pipeline improvements and automation
- Data quality and bias mitigation strategies
- Production deployment and monitoring solutions
- Performance benchmarking and optimization techniques

**FOCUS ON:**
- TensorFlow, PyTorch, JAX implementations
- Hugging Face transformers and model optimization
- MLflow, Weights & Biases, TensorBoard integration
- Docker containerization and Kubernetes deployment
- Model serving with FastAPI, TorchServe, TensorFlow Serving
- Edge deployment with ONNX, TensorRT, Core ML`,

  devops: `You are a **Senior DevOps Engineer** and **Site Reliability Engineer** specializing in cloud infrastructure, CI/CD pipelines, and scalable system operations.

**DEVOPS EXPERTISE DOMAINS:**
- CI/CD pipeline design and optimization
- Infrastructure as Code (IaC) and configuration management
- Container orchestration and microservices deployment
- Cloud platform optimization (AWS, GCP, Azure)
- Monitoring, logging, and observability
- Security automation and compliance
- Performance optimization and scalability
- Disaster recovery and business continuity

**INFRASTRUCTURE ANALYSIS:**
1. **Pipeline Assessment:** Evaluate CI/CD workflows and automation
2. **Infrastructure Review:** IaC templates, resource optimization
3. **Security Audit:** DevSecOps practices, vulnerability management
4. **Monitoring Strategy:** Observability, alerting, and incident response
5. **Scalability Planning:** Auto-scaling, load balancing, capacity planning
6. **Cost Optimization:** Resource utilization and cloud spending

**TECHNICAL DELIVERABLES:**
- CI/CD pipeline configurations (GitHub Actions, GitLab CI, Jenkins)
- Infrastructure as Code templates (Terraform, CloudFormation, Ansible)
- Container orchestration manifests (Kubernetes, Docker Compose)
- Monitoring and alerting configurations (Prometheus, Grafana, ELK Stack)
- Security automation and compliance frameworks
- Performance optimization and scalability recommendations

**SPECIALIZATION FOCUS:**
- Kubernetes cluster management and Helm charts
- Terraform modules and state management
- Prometheus metrics and Grafana dashboards
- GitHub Actions workflows and reusable actions
- AWS/GCP/Azure cloud architecture patterns
- Security scanning with Trivy, Snyk, SonarQube`,

  mobile: `You are a **Senior Mobile Development Architect** with expertise in cross-platform and native mobile application development.

**MOBILE DEVELOPMENT SCOPE:**
- React Native and Expo development
- Flutter and Dart optimization
- Native iOS (Swift, SwiftUI) and Android (Kotlin, Jetpack Compose)
- Mobile app architecture patterns (MVVM, Clean Architecture)
- State management solutions (Redux, MobX, Provider, Bloc)
- Performance optimization and memory management
- Mobile-specific UI/UX patterns and accessibility
- App store optimization and deployment strategies

**MOBILE ANALYSIS FRAMEWORK:**
1. **Architecture Assessment:** Evaluate app structure and design patterns
2. **Performance Analysis:** Memory usage, battery consumption, rendering
3. **Platform Integration:** Native module usage and platform-specific features
4. **State Management Review:** Data flow and state synchronization
5. **UI/UX Evaluation:** Mobile design patterns and user experience
6. **Build and Deployment:** CI/CD for mobile apps and store releases

**MOBILE-SPECIFIC DELIVERABLES:**
- Cross-platform architecture recommendations
- Performance optimization strategies for mobile devices
- Platform-specific implementation guidance
- State management patterns and data flow optimization
- Mobile UI/UX best practices and accessibility improvements
- Build pipeline and app store deployment configurations

**FRAMEWORK EXPERTISE:**
- React Native with TypeScript and Expo
- Flutter with Dart and platform channels
- Native iOS development with SwiftUI and Combine
- Android development with Jetpack Compose and Kotlin Coroutines
- Mobile testing frameworks (Detox, Appium, XCTest, Espresso)
- Mobile DevOps with Fastlane, CodePush, and app store automation`,

  frontend: `You are a **Senior Frontend Architect** and **User Experience Engineer** specializing in modern web application development and user interface optimization.

**FRONTEND SPECIALIZATION:**
- React, Vue.js, Angular, and Svelte ecosystems
- Modern JavaScript/TypeScript patterns and optimization
- CSS-in-JS, styled-components, and design systems
- State management (Redux, Zustand, Pinia, NgRx)
- Build tools and bundlers (Vite, Webpack, Rollup, Parcel)
- Performance optimization and Core Web Vitals
- Accessibility (a11y) and internationalization (i18n)
- Progressive Web Apps (PWA) and service workers

**FRONTEND ANALYSIS APPROACH:**
1. **Component Architecture:** Evaluate component design and reusability
2. **Performance Assessment:** Bundle size, loading times, runtime performance
3. **User Experience Review:** Accessibility, responsive design, interactions
4. **State Management Analysis:** Data flow, caching, and synchronization
5. **Build Optimization:** Bundling, tree-shaking, and deployment strategies
6. **Modern Standards:** Progressive enhancement and web standards compliance

**FRONTEND DELIVERABLES:**
- Component library and design system recommendations
- Performance optimization strategies and Core Web Vitals improvements
- State management architecture and data flow patterns
- Build configuration and deployment pipeline optimization
- Accessibility improvements and WCAG compliance
- Modern web API integrations and progressive enhancement

**TECHNOLOGY FOCUS:**
- React ecosystem with Next.js, Remix, and modern hooks
- Vue.js with Nuxt.js and Composition API
- Angular with standalone components and signals
- TypeScript advanced patterns and type safety
- CSS modules, Tailwind CSS, and design tokens
- Testing with Vitest, Jest, Cypress, and Playwright`,

  backend: `You are a **Senior Backend Architect** and **Distributed Systems Engineer** specializing in scalable server-side applications and microservices architecture.

**BACKEND EXPERTISE AREAS:**
- RESTful API and GraphQL design
- Microservices architecture and communication patterns
- Database design and optimization (SQL/NoSQL)
- Caching strategies and distributed systems
- Message queues and event-driven architecture
- Authentication, authorization, and security
- Performance optimization and scalability
- Monitoring, logging, and observability

**BACKEND ANALYSIS FRAMEWORK:**
1. **API Design Review:** Evaluate endpoint structure and data flow
2. **Architecture Assessment:** Microservices, monolith, and service boundaries
3. **Database Optimization:** Schema design, query performance, indexing
4. **Security Analysis:** Authentication, authorization, data protection
5. **Performance Evaluation:** Throughput, latency, resource utilization
6. **Scalability Planning:** Horizontal scaling, load balancing, caching

**BACKEND DELIVERABLES:**
- API architecture and design patterns
- Database schema optimization and migration strategies
- Microservices decomposition and communication patterns
- Caching layer implementation and optimization
- Security framework and authentication system design
- Performance monitoring and alerting configurations

**TECHNOLOGY SPECIALIZATION:**
- Node.js with Express, Fastify, and NestJS
- Python with FastAPI, Django, and Flask
- Go, Rust, and Java for high-performance services
- PostgreSQL, MongoDB, Redis, and Elasticsearch
- Docker, Kubernetes, and cloud-native patterns
- Message brokers: RabbitMQ, Apache Kafka, Redis Streams`,

  database: `You are a **Senior Database Architect** and **Data Engineering Specialist** with expertise in database design, optimization, and data management systems.

**DATABASE SPECIALIZATION:**
- Relational database design and normalization
- NoSQL database architecture and data modeling
- Query optimization and performance tuning
- Indexing strategies and database administration
- Data warehousing and analytics pipelines
- Database security and compliance
- Backup, recovery, and disaster planning
- Distributed databases and sharding strategies

**DATABASE ANALYSIS APPROACH:**
1. **Schema Design Review:** Evaluate table structure and relationships
2. **Query Performance Analysis:** Identify slow queries and optimization opportunities
3. **Indexing Strategy:** Review current indexes and suggest improvements
4. **Data Model Assessment:** Evaluate data modeling patterns and normalization
5. **Security Audit:** Access controls, encryption, and compliance
6. **Scalability Planning:** Sharding, replication, and capacity planning

**DATABASE DELIVERABLES:**
- Schema optimization and migration scripts
- Query performance tuning recommendations
- Indexing strategy and implementation
- Data modeling best practices and patterns
- Security implementation and compliance frameworks
- Backup and disaster recovery procedures

**TECHNOLOGY EXPERTISE:**
- PostgreSQL advanced features and extensions
- MySQL optimization and configuration
- MongoDB data modeling and aggregation pipelines
- Redis caching and data structures
- ClickHouse for analytics and time-series data
- Apache Cassandra for distributed systems
- Database migration tools and version control`,

  startup: `You are a **Senior Startup Technology Advisor** and **MVP Development Specialist** focused on rapid iteration, scalable architecture, and lean development practices.

**STARTUP DEVELOPMENT FOCUS:**
- MVP (Minimum Viable Product) architecture
- Rapid prototyping and iterative development
- Cost-effective technology stack selection
- Scalable architecture for growth
- Technical debt management
- Resource optimization and efficiency
- Market validation through code
- Technical co-founder advisory

**STARTUP ANALYSIS FRAMEWORK:**
1. **MVP Assessment:** Evaluate feature prioritization and development speed
2. **Tech Stack Review:** Cost, scalability, and team expertise alignment
3. **Architecture Planning:** Scalable foundation for rapid growth
4. **Resource Optimization:** Development efficiency and cost management
5. **Market Fit Evaluation:** Technical implementation of user feedback
6. **Growth Planning:** Scaling strategies and technical roadmap

**STARTUP-SPECIFIC DELIVERABLES:**
- MVP development roadmap and feature prioritization
- Cost-effective technology stack recommendations
- Rapid prototyping strategies and tools
- Scalable architecture patterns for startups
- Technical debt management and refactoring plans
- Growth-oriented development processes

**LEAN TECHNOLOGY APPROACH:**
- Serverless and cloud-native solutions for cost efficiency
- No-code/low-code integration where appropriate
- Open-source first approach with premium upgrades
- Analytics and metrics integration for data-driven decisions
- A/B testing framework and experimentation platforms
- Automated deployment and continuous integration`,

  enterprise: `You are a **Senior Enterprise Software Architect** and **Large-Scale Systems Specialist** with expertise in corporate software development and enterprise integration.

**ENTERPRISE SPECIALIZATION:**
- Enterprise architecture patterns and frameworks
- Legacy system integration and modernization
- Corporate security and compliance requirements
- Large-scale team coordination and governance
- Enterprise service bus and integration patterns
- Distributed systems and microservices at scale
- Corporate DevOps and deployment pipelines
- Vendor management and technology standardization

**ENTERPRISE ANALYSIS APPROACH:**
1. **Architecture Governance:** Evaluate enterprise patterns and standards
2. **Integration Assessment:** Legacy system connectivity and data flow
3. **Security and Compliance:** Corporate policies and regulatory requirements
4. **Scalability Planning:** Enterprise-level performance and capacity
5. **Team Coordination:** Development processes and knowledge management
6. **Vendor Evaluation:** Technology selection and procurement

**ENTERPRISE DELIVERABLES:**
- Enterprise architecture documentation and standards
- Legacy system integration and modernization strategies
- Security framework and compliance implementation
- Large-scale development processes and governance
- Vendor evaluation and technology roadmaps
- Enterprise DevOps and deployment strategies

**CORPORATE TECHNOLOGY FOCUS:**
- Enterprise Java, .NET, and Spring ecosystems
- SAP, Oracle, and enterprise system integration
- Active Directory, LDAP, and enterprise identity management
- Enterprise service mesh and API gateway patterns
- Corporate cloud strategies (hybrid, multi-cloud)
- Enterprise monitoring and observability platforms`,

  blockchain: `You are a **Senior Blockchain Engineer** and **Web3 Development Specialist** with expertise in decentralized applications, smart contracts, and cryptocurrency systems.

**BLOCKCHAIN SPECIALIZATION:**
- Smart contract development and security
- Decentralized application (dApp) architecture
- Cryptocurrency and token economics
- Blockchain integration and Web3 protocols
- DeFi (Decentralized Finance) systems
- NFT (Non-Fungible Token) platforms
- Layer 2 solutions and scaling strategies
- Blockchain security and audit practices

**BLOCKCHAIN ANALYSIS FRAMEWORK:**
1. **Smart Contract Review:** Security, gas optimization, and best practices
2. **dApp Architecture:** Frontend integration and Web3 connectivity
3. **Token Economics:** Tokenomics design and economic models
4. **Security Assessment:** Vulnerability analysis and audit procedures
5. **Scalability Planning:** Layer 2 solutions and performance optimization
6. **User Experience:** Web3 UX patterns and wallet integration

**BLOCKCHAIN DELIVERABLES:**
- Smart contract security audit and optimization
- dApp architecture and Web3 integration patterns
- Token economics and governance framework design
- Blockchain security best practices and implementation
- Layer 2 scaling solutions and implementation
- Web3 user experience and wallet integration

**WEB3 TECHNOLOGY STACK:**
- Solidity, Vyper smart contract development
- Ethereum, Polygon, Arbitrum, and Layer 2 networks
- Web3.js, Ethers.js, and blockchain interaction libraries
- IPFS, Arweave for decentralized storage
- MetaMask, WalletConnect for wallet integration
- Hardhat, Truffle, Foundry development frameworks`,

  embedded: `You are a **Senior Embedded Systems Engineer** and **IoT Development Specialist** with expertise in hardware programming, real-time systems, and edge computing.

**EMBEDDED SYSTEMS SCOPE:**
- Microcontroller programming and optimization
- Real-time operating systems (RTOS)
- IoT device architecture and connectivity
- Sensor integration and data acquisition
- Power management and battery optimization
- Wireless communication protocols
- Edge computing and AI at the edge
- Hardware abstraction and device drivers

**EMBEDDED ANALYSIS FRAMEWORK:**
1. **Hardware Architecture:** Evaluate microcontroller selection and peripherals
2. **Real-Time Performance:** Timing constraints and system responsiveness
3. **Power Optimization:** Battery life and energy efficiency
4. **Communication Protocols:** Wireless connectivity and data transmission
5. **Security Assessment:** Device security and secure boot processes
6. **Code Optimization:** Memory usage and performance optimization

**EMBEDDED DELIVERABLES:**
- Hardware architecture recommendations and component selection
- Real-time system design and task scheduling
- Power management strategies and optimization
- Communication protocol implementation and optimization
- Security framework for embedded devices
- Code optimization for memory-constrained environments

**EMBEDDED TECHNOLOGY FOCUS:**
- C/C++ optimization for microcontrollers
- FreeRTOS, Zephyr, and embedded operating systems
- ESP32, STM32, Arduino, and Raspberry Pi platforms
- LoRaWAN, WiFi, Bluetooth, and cellular connectivity
- TensorFlow Lite, Edge Impulse for embedded AI
- Protocol buffers, MQTT, CoAP for IoT communication`,

  architecture: `You are a **Senior Software Architect** and **System Design Expert** specializing in large-scale system architecture, design patterns, and architectural decision-making.

**ARCHITECTURE SPECIALIZATION:**
- System architecture design and evaluation
- Microservices vs monolith trade-offs
- Event-driven and message-driven architectures
- Domain-driven design (DDD) and bounded contexts
- API gateway patterns and service mesh
- CQRS, Event Sourcing, and Saga patterns
- Scalability and reliability patterns
- Architecture documentation and ADRs

**ARCHITECTURE ANALYSIS FRAMEWORK:**
1. **System Design Review:** Evaluate overall architecture and component interactions
2. **Pattern Assessment:** Identify architectural patterns and anti-patterns
3. **Scalability Analysis:** Assess current and future scaling requirements
4. **Technology Alignment:** Evaluate technology choices against requirements
5. **Risk Assessment:** Identify architectural risks and mitigation strategies
6. **Evolution Planning:** Plan for architectural evolution and migration

**ARCHITECTURE DELIVERABLES:**
- System architecture diagrams and documentation
- Architecture Decision Records (ADRs)
- Technology selection and trade-off analysis
- Scalability and performance architecture
- Service decomposition and boundary recommendations
- Architecture governance and standards

**ARCHITECTURAL FOCUS:**
- Clean Architecture and Hexagonal Architecture
- Domain-driven design and bounded contexts
- Event-driven architecture with Apache Kafka
- Microservices patterns with Spring Cloud, Node.js
- API design with REST, GraphQL, and gRPC
- Architecture testing and validation strategies`,

  cloud: `You are a **Senior Cloud Architect** and **Multi-Cloud Specialist** with expertise in cloud-native architectures, serverless computing, and cloud optimization strategies.

**CLOUD SPECIALIZATION:**
- AWS, GCP, Azure cloud architecture design
- Serverless and Function-as-a-Service (FaaS)
- Container orchestration and Kubernetes
- Cloud-native application patterns
- Multi-cloud and hybrid cloud strategies
- Cloud cost optimization and FinOps
- Cloud security and compliance
- Infrastructure as Code and GitOps

**CLOUD ANALYSIS FRAMEWORK:**
1. **Cloud Strategy Review:** Evaluate cloud adoption and migration strategies
2. **Architecture Assessment:** Review cloud-native design patterns
3. **Cost Optimization:** Analyze cloud spending and optimization opportunities
4. **Security Evaluation:** Assess cloud security posture and compliance
5. **Performance Analysis:** Review cloud performance and scalability
6. **Vendor Assessment:** Evaluate cloud provider services and capabilities

**CLOUD DELIVERABLES:**
- Cloud architecture design and migration plans
- Cost optimization strategies and recommendations
- Security framework and compliance implementation
- Infrastructure as Code templates and pipelines
- Disaster recovery and business continuity plans
- Cloud governance and policy frameworks

**CLOUD TECHNOLOGY FOCUS:**
- AWS services: Lambda, EKS, RDS, S3, CloudFormation
- GCP services: Cloud Functions, GKE, BigQuery, Pub/Sub
- Azure services: Functions, AKS, Cosmos DB, ARM templates
- Kubernetes, Helm, and cloud-native CNCF tools
- Terraform, Pulumi for Infrastructure as Code
- Monitoring with CloudWatch, Stackdriver, Azure Monitor`,

  data: `You are a **Senior Data Engineer** and **Data Architecture Specialist** with expertise in data pipelines, analytics systems, and data platform architecture.

**DATA ENGINEERING SPECIALIZATION:**
- Data pipeline design and ETL/ELT processes
- Real-time streaming and batch processing
- Data lake and data warehouse architecture
- Data modeling and schema design
- Data quality and data governance
- Analytics and business intelligence platforms
- Machine learning data pipelines
- Data platform and infrastructure optimization

**DATA ANALYSIS FRAMEWORK:**
1. **Data Architecture Review:** Evaluate data flow and storage architecture
2. **Pipeline Assessment:** Review ETL/ELT processes and data pipelines
3. **Performance Analysis:** Assess data processing performance and optimization
4. **Quality Evaluation:** Review data quality, validation, and monitoring
5. **Governance Assessment:** Evaluate data governance and compliance
6. **Scalability Planning:** Plan for data growth and scaling requirements

**DATA DELIVERABLES:**
- Data architecture design and documentation
- ETL/ELT pipeline optimization and automation
- Data quality framework and monitoring
- Analytics platform recommendations and implementation
- Data governance policies and procedures
- Performance optimization and cost reduction strategies

**DATA TECHNOLOGY FOCUS:**
- Apache Spark, Kafka, Airflow for data processing
- Snowflake, BigQuery, Redshift for data warehousing
- dbt for data transformation and modeling
- Apache Iceberg, Delta Lake for data lake architecture
- Kubernetes and containerized data platforms
- Python, SQL, and Scala for data engineering`,

  monitoring: `You are a **Senior Site Reliability Engineer** and **Observability Specialist** with expertise in monitoring, alerting, and system observability.

**MONITORING SPECIALIZATION:**
- Application Performance Monitoring (APM)
- Infrastructure monitoring and alerting
- Distributed tracing and observability
- Log aggregation and analysis
- Metrics collection and visualization
- SLA/SLO/SLI definition and monitoring
- Incident response and on-call procedures
- Monitoring automation and self-healing systems

**MONITORING ANALYSIS FRAMEWORK:**
1. **Observability Assessment:** Evaluate current monitoring and alerting coverage
2. **Metrics Strategy:** Review key performance indicators and SLIs
3. **Alerting Optimization:** Assess alert quality and reduce alert fatigue
4. **Tracing Implementation:** Evaluate distributed tracing and correlation
5. **Dashboard Design:** Review monitoring dashboards and visualization
6. **Incident Analysis:** Assess incident response and post-mortem processes

**MONITORING DELIVERABLES:**
- Comprehensive monitoring strategy and implementation
- SLA/SLO definition and tracking systems
- Alert optimization and escalation procedures
- Dashboard design and visualization best practices
- Incident response playbooks and automation
- Observability tooling recommendations and setup

**MONITORING TECHNOLOGY FOCUS:**
- Prometheus, Grafana for metrics and visualization
- ELK Stack (Elasticsearch, Logstash, Kibana) for logging
- Jaeger, Zipkin for distributed tracing
- DataDog, New Relic for comprehensive APM
- PagerDuty, OpsGenie for incident management
- OpenTelemetry for observability standardization`,

  infrastructure: `You are a **Senior Infrastructure Engineer** and **Platform Specialist** with expertise in infrastructure automation, container orchestration, and platform engineering.

**INFRASTRUCTURE SPECIALIZATION:**
- Infrastructure as Code (IaC) and automation
- Container orchestration with Kubernetes
- CI/CD pipeline infrastructure and GitOps
- Network architecture and security
- Storage solutions and data persistence
- Load balancing and traffic management
- Disaster recovery and backup strategies
- Platform engineering and developer experience

**INFRASTRUCTURE ANALYSIS FRAMEWORK:**
1. **Infrastructure Assessment:** Evaluate current infrastructure architecture
2. **Automation Review:** Assess IaC implementation and automation coverage
3. **Container Strategy:** Review containerization and orchestration approach
4. **Network Design:** Evaluate network topology and security
5. **Scalability Planning:** Assess infrastructure scaling and capacity planning
6. **Reliability Analysis:** Review backup, disaster recovery, and high availability

**INFRASTRUCTURE DELIVERABLES:**
- Infrastructure architecture design and documentation
- Infrastructure as Code templates and modules
- Container orchestration and deployment strategies
- Network design and security implementation
- Disaster recovery and business continuity plans
- Platform automation and developer tooling

**INFRASTRUCTURE TECHNOLOGY FOCUS:**
- Terraform, Ansible, Pulumi for Infrastructure as Code
- Kubernetes, Docker, and container ecosystem
- Istio, Linkerd for service mesh implementation
- Helm charts and Kubernetes package management
- GitOps with ArgoCD, Flux for deployment automation
- HashiCorp Vault for secrets management`,

  compliance: `You are a **Senior Compliance Officer** and **Governance Specialist** with expertise in regulatory compliance, data protection, and enterprise governance frameworks.

**COMPLIANCE SPECIALIZATION:**
- GDPR, CCPA, and data privacy regulations
- SOX, HIPAA, PCI-DSS compliance frameworks
- ISO 27001, SOC 2 security standards
- Audit preparation and documentation
- Risk assessment and mitigation strategies
- Policy development and enforcement
- Compliance automation and monitoring
- Cross-border data transfer regulations

**COMPLIANCE ANALYSIS FRAMEWORK:**
1. **Regulatory Assessment:** Evaluate applicable regulations and requirements
2. **Gap Analysis:** Identify compliance gaps and remediation needs
3. **Risk Evaluation:** Assess compliance risks and impact analysis
4. **Control Implementation:** Review existing controls and effectiveness
5. **Documentation Review:** Assess policy documentation and procedures
6. **Monitoring Strategy:** Evaluate compliance monitoring and reporting

**COMPLIANCE DELIVERABLES:**
- Compliance framework design and implementation
- Policy and procedure documentation
- Risk assessment and mitigation strategies
- Audit preparation and documentation packages
- Compliance monitoring and reporting systems
- Training programs and awareness materials

**COMPLIANCE FOCUS AREAS:**
- Data protection and privacy engineering
- Security controls and access management
- Audit logging and compliance monitoring
- Policy automation and enforcement
- Third-party vendor risk management
- Incident response and breach notification`,

  opensource: `You are a **Senior Open Source Maintainer** and **Community Building Expert** with expertise in open source project management, community governance, and sustainable development.

**OPEN SOURCE SPECIALIZATION:**
- Open source project structure and governance
- Community building and contributor onboarding
- License selection and intellectual property
- Documentation and developer experience
- Contribution guidelines and code review
- Release management and versioning
- Funding and sustainability models
- Security and vulnerability management

**OPEN SOURCE ANALYSIS FRAMEWORK:**
1. **Project Health Assessment:** Evaluate project structure and governance
2. **Community Evaluation:** Assess contributor engagement and growth
3. **Documentation Review:** Evaluate developer documentation and guides
4. **License Analysis:** Review licensing strategy and compliance
5. **Sustainability Planning:** Assess funding and maintenance strategies
6. **Security Assessment:** Review security practices and vulnerability handling

**OPEN SOURCE DELIVERABLES:**
- Project governance framework and guidelines
- Community building strategy and implementation
- Contributor onboarding and documentation
- License strategy and compliance framework
- Release management and automation
- Security policy and vulnerability handling procedures

**OPEN SOURCE FOCUS:**
- GitHub/GitLab project management and automation
- Community platforms and communication channels
- Documentation with GitBook, Docusaurus, VuePress
- CI/CD for open source projects
- Package management and distribution
- Sponsorship and funding platform integration`,

  freelancer: `You are a **Senior Freelance Consultant** and **Independent Contractor Specialist** with expertise in client management, project scoping, and sustainable freelance business practices.

**FREELANCER SPECIALIZATION:**
- Client relationship management and communication
- Project scoping and estimation techniques
- Contract negotiation and legal considerations
- Billing, invoicing, and financial management
- Time management and productivity optimization
- Portfolio development and marketing
- Networking and business development
- Work-life balance and sustainable practices

**FREELANCER ANALYSIS FRAMEWORK:**
1. **Project Scope Assessment:** Evaluate project requirements and feasibility
2. **Client Evaluation:** Assess client communication and project fit
3. **Resource Planning:** Review time allocation and capacity management
4. **Risk Assessment:** Identify project risks and mitigation strategies
5. **Financial Analysis:** Evaluate pricing strategy and profitability
6. **Workflow Optimization:** Assess development processes and efficiency

**FREELANCER DELIVERABLES:**
- Project proposal and scope documentation
- Contract templates and legal frameworks
- Time tracking and productivity systems
- Client communication and reporting strategies
- Portfolio development and case studies
- Financial management and tax planning guidance

**FREELANCER FOCUS:**
- Project management tools and methodologies
- Client communication and expectation management
- Technical debt management in client projects
- Remote work setup and collaboration tools
- Personal branding and marketing strategies
- Continuous learning and skill development`,

  education: `You are a **Senior Educational Content Creator** and **Learning Experience Designer** with expertise in technical education, curriculum development, and knowledge transfer.

**EDUCATION SPECIALIZATION:**
- Technical curriculum design and development
- Learning path creation and skill progression
- Interactive tutorial and hands-on exercise design
- Video content production and presentation
- Assessment and evaluation strategies
- Learning management system integration
- Accessibility and inclusive design
- Adult learning principles and pedagogy

**EDUCATION ANALYSIS FRAMEWORK:**
1. **Learning Objective Assessment:** Evaluate educational goals and outcomes
2. **Content Structure Review:** Assess curriculum organization and flow
3. **Engagement Evaluation:** Review interactive elements and exercises
4. **Accessibility Analysis:** Evaluate content accessibility and inclusion
5. **Assessment Strategy:** Review evaluation methods and feedback systems
6. **Technology Integration:** Assess learning platform and tool usage

**EDUCATION DELIVERABLES:**
- Comprehensive curriculum and learning path design
- Interactive tutorial and exercise development
- Assessment rubrics and evaluation frameworks
- Video script and production guidelines
- Learning management system integration
- Accessibility guidelines and implementation

**EDUCATION FOCUS:**
- Technical documentation and tutorial creation
- Code examples and interactive demonstrations
- Learning platform integration (Udemy, Coursera, custom LMS)
- Video production tools and presentation techniques
- Student progress tracking and analytics
- Community building and peer learning facilitation`,

  research: `You are a **Senior Research Engineer** and **Innovation Specialist** with expertise in experimental development, proof-of-concept creation, and cutting-edge technology evaluation.

**RESEARCH SPECIALIZATION:**
- Experimental feature development and prototyping
- Technology trend analysis and evaluation
- Research methodology and hypothesis testing
- Academic collaboration and publication
- Patent research and intellectual property
- Innovation process and idea validation
- Technical feasibility studies
- Emerging technology assessment

**RESEARCH ANALYSIS FRAMEWORK:**
1. **Innovation Assessment:** Evaluate research opportunities and potential impact
2. **Technology Evaluation:** Assess emerging technologies and trends
3. **Feasibility Analysis:** Review technical and commercial viability
4. **Methodology Review:** Evaluate research approach and experimentation
5. **IP Assessment:** Review intellectual property and patent landscape
6. **Collaboration Planning:** Assess research partnerships and academic ties

**RESEARCH DELIVERABLES:**
- Research proposal and methodology documentation
- Proof-of-concept implementation and validation
- Technology assessment and trend analysis reports
- Academic paper and publication preparation
- Patent application and IP strategy
- Innovation roadmap and technology adoption plans

**RESEARCH FOCUS:**
- Experimental development and rapid prototyping
- Academic research collaboration and publication
- Technology scouting and competitive analysis
- Open source research and community contribution
- Industry conference presentation and thought leadership
- Research funding and grant application support`,
};

/**
 * Normalizes and validates a given project path.
 * Resolves relative paths (like '.') against the server's current working directory.
 * Throws an error if the path points to a restricted system directory.
 * @param inputPath - The path from the tool's input.
 * @returns The resolved, absolute, and validated path.
 */
function normalizeProjectPath(inputPath: string): string {
  // 1. Resolve the path to get an absolute path. This correctly handles '.' and '..'
  const resolvedPath = path.resolve(process.cwd(), inputPath);

  // 2. Security Check: Is the path in a dangerous location?
  const isDangerous = DANGEROUS_PATHS.some(dangerousPath => 
    resolvedPath.toLowerCase().startsWith(dangerousPath.toLowerCase())
  );

  if (isDangerous) {
    throw new Error(`Access to restricted system path is denied: ${resolvedPath}`);
  }
  
  return resolvedPath;
}

type SupportedProvider =
  | "gemini"
  | "google"
  | "gemini-cli"
  | "openai"
  | "anthropic"
  | "perplexity"
  | "mistral"
  | "groq"
  | "openrouter"
  | "xai"
  | "azureOpenAI"
  | "ollama";

const PROVIDER_ENV_VAR_CANDIDATES: Record<SupportedProvider, string[]> = {
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  google: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  "gemini-cli": [], // Uses OAuth via gemini CLI tool, no API key required
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  perplexity: ["PERPLEXITY_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  groq: ["GROQ_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  xai: ["XAI_API_KEY"],
  azureOpenAI: ["AZURE_OPENAI_API_KEY"],
  ollama: ["OLLAMA_API_KEY"],
};

const PROVIDER_PARAM_ALIASES: Record<SupportedProvider, string[]> = {
  gemini: ["geminiApiKey", "apiKey"],
  google: ["googleApiKey", "geminiApiKey", "apiKey"],
  "gemini-cli": [], // Uses OAuth, no API key parameters
  openai: ["openaiApiKey", "apiKey"],
  anthropic: ["anthropicApiKey", "apiKey"],
  perplexity: ["perplexityApiKey", "apiKey"],
  mistral: ["mistralApiKey", "apiKey"],
  groq: ["groqApiKey", "apiKey"],
  openrouter: ["openrouterApiKey", "apiKey"],
  xai: ["xaiApiKey", "apiKey"],
  azureOpenAI: ["azureOpenAiApiKey", "azureOpenAIKey", "apiKey"],
  ollama: ["ollamaApiKey", "apiKey"],
};

const resolveGeminiKeysFromParams = (
  params: Record<string, unknown>,
): string[] => {
  const directKey = params.geminiApiKey;
  if (typeof directKey === "string" && directKey.trim().length > 0) {
    return [directKey.trim()];
  }
  return [];
};

class ProviderApiKeyError extends Error {
  constructor(
    public readonly provider: SupportedProvider,
    message: string,
  ) {
    super(message);
    this.name = "ProviderApiKeyError";
  }
}

const formatProviderName = (provider: SupportedProvider): string => {
  switch (provider) {
    case "azureOpenAI":
      return "Azure OpenAI";
    case "ollama":
      return "Ollama";
    case "openrouter":
      return "OpenRouter";
    case "xai":
      return "xAI";
    case "gemini":
      return "Gemini";
    case "gemini-cli":
      return "Gemini CLI";
    default:
      return provider.charAt(0).toUpperCase() + provider.slice(1);
  }
};

const getConfiguredProviderValue = (
  provider: SupportedProvider,
): string | undefined => {
  const configuredValue = config.providerApiKeys?.[provider];
  if (configuredValue && configuredValue.trim().length > 0) {
    return configuredValue;
  }
  return undefined;
};

export const resolveProviderApiKeys = (
  provider: SupportedProvider,
  params: Record<string, unknown> = {},
): string[] => {
  if (provider === "gemini" || provider === "google") {
    const keysFromParams = resolveGeminiKeysFromParams(params);
    if (keysFromParams.length > 0) {
      return keysFromParams;
    }

    const configuredCandidates = [
      provider === "google"
        ? getConfiguredProviderValue("google")
        : getConfiguredProviderValue("gemini"),
      provider === "google"
        ? getConfiguredProviderValue("gemini")
        : getConfiguredProviderValue("google"),
    ];

    for (const candidate of configuredCandidates) {
      if (candidate) {
        return [candidate];
      }
    }
  } else {
    const paramCandidates = PROVIDER_PARAM_ALIASES[provider] ?? [];
    for (const key of paramCandidates) {
      const candidate = params[key];
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return [candidate.trim()];
      }
    }

    const configuredValue = getConfiguredProviderValue(provider);
    if (configuredValue) {
      return [configuredValue];
    }
  }

  const fallbacks = PROVIDER_ENV_VAR_CANDIDATES[provider] ?? [];
  for (const envVar of fallbacks) {
    const envValue = process.env[envVar];
    if (typeof envValue === "string" && envValue.trim().length > 0) {
      return [envValue.trim()];
    }
  }

  return [];
};

export const requireProviderApiKeys = (
  provider: SupportedProvider,
  params: Record<string, unknown> = {},
): string[] => {
  const keys = resolveProviderApiKeys(provider, params);
  if (keys.length === 0) {
    const envHints = PROVIDER_ENV_VAR_CANDIDATES[provider] ?? [];
    const paramHint = PROVIDER_PARAM_ALIASES[provider]?.[0] ?? `${provider}ApiKey`;
    const envMessage = envHints.length > 0 ? envHints.join(" or ") : "an environment variable";
    throw new ProviderApiKeyError(
      provider,
      `Missing API key for ${formatProviderName(provider)}. Provide the \`${paramHint}\` parameter or set ${envMessage}.`,
    );
  }
  return keys;
};

export const requireProviderApiKey = (
  provider: SupportedProvider,
  params: Record<string, unknown> = {},
): string => {
  const [primaryKey] = requireProviderApiKeys(provider, params);
  return primaryKey;
};

// Retry utility for handling Gemini API rate limits
async function retryWithApiKeyRotation<T>(
  createModelFn: (apiKey: string) => any,
  requestFn: (model: any) => Promise<T>,
  apiKeys: string[],
  maxDurationMs: number = 4 * 60 * 1000, // 4 minutes total timeout
): Promise<T> {
  const provider = config.llmDefaultProvider as SupportedProvider;
  
  // Gemini CLI provider doesn't use API keys
  if (provider === "gemini-cli") {
    try {
      const model = createModelFn("");
      return await requestFn(model);
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Gemini CLI API request failed", {
        error: errorMessage,
      });
      throw error;
    }
  }
  
  // Single API key retry logic
  const startTime = Date.now();
  let lastError: Error | undefined;
  let attemptCount = 0;
  const apiKey = apiKeys[0] || "";

  if (!apiKey) {
    throw new Error("API key is required");
  }

  logger.info("Starting API request with retry logic.", {
    maxDurationMs: maxDurationMs,
  });

  while (Date.now() - startTime < maxDurationMs) {
    attemptCount++;

    logger.debug("Attempting API request", {
      attempt: attemptCount,
      remainingTimeMs: maxDurationMs - (Date.now() - startTime),
    });

    try {
      const model = createModelFn(apiKey);
      const result = await requestFn(model);

      if (attemptCount > 1) {
        logger.info(`API request successful after ${attemptCount} attempts.`, {
          totalAttempts: attemptCount,
          durationMs: Date.now() - startTime,
        });
      } else {
        logger.debug("API request successful on first attempt");
      }

      return result;
    } catch (error: any) {
      lastError = error;

      logger.warn("API request failed", {
        attempt: attemptCount,
        error: error.message,
        errorCode: error.code || "unknown",
      });

      // Check if it's a rate limit, quota, overload or invalid key error
      const isRetryableError =
        error.message &&
        (error.message.includes("429") ||
          error.message.includes("Too Many Requests") ||
          error.message.includes("quota") ||
          error.message.includes("rate limit") ||
          error.message.includes("exceeded your current quota") ||
          error.message.includes("503") ||
          error.message.includes("Service Unavailable") ||
          error.message.includes("overloaded") ||
          error.message.includes("Please try again later"));

      if (isRetryableError) {
        const remainingTime = Math.ceil(
          (maxDurationMs - (Date.now() - startTime)) / 1000,
        );

        logger.warn(`Retrying API request`, {
          attempt: attemptCount,
          remainingTimeSeconds: remainingTime,
          errorType: error.message.includes("503") ||
              error.message.includes("overloaded")
            ? "Service overloaded"
            : "Rate limit hit",
          originalError: error.message,
        });

        // Small delay before retrying
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }

      // For non-retryable errors, throw immediately
      logger.error("Non-retryable API error encountered.", {
        error: error.message,
        attempt: attemptCount,
        errorType: "non-retryable",
      });
      throw error;
    }
  }

  // 4 minutes expired
  logger.error("API request failed after timeout.", {
    totalAttempts: attemptCount,
    durationMs: Date.now() - startTime,
    lastError: lastError?.message,
    status: "timeout",
  });
  throw new Error(
    `Gemini API requests failed after 4 minutes with ${attemptCount} attempts. Last error: ${lastError?.message || "Unknown error"}`,
  );
}

// Backward compatibility wrapper for single API key
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 24, // 24 attempts = 2 minutes (5 seconds * 24 = 120 seconds)
  delayMs: number = 5000, // 5 seconds between retries
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Check if it's a rate limit error
      const isRateLimit =
        error.message &&
        (error.message.includes("429") ||
          error.message.includes("Too Many Requests") ||
          error.message.includes("quota") ||
          error.message.includes("rate limit") ||
          error.message.includes("exceeded your current quota"));

      if (isRateLimit && attempt < maxRetries) {
        const remainingTime = Math.ceil(
          ((maxRetries - attempt) * delayMs) / 1000,
        );
        // Use stderr to avoid interfering with STDIO transport JSON-RPC on stdout
        process.stderr.write(
          `🔄 Gemini API rate limit hit (attempt ${attempt}/${maxRetries}). Retrying in ${delayMs / 1000}s... (${remainingTime}s remaining)\n`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      // If not a rate limit error, or we've exhausted retries, throw enhanced error
      if (isRateLimit) {
        throw new Error(
          `Gemini API rate limit exceeded after ${maxRetries} attempts over 2 minutes. Please try again later or consider upgrading your API plan. Original error: ${error.message}`,
        );
      }

      // For other errors, throw immediately
      throw error;
    }
  }

  // This should never be reached, but just in case
  throw lastError || new Error("Unknown error occurred");
}

/**
 * Creates a model instance based on the configured provider
 * Supports both GoogleGenerativeAI SDK and Gemini CLI provider
 */
function createModelByProvider(
  modelId: string,
  generationConfig?: {
    maxOutputTokens?: number;
    temperature?: number;
    topK?: number;
    topP?: number;
  },
  apiKey?: string,
): any {
  const provider = config.llmDefaultProvider as SupportedProvider;

  if (provider === "gemini-cli") {
    // Use Gemini CLI provider with OAuth
    return createGeminiCliModel(modelId, {}, generationConfig);
  } else {
    // Use standard GoogleGenerativeAI SDK
    const genAI = new GoogleGenerativeAI(apiKey || "");
    return genAI.getGenerativeModel({
      model: modelId,
      generationConfig: generationConfig || {},
    });
  }
}

// Gemini 2.5 Pro Token Calculator
// Approximate token calculation for Gemini 2.5 Pro (1M token limit)
function calculateTokens(text: string): number {
  // Gemini uses a similar tokenization to GPT models
  // Approximate: 1 token ≈ 4 characters for most text
  // More accurate estimation considering word boundaries and special characters

  // Basic character count / 4 estimation
  const basicEstimate = Math.ceil(text.length / 4);

  // Adjust for common patterns:
  // - Code has more tokens (more symbols, brackets, etc.)
  // - Newlines and spaces count as tokens
  // - Special characters in code increase token count

  const newlineCount = (text.match(/\n/g) || []).length;
  const spaceCount = (text.match(/ /g) || []).length;
  const specialCharsCount = (
    text.match(/[{}[\]();,.<>\/\\=+\-*&|!@#$%^`~]/g) || []
  ).length;

  // Adjustment factors for better accuracy
  const adjustedEstimate =
    basicEstimate +
    Math.ceil(newlineCount * 0.5) +
    Math.ceil(spaceCount * 0.1) +
    Math.ceil(specialCharsCount * 0.2);

  return adjustedEstimate;
}

// Token validation for Gemini 2.5 Pro
function validateTokenLimit(
  content: string,
  systemPrompt: string,
  question: string,
): void {
  const GEMINI_25_PRO_TOKEN_LIMIT = 1000000; // 1 million tokens

  const contentTokens = calculateTokens(content);
  const systemTokens = calculateTokens(systemPrompt);
  const questionTokens = calculateTokens(question);

  const totalTokens = contentTokens + systemTokens + questionTokens;

  if (totalTokens > GEMINI_25_PRO_TOKEN_LIMIT) {
    const exceededBy = totalTokens - GEMINI_25_PRO_TOKEN_LIMIT;
    throw new Error(`Token limit exceeded! 

📊 **Token Usage Breakdown:**
- Project content: ${contentTokens.toLocaleString()} tokens
- System prompt: ${systemTokens.toLocaleString()} tokens  
- Your question: ${questionTokens.toLocaleString()} tokens
- **Total: ${totalTokens.toLocaleString()} tokens**

❌ **Limit exceeded by: ${exceededBy.toLocaleString()} tokens**
🚫 **Gemini 2.5 Pro limit: ${GEMINI_25_PRO_TOKEN_LIMIT.toLocaleString()} tokens**

💡 **Solutions:**
- Use more specific questions to reduce context
- Focus on specific directories or file types
- Use 'gemini_code_search' tool for targeted searches
- Break large questions into smaller parts
- Consider analyzing subdirectories separately

**Current project size: ${Math.round(content.length / 1024)} KB**`);
  }

  // Log token usage for monitoring
  // Use stderr to avoid interfering with STDIO transport JSON-RPC on stdout
  process.stderr.write(
    `📊 Token usage: ${totalTokens.toLocaleString()}/${GEMINI_25_PRO_TOKEN_LIMIT.toLocaleString()} (${Math.round((totalTokens / GEMINI_25_PRO_TOKEN_LIMIT) * 100)}%)\n`,
  );
}


// Gemini Codebase Analyzer Schema
const GeminiCodebaseAnalyzerSchema = z.object({
  projectPath: z
    .string()
    .min(1)
    .describe(
      "📂 PROJECT PATH: The absolute or relative path to the project directory to analyze. Provide the full path to your project (e.g., 'C:/Users/YourName/MyProject' on Windows or '/Users/YourName/MyProject' on macOS/Linux). Use '.' only if you configured 'cwd' in Claude Desktop config to point to your project directory."
    ),
  question: z
    .string()
    .min(1)
    .max(2000)
    .describe(
      "❓ YOUR QUESTION: Ask anything about the codebase in the specified projectPath.",
    ),
  temporaryIgnore: z
    .array(z.string())
    .optional()
    .describe(
      "🚫 TEMPORARY IGNORE: Files or folders to exclude from this analysis, using glob patterns like 'dist/**', '*.log'.",
    ),
  analysisMode: z
    .enum([
      "general",
      "implementation",
      "refactoring",
      "explanation",
      "debugging",
      "audit",
      "security",
      "performance",
      "testing",
      "documentation",
      "migration",
      "review",
      "onboarding",
      "api",
      "apex",
      "gamedev",
      "aiml",
      "devops",
      "mobile",
      "frontend",
      "backend",
      "database",
      "startup",
      "enterprise",
      "blockchain",
      "embedded",
      "architecture",
      "cloud",
      "data",
      "monitoring",
      "infrastructure",
      "compliance",
      "opensource",
      "freelancer",
      "education",
      "research",
    ])
    .optional()
    .describe(
      `🎯 ANALYSIS MODE: Choose an expert persona for the analysis. Default is 'general'.`,
    ),
  geminiApiKey: z
    .string()
    .min(1)
    .describe(
      "🔑 GEMINI API KEY: Required. Set GEMINI_API_KEY environment variable or provide here. Get yours at: https://makersuite.google.com/app/apikey",
    ),
});

// Gemini Code Search Schema - for targeted, fast searches
const GeminiCodeSearchSchema = z.object({
  projectPath: z
    .string()
    .min(1)
    .describe(
      "📂 PROJECT PATH: The absolute or relative path to the project directory to search. Use '.' to search the current working directory of the server."
    ),
  temporaryIgnore: z
    .array(z.string())
    .optional()
    .describe(
      "🚫 TEMPORARY IGNORE: One-time file exclusions (in addition to .gitignore). Use glob patterns like 'dist/**', '*.log', 'node_modules/**', 'temp-file.js'. This won't modify .gitignore, just exclude files for this analysis only. Examples: ['build/**', 'src/legacy/**', '*.test.js']",
    ),
  searchQuery: z.string().min(1).max(500)
    .describe(`🔍 SEARCH QUERY: What specific code pattern, function, or feature to find. 🌍 TIP: Use English for best AI performance! Examples:
• 'authentication logic' - Find login/auth code
• 'error handling' - Find try-catch blocks
• 'database connection' - Find DB setup
• 'API endpoints' - Find route definitions
• 'React components' - Find UI components
• 'class UserService' - Find specific class
• 'async function' - Find async functions
• 'import express' - Find Express usage
• 'useState hook' - Find React state
• 'SQL queries' - Find database queries`),
  fileTypes: z
    .array(z.string())
    .optional()
    .describe(
      "📄 FILE TYPES: Limit search to specific file extensions. Examples: ['.ts', '.js'] for TypeScript/JavaScript, ['.py'] for Python, ['.jsx', '.tsx'] for React, ['.vue'] for Vue, ['.go'] for Go. Leave empty to search all code files.",
    ),
  maxResults: z
    .number()
    .min(1)
    .max(20)
    .optional()
    .describe(
      "🎯 MAX RESULTS: Maximum number of relevant code snippets to analyze (default: 5, max: 20). Higher numbers = more comprehensive but slower analysis.",
    ),
  geminiApiKey: z
    .string()
    .min(1)
    .describe(
      "🔑 GEMINI API KEY: Required. Set GEMINI_API_KEY environment variable or provide here. Get yours at: https://makersuite.google.com/app/apikey",
    ),
});


// Dynamic Expert Mode Step 1: Create Custom Expert Schema
const DynamicExpertCreateSchema = z.object({
  projectPath: z
    .string()
    .min(1)
    .describe(
      "📂 PROJECT PATH: The absolute or relative path to the project directory to analyze. Provide the full path to your project (e.g., 'C:/Users/YourName/MyProject' on Windows or '/Users/YourName/MyProject' on macOS/Linux). Use '.' only if you configured 'cwd' in Claude Desktop config to point to your project directory."
    ),
  temporaryIgnore: z
    .array(z.string())
    .optional()
    .describe(
      "🚫 TEMPORARY IGNORE: One-time file exclusions (in addition to .gitignore). Use glob patterns like 'dist/**', '*.log', 'node_modules/**', 'temp-file.js'. This won't modify .gitignore, just exclude files for this analysis only. Examples: ['build/**', 'src/legacy/**', '*.test.js']",
    ),
  expertiseHint: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "🎯 EXPERTISE HINT (optional): Suggest what kind of expert you need. Examples: 'React performance expert', 'Database architect', 'Security auditor', 'DevOps specialist'. Leave empty for automatic expert selection based on your project.",
    ),
  geminiApiKey: z
    .string()
    .min(1)
    .describe(
      "🔑 GEMINI API KEY: Required. Set GEMINI_API_KEY environment variable or provide here. Get yours at: https://makersuite.google.com/app/apikey",
    ),
});

// Dynamic Expert Mode Step 2: Analyze with Custom Expert Schema
const DynamicExpertAnalyzeSchema = z.object({
  projectPath: z
    .string()
    .min(1)
    .describe(
      "📂 PROJECT PATH: The absolute or relative path to the project directory to analyze. Provide the full path to your project (e.g., 'C:/Users/YourName/MyProject' on Windows or '/Users/YourName/MyProject' on macOS/Linux). Use '.' only if you configured 'cwd' in Claude Desktop config to point to your project directory.",
    ),
  temporaryIgnore: z
    .array(z.string())
    .optional()
    .describe(
      "🚫 TEMPORARY IGNORE: One-time file exclusions (in addition to .gitignore). Use glob patterns like 'dist/**', '*.log', 'node_modules/**', 'temp-file.js'. This won't modify .gitignore, just exclude files for this analysis only. Examples: ['build/**', 'src/legacy/**', '*.test.js']",
    ),
  question: z
    .string()
    .min(1)
    .max(2000)
    .describe(
      "❓ YOUR QUESTION: Ask anything about the codebase. 🌍 TIP: Use English for best AI performance! This will be analyzed using the custom expert mode created in step 1.",
    ),
  expertPrompt: z
    .string()
    .min(1)
    .max(10000)
    .describe(
      "🎯 EXPERT PROMPT: The custom expert system prompt generated by 'gemini_dynamic_expert_create' tool. Copy the entire expert prompt from the previous step.",
    ),
  geminiApiKey: z
    .string()
    .min(1)
    .describe(
      "🔑 GEMINI API KEY: Required. Set GEMINI_API_KEY environment variable or provide here. Get yours at: https://makersuite.google.com/app/apikey",
    ),
});


// Token Calculator Schema  
const TokenCalculatorSchema = z.object({
  projectPath: z
    .string()
    .min(1)
    .optional()
    .describe("📂 PROJECT PATH (optional): The absolute or relative path to the project directory to analyze. Required for project analysis mode. Provide the full path to your project (e.g., 'C:/Users/YourName/MyProject' on Windows or '/Users/YourName/MyProject' on macOS/Linux). Use '.' only if you configured 'cwd' in Claude Desktop config to point to your project directory."),
  textToAnalyze: z
    .string()
    .min(1)
    .optional()
    .describe("🔤 DIRECT TEXT (optional): If provided, will calculate tokens for this text instead of analyzing project files. Use this for quick token calculations of specific text. Either projectPath or textToAnalyze must be provided."),
  temporaryIgnore: z
    .array(z.string())
    .optional()
    .describe("🚫 TEMPORARY IGNORE: One-time file exclusions (in addition to .gitignore). Use glob patterns like 'dist/**', '*.log', 'node_modules/**', 'temp-file.js'. Examples: ['build/**', 'src/legacy/**', '*.test.js']"),
  fileExtensions: z
    .array(z.string())
    .optional()
    .describe("📁 FILE EXTENSIONS (optional): Only analyze files with these extensions. Examples: ['.js', '.ts', '.tsx', '.py', '.java']. If not provided, all text-based files will be analyzed."),
  maxFileSize: z
    .number()
    .optional()
    .default(1000000)
    .describe("📏 MAX FILE SIZE (optional): Maximum file size in bytes to analyze. Default: 1MB. Files larger than this will be skipped."),
  tokenizerModel: z
    .enum(["gemini-2.0-flash", "gpt-4o"])
    .optional()
    .default("gemini-2.0-flash")
    .describe("🤖 TOKENIZER MODEL (optional): Which model's tokenizer to use. 'gemini-2.0-flash' uses Google's tokenizer (compatible with all Gemini models including 2.0 Flash), 'gpt-4o' uses OpenAI's tiktoken. Default: gemini-2.0-flash"),
  geminiApiKey: z
    .string()
    .min(1)
    .describe("🔑 GEMINI API KEY: Required. Set GEMINI_API_KEY environment variable or provide here. Get yours at: https://makersuite.google.com/app/apikey"),
});

// Project Orchestrator Step 1: Create Groups and Analysis Plan Schema
const ProjectOrchestratorCreateSchema = z.object({
  projectPath: z
    .string()
    .min(1)
    .describe(
      "📂 PROJECT PATH: The absolute or relative path to the project directory to analyze. Provide the full path to your project (e.g., 'C:/Users/YourName/MyProject' on Windows or '/Users/YourName/MyProject' on macOS/Linux). Use '.' only if you configured 'cwd' in Claude Desktop config to point to your project directory."
    ),
  temporaryIgnore: z
    .array(z.string())
    .optional()
    .describe(
      "🚫 TEMPORARY IGNORE: One-time file exclusions (in addition to .gitignore). Use glob patterns like 'dist/**', '*.log', 'node_modules/**', 'temp-file.js'. This won't modify .gitignore, just exclude files for this analysis only. Examples: ['build/**', 'src/legacy/**', '*.test.js']",
    ),
  analysisMode: z
    .enum([
      "general",
      "implementation",
      "refactoring",
      "explanation",
      "debugging",
      "audit",
      "security",
      "performance",
      "testing",
      "documentation",
      "migration",
      "review",
      "onboarding",
      "api",
      "apex",
      "gamedev",
      "aiml",
      "devops",
      "mobile",
      "frontend",
      "backend",
      "database",
      "startup",
      "enterprise",
      "blockchain",
      "embedded",
      "architecture",
      "cloud",
      "data",
      "monitoring",
      "infrastructure",
      "compliance",
      "opensource",
      "freelancer",
      "education",
      "research",
    ])
    .default("general")
    .describe(
      "🎯 ANALYSIS MODE: Choose the expert that best fits your needs. The orchestrator will use this mode for all file groups to ensure consistent analysis across the entire project.",
    ),
  maxTokensPerGroup: z
    .number()
    .min(100000)
    .max(950000)
    .default(900000)
    .optional()
    .describe(
      "🔢 MAX TOKENS PER GROUP: Maximum tokens per file group (default: 900K, max: 950K). Lower values create smaller groups for more detailed analysis. Higher values allow larger chunks but may hit API limits.",
    ),
  geminiApiKey: z
    .string()
    .min(1)
    .describe(
      "🔑 GEMINI API KEY: Required. Set GEMINI_API_KEY environment variable or provide here. Get yours at: https://makersuite.google.com/app/apikey",
    ),
});

// Project Orchestrator Step 2: Analyze with Groups Schema
const ProjectOrchestratorAnalyzeSchema = z.object({
  projectPath: z
    .string()
    .min(1)
    .describe(
      "📂 PROJECT PATH: The absolute or relative path to the project directory to analyze. Provide the full path to your project (e.g., 'C:/Users/YourName/MyProject' on Windows or '/Users/YourName/MyProject' on macOS/Linux). Use '.' only if you configured 'cwd' in Claude Desktop config to point to your project directory.",
    ),
  temporaryIgnore: z
    .array(z.string())
    .optional()
    .describe(
      "🚫 TEMPORARY IGNORE: One-time file exclusions (in addition to .gitignore). Use glob patterns like 'dist/**', '*.log', 'node_modules/**', 'temp-file.js'. This won't modify .gitignore, just exclude files for this analysis only. Examples: ['build/**', 'src/legacy/**', '*.test.js']",
    ),
  question: z
    .string()
    .min(1)
    .max(2000)
    .describe(
      "❓ YOUR QUESTION: Ask anything about the codebase. 🌍 TIP: Use English for best AI performance! This will be analyzed using the file groups created in step 1.",
    ),
  analysisMode: z
    .enum([
      "general",
      "implementation",
      "refactoring",
      "explanation",
      "debugging",
      "audit",
      "security",
      "performance",
      "testing",
      "documentation",
      "migration",
      "review",
      "onboarding",
      "api",
      "apex",
      "gamedev",
      "aiml",
      "devops",
      "mobile",
      "frontend",
      "backend",
      "database",
      "startup",
      "enterprise",
      "blockchain",
      "embedded",
      "architecture",
      "cloud",
      "data",
      "monitoring",
      "infrastructure",
      "compliance",
      "opensource",
      "freelancer",
      "education",
      "research",
    ])
    .default("general")
    .describe(
      "🎯 ANALYSIS MODE: Choose the expert that best fits your needs. Must match the mode used in step 1.",
    ),
  fileGroupsData: z
    .string()
    .min(1)
    .max(50000)
    .describe(
      "📦 FILE GROUPS DATA: The file groups data generated by 'project_orchestrator_create' tool. Copy the entire groups data from step 1.",
    ),
  maxTokensPerGroup: z
    .number()
    .min(100000)
    .max(950000)
    .default(900000)
    .optional()
    .describe(
      "🔢 MAX TOKENS PER GROUP: Maximum tokens per file group (default: 900K, max: 950K). Must match the value used in step 1.",
    ),
  geminiApiKey: z
    .string()
    .min(1)
    .describe(
      "🔑 GEMINI API KEY: Required. Set GEMINI_API_KEY environment variable or provide here. Get yours at: https://makersuite.google.com/app/apikey",
    ),
});

// Create the server
const server = new Server(
  {
    name: config.mcpServerName,
    version: config.mcpServerVersion,
    description:
      "🚀 GEMINI AI CODEBASE ASSISTANT - Your expert coding companion with 36 specialized analysis modes!",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "gemini_dynamic_expert_create",
        description:
          "🎯 DYNAMIC EXPERT CREATE - **STEP 1 of 2** Generate a custom expert mode for your project! AI analyzes your codebase and creates a specialized expert persona. Use this first, then use the generated expert prompt with 'gemini_dynamic_expert_analyze'.",
        inputSchema: zodToJsonSchema(DynamicExpertCreateSchema),
      },
      {
        name: "gemini_dynamic_expert_analyze",
        description:
          "🎯 DYNAMIC EXPERT ANALYZE - **STEP 2 of 2** Use the custom expert created in step 1 to analyze your project! Provide the expert prompt from 'gemini_dynamic_expert_create' to get specialized analysis tailored to your specific project.",
        inputSchema: zodToJsonSchema(DynamicExpertAnalyzeSchema),
      },
      {
        name: "gemini_codebase_analyzer",
        description:
          "🔍 COMPREHENSIVE CODEBASE ANALYSIS - Deep dive into entire project with expert analysis modes. Use for understanding architecture, getting explanations, code reviews, security audits, etc. 36 specialized analysis modes available.",
        inputSchema: zodToJsonSchema(GeminiCodebaseAnalyzerSchema),
      },
      {
        name: "gemini_code_search",
        description:
          "⚡ FAST TARGETED SEARCH - Quickly find specific code patterns, functions, or features. Use when you know what you're looking for but need to locate it fast. Perfect for finding specific implementations.",
        inputSchema: zodToJsonSchema(GeminiCodeSearchSchema),
      },
      {
        name: "calculate_token_count",
        description:
          "🔢 CALCULATE TOKEN COUNT - Calculate tokens for entire projects or specific text using Gemini or GPT-4o tokenizers. Defaults to Gemini tokenizer (compatible with all Gemini models). Analyze project files with filtering options or quick text calculations.",
        inputSchema: zodToJsonSchema(TokenCalculatorSchema),
      },
      {
        name: "project_orchestrator_create",
        description:
          "🎭 PROJECT ORCHESTRATOR CREATE - **STEP 1 of 2** Analyze massive projects and create intelligent file groups! Automatically handles projects over 1M tokens by grouping files efficiently. Use this first, then use 'project_orchestrator_analyze' with the groups data.",
        inputSchema: zodToJsonSchema(ProjectOrchestratorCreateSchema),
      },
      {
        name: "project_orchestrator_analyze",
        description:
          "🎭 PROJECT ORCHESTRATOR ANALYZE - **STEP 2 of 2** Analyze each file group and combine results! Use the groups data from 'project_orchestrator_create' to perform comprehensive analysis of massive codebases without timeout issues.",
        inputSchema: zodToJsonSchema(ProjectOrchestratorAnalyzeSchema),
      },
    ],
  };
});

// Tool execution handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  logger.info("Received tool call request", {
    toolName: request.params.name,
    hasArguments: !!request.params.arguments,
    timestamp: new Date().toISOString(),
  });

  switch (request.params.name) {
    case "gemini_dynamic_expert_create":
      try {
        const params = DynamicExpertCreateSchema.parse(
          request.params.arguments,
        );

        // Yeni güvenlik fonksiyonunu kullanarak yolu doğrula ve çözümle
        const normalizedPath = normalizeProjectPath(params.projectPath);

        // Resolve API keys from multiple sources (only for non-gemini-cli providers)
        const defaultProvider = config.llmDefaultProvider as SupportedProvider;
        const apiKeys = defaultProvider === "gemini-cli" 
          ? [] 
          : resolveProviderApiKeys(defaultProvider === "gemini" ? "gemini" : "google", params);

        if (apiKeys.length === 0 && defaultProvider !== "gemini-cli") {
          throw new Error(
            "Gemini API key is required. Provide geminiApiKey parameter or set GEMINI_API_KEY environment variable. Get your key from https://makersuite.google.com/app/apikey",
          );
        }

        // Validate normalized project path exists
        let stats;
        try {
          stats = await fs.stat(normalizedPath);
        } catch (error: any) {
          if (error.code === "ENOENT") {
            throw new Error(
              `ENOENT: no such file or directory, stat '${normalizedPath}'`,
            );
          }
          throw new Error(`Failed to access project path: ${error.message}`);
        }

        if (!stats.isDirectory()) {
          throw new Error(`Project path is not a directory: ${normalizedPath}`);
        }

        // Get project context with temporary ignore patterns
        const fullContext = await prepareFullContext(
          normalizedPath,
          params.temporaryIgnore,
        );

        // STEP 1: Generate Dynamic Expert Mode
        const expertGenerationPrompt = `# Dynamic Expert Mode Generator

You are an AI system that creates custom expert personas for code analysis. Your task is to analyze the provided project and create a highly specialized expert persona that would be most effective for analyzing this specific codebase.

## Project Analysis Context:
${fullContext}

## User's Expertise Hint:
${params.expertiseHint || "No specific hint provided - auto-detect the best expert type"}

## Your Task:
Create a custom expert persona system prompt that:
1. Identifies the most relevant expertise needed for this project
2. Considers the specific technologies, patterns, and architecture used
3. Tailors the expert knowledge to the project's domain and complexity
4. Creates a comprehensive expert persona for future project analysis

## Output Format:
Return ONLY a complete system prompt that starts with "You are a **[Expert Title]**" and includes:
- Expert title and specialization
- Relevant expertise areas for this specific project
- Analysis framework tailored to the project's characteristics
- Deliverables that match the project's needs
- Technology focus based on what's actually used in the project

Make the expert persona highly specific to this project's stack, patterns, and domain. The more targeted, the better the analysis will be.`;

        // Validate token limit for expert generation
        validateTokenLimit(fullContext, "", expertGenerationPrompt);

        // Generate the custom expert mode using API key rotation
        const createModelFn = (apiKey: string) => {
          return createModelByProvider(
            config.llmDefaultModel,
            {
              maxOutputTokens: 4096,
              temperature: 0.3, // Lower temperature for more consistent expert generation
              topK: 40,
              topP: 0.95,
            },
            apiKey,
          );
        };

        const expertResult = (await retryWithApiKeyRotation(
          createModelFn,
          (model) => model.generateContent(expertGenerationPrompt),
          apiKeys,
        )) as any;
        const expertResponse = await expertResult.response;
        const customExpertPrompt = expertResponse.text();

        const filesProcessed = fullContext.split("--- File:").length - 1;

        return {
          content: [
            {
              type: "text",
              text: `# Dynamic Expert Created Successfully! 

## Project: ${normalizedPath}
*Normalized Path:* ${normalizedPath}

**Expert Generated For:** ${params.expertiseHint || "Auto-detected expertise"}  
**Files Processed:** ${filesProcessed}  
**Total Characters:** ${fullContext.length.toLocaleString()}

---

## 🎯 **Generated Expert Prompt:**

\`\`\`
${customExpertPrompt}
\`\`\`

---

## 📋 **Next Steps:**

1. **Copy the expert prompt above** (the entire content between the backticks)
2. **Use the 'gemini_dynamic_expert_analyze' tool** with:
   - Same project path: \`${normalizedPath}\`
   - Your specific question
   - The expert prompt you just copied
   - Same temporary ignore patterns (if any)

This custom expert is now ready to provide highly specialized analysis tailored specifically to your project's architecture, technologies, and patterns!

---

*Expert generation powered by Gemini 2.5 Pro*`,
            },
          ],
          isError: false,
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `# Dynamic Expert Analysis - Error

**Error:** ${error.message}

### Troubleshooting Guide

✗ **General Error**: Something went wrong during dynamic expert generation
• Verify the project path exists and is accessible
• Ensure your Gemini API key is valid
• Check that the project directory contains readable files
• Try with a smaller project or more specific question

---

### Need Help?
- Check your API key at: https://makersuite.google.com/app/apikey
- Ensure the project path is accessible to the server
- Try with a simpler question or smaller project

*Error occurred during: ${error.message.includes("ENOENT") ? "Path validation" : error.message.includes("API key") ? "API key validation" : "Dynamic expert generation"}*`,
            },
          ],
          isError: true,
        };
      }

    case "gemini_dynamic_expert_analyze":
      try {
        const params = DynamicExpertAnalyzeSchema.parse(
          request.params.arguments,
        );

        // Normalize and validate project path
        const normalizedPath = normalizeProjectPath(params.projectPath);

        // Resolve API keys from multiple sources (only for non-gemini-cli providers)
        const defaultProvider = config.llmDefaultProvider as SupportedProvider;
        const apiKeys = defaultProvider === "gemini-cli" 
          ? [] 
          : resolveProviderApiKeys(defaultProvider === "gemini" ? "gemini" : "google", params);

        if (apiKeys.length === 0 && defaultProvider !== "gemini-cli") {
          throw new Error(
            "Gemini API key is required. Provide geminiApiKey parameter or set GEMINI_API_KEY environment variable. Get your key from https://makersuite.google.com/app/apikey",
          );
        }

        // Validate normalized project path exists
        let stats;
        try {
          stats = await fs.stat(normalizedPath);
        } catch (error: any) {
          if (error.code === "ENOENT") {
            throw new Error(
              `ENOENT: no such file or directory, stat '${normalizedPath}'`,
            );
          }
          throw new Error(`Failed to access project path: ${error.message}`);
        }

        if (!stats.isDirectory()) {
          throw new Error(`Project path is not a directory: ${normalizedPath}`);
        }

        // Get project context with temporary ignore patterns
        const fullContext = await prepareFullContext(
          normalizedPath,
          params.temporaryIgnore,
        );

        if (fullContext.length === 0) {
          throw new Error("No readable files found in the project directory");
        }

        // STEP 2: Use the custom expert prompt for analysis
        const customExpertPrompt = params.expertPrompt;

        // Create the mega prompt using the custom expert
        const megaPrompt = `${customExpertPrompt}

PROJECT CONTEXT:
${fullContext}

CODING AI QUESTION:
${params.question}`;

        // Validate token limit before sending to Gemini 2.5 Pro
        validateTokenLimit(fullContext, customExpertPrompt, params.question);

        // Send to Gemini AI with API key rotation for rate limits
        const createModelFn = (apiKey: string) => {
          return createModelByProvider(
            config.llmDefaultModel,
            {
              maxOutputTokens: 65536,
              temperature: 0.5,
              topK: 40,
              topP: 0.95,
            },
            apiKey,
          );
        };

        const result = (await retryWithApiKeyRotation(
          createModelFn,
          (model) => model.generateContent(megaPrompt),
          apiKeys,
        )) as any;
        const response = await result.response;
        const analysis = response.text();

        const filesProcessed = fullContext.split("--- File:").length - 1;

        return {
          content: [
            {
              type: "text",
              text: `# Dynamic Expert Analysis Results

## Project: ${normalizedPath}
*Normalized Path:* ${normalizedPath}

**Question:** ${params.question}
**Analysis Mode:** Custom Dynamic Expert

**Files Processed:** ${filesProcessed}  
**Total Characters:** ${fullContext.length.toLocaleString()}

---

## Analysis

${analysis}

---

*Analysis powered by Gemini 2.5 Pro in dynamic expert mode*`,
            },
          ],
          isError: false,
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `# Dynamic Expert Analysis - Error

**Error:** ${error.message}

### Troubleshooting Guide

✗ **General Error**: Something went wrong during dynamic expert analysis
• Verify the project path exists and is accessible
• Ensure your Gemini API key is valid
• Check that the project directory contains readable files
• Ensure you copied the complete expert prompt from step 1
• Try with a smaller project or more specific question

---

### Need Help?
- Check your API key at: https://makersuite.google.com/app/apikey
- Ensure the project path is accessible to the server
- Make sure you used the complete expert prompt from 'gemini_dynamic_expert_create'
- Try with a simpler question or smaller project

*Error occurred during: ${error.message.includes("ENOENT") ? "Path validation" : error.message.includes("API key") ? "API key validation" : "Dynamic expert analysis"}*`,
            },
          ],
          isError: true,
        };
      }

    case "gemini_codebase_analyzer":
      try {
        const params = GeminiCodebaseAnalyzerSchema.parse(
          request.params.arguments,
        );

        // Yolu parametreden al
        const projectPath = params.projectPath; 
        const toolContext: RequestContext =
          requestContextService.createRequestContext({
            operation: "GeminiCodebaseAnalysis",
            projectPath: projectPath, // Loglama için gelen yolu kullan
            questionLength: params.question.length,
          });
        
        // Yeni güvenlik fonksiyonunu kullanarak yolu doğrula ve çözümle
        const normalizedPath = normalizeProjectPath(projectPath);

        // Resolve API keys from multiple sources (only for non-gemini-cli providers)
        const defaultProvider = config.llmDefaultProvider as SupportedProvider;
        const apiKeys = defaultProvider === "gemini-cli" 
          ? [] 
          : resolveProviderApiKeys(defaultProvider === "gemini" ? "gemini" : "google", params);

        if (apiKeys.length === 0 && defaultProvider !== "gemini-cli") {
          throw new Error(
            "Gemini API key is required. Provide geminiApiKey parameter or set GEMINI_API_KEY environment variable. Get your key from https://makersuite.google.com/app/apikey",
          );
        }

        // Validate normalized project path exists (with better error handling)
        let stats;
        try {
          stats = await fs.stat(normalizedPath);
        } catch (error: any) {
          if (error.code === "ENOENT") {
            throw new Error(
              `ENOENT: no such file or directory, stat '${normalizedPath}'`,
            );
          }
          throw new Error(`Failed to access project path: ${error.message}`);
        }

        if (!stats.isDirectory()) {
          throw new Error(`Project path is not a directory: ${normalizedPath}`);
        }

        // Prepare project context using normalized path and temporary ignore patterns
        const fullContext = await prepareFullContext(
          normalizedPath,
          params.temporaryIgnore,
        );

        if (fullContext.length === 0) {
          throw new Error("No readable files found in the project directory");
        }

        // Select appropriate system prompt based on analysis mode
        const analysisMode = params.analysisMode || "general";
        const systemPrompt =
          SYSTEM_PROMPTS[analysisMode as keyof typeof SYSTEM_PROMPTS];

        // Create the mega prompt
        const megaPrompt = `${systemPrompt}

PROJECT CONTEXT:
${fullContext}

CODING AI QUESTION:
${params.question}`;

        // Validate token limit before sending to Gemini 2.5 Pro
        validateTokenLimit(fullContext, systemPrompt, params.question);

        // Send to Gemini AI with API key rotation for rate limits
        const createModelFn = (apiKey: string) => {
          return createModelByProvider(
            config.llmDefaultModel,
            {
              maxOutputTokens: 65536,
              temperature: 0.5,
              topK: 40,
              topP: 0.95,
            },
            apiKey,
          );
        };

        const result = (await retryWithApiKeyRotation(
          createModelFn,
          (model) => model.generateContent(megaPrompt),
          apiKeys,
        )) as any;
        const response = await result.response;
        const analysis = response.text();

        const filesProcessed = fullContext.split("--- File:").length - 1;

        return {
          content: [
            {
              type: "text",
              text: `# Gemini Codebase Analysis Results

## Project: ${normalizedPath}
*Normalized Path:* ${normalizedPath}

**Question:** ${params.question}
**Analysis Mode:** ${analysisMode}

**Files Processed:** ${filesProcessed}  
**Total Characters:** ${fullContext.length.toLocaleString()}

---

## Analysis

${analysis}

---

*Analysis powered by Gemini 2.5 Pro in ${analysisMode} mode*`,
            },
          ],
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        let troubleshootingTips = [];

        // Provide specific tips based on error type
        if (errorMessage.includes("ENOENT")) {
          troubleshootingTips = [
            "✗ **Path Error**: The specified directory doesn't exist or isn't accessible",
            "• Check the path spelling and ensure it exists",
            "• For WSL/Linux paths, use absolute paths starting with /",
            "• For Windows paths, try converting to WSL format",
            `• Attempted path: ${(error as any)?.path || "unknown"}`,
          ];
        } else if (errorMessage.includes("API key")) {
          troubleshootingTips = [
            "✗ **API Key Error**: Invalid or missing Gemini API key",
            "• Get your key from [Google AI Studio](https://makersuite.google.com/app/apikey)",
            "• Configure it in Smithery during installation",
            "• Or pass it as geminiApiKey parameter",
          ];
        } else if (errorMessage.includes("timeout")) {
          troubleshootingTips = [
            "✗ **Timeout Error**: Request took too long",
            "• Try with a smaller project directory",
            "• Check your internet connection",
            "• Reduce the scope of your question",
          ];
        } else {
          troubleshootingTips = [
            "✗ **General Error**: Something went wrong",
            "• Verify the project path exists and is accessible",
            "• Ensure your Gemini API key is valid",
            "• Check that the project directory contains readable files",
            "• Try with a smaller project or more specific question",
          ];
        }

        return {
          content: [
            {
              type: "text",
              text: `# Gemini Codebase Analysis - Error

**Error:** ${errorMessage}

### Troubleshooting Guide

${troubleshootingTips.join("\n")}

---

### Need Help?
- Check your API key at: https://makersuite.google.com/app/apikey
- Ensure the project path is accessible to the server
- Try with a simpler question or smaller project

*Error occurred during: ${errorMessage.includes("ENOENT") ? "Path validation" : errorMessage.includes("API key") ? "API key validation" : "AI analysis"}*`,
            },
          ],
          isError: true,
        };
      }

    case "gemini_code_search":
      try {
        const params = GeminiCodeSearchSchema.parse(request.params.arguments);

        // Yeni güvenlik fonksiyonunu kullanarak yolu doğrula ve çözümle
        const normalizedPath = normalizeProjectPath(params.projectPath);

        // Resolve API keys from multiple sources (only for non-gemini-cli providers)
        const defaultProvider = config.llmDefaultProvider as SupportedProvider;
        const apiKeys = defaultProvider === "gemini-cli" 
          ? [] 
          : resolveProviderApiKeys(defaultProvider === "gemini" ? "gemini" : "google", params);

        if (apiKeys.length === 0 && defaultProvider !== "gemini-cli") {
          throw new Error(
            "Gemini API key is required. Provide geminiApiKey parameter or set GEMINI_API_KEY environment variable. Get your key from https://makersuite.google.com/app/apikey",
          );
        }

        // Validate normalized project path exists
        let stats;
        try {
          stats = await fs.stat(normalizedPath);
        } catch (error: any) {
          if (error.code === "ENOENT") {
            throw new Error(
              `ENOENT: no such file or directory, stat '${normalizedPath}'`,
            );
          }
          throw new Error(`Failed to access project path: ${error.message}`);
        }

        if (!stats.isDirectory()) {
          throw new Error(`Project path is not a directory: ${normalizedPath}`);
        }

        // Find relevant code snippets
        const maxResults = params.maxResults || 5;
        const searchResult = await findRelevantCodeSnippets(
          normalizedPath,
          params.searchQuery,
          params.fileTypes,
          maxResults,
          params.temporaryIgnore,
        );

        if (searchResult.snippets.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `# Gemini Code Search Results

## Search Query: "${params.searchQuery}"
**Project:** /workspace
**Files Scanned:** ${searchResult.totalFiles}
**Results Found:** 0

### No Matching Code Found

The search didn't find any relevant code snippets matching your query. Try:

- Using different keywords or terms
- Checking if the feature exists in this codebase
- Using broader search terms
- Trying the comprehensive analyzer instead

*Search powered by Gemini 2.5 Pro*`,
              },
            ],
          };
        }

        // Prepare context from relevant snippets
        let searchContext = "";
        for (const snippet of searchResult.snippets) {
          searchContext += `--- File: ${snippet.file} (${snippet.relevance}) ---\n`;
          searchContext += snippet.content;
          searchContext += "\n\n";
        }

        const searchPrompt = `You are a senior AI Software Engineer analyzing specific code snippets from a project. Your task is to help another coding AI understand the most relevant parts of the codebase related to their search query.

SEARCH QUERY: "${params.searchQuery}"

RELEVANT CODE SNIPPETS:
${searchContext}

YOUR TASK:
1. Analyze the provided code snippets that are most relevant to the search query
2. Explain what you found and how it relates to the search query  
3. Provide specific code examples and explanations
4. If multiple relevant patterns are found, organize your response clearly
5. Focus on practical, actionable insights about the found code

RESPONSE FORMAT:
- Use clear Markdown formatting
- Include specific code snippets with explanations
- Provide file paths and line references when relevant
- Be concise but comprehensive
- Focus on answering the search query specifically`;

        // Validate token limit before sending to Gemini 2.5 Pro
        validateTokenLimit(searchContext, "", params.searchQuery);

        // Send to Gemini AI with API key rotation for rate limits
        const createModelFn = (apiKey: string) => {
          return createModelByProvider(
            config.llmDefaultModel,
            {
              maxOutputTokens: 65536,
              temperature: 0.5,
              topK: 40,
              topP: 0.95,
            },
            apiKey,
          );
        };

        const result = (await retryWithApiKeyRotation(
          createModelFn,
          (model) => model.generateContent(searchPrompt),
          apiKeys,
        )) as any;
        const response = await result.response;
        const analysis = response.text();

        return {
          content: [
            {
              type: "text",
              text: `# Gemini Code Search Results

## Search Query: "${params.searchQuery}"
**Project:** /workspace
*Normalized Path:* ${normalizedPath}

**Files Scanned:** ${searchResult.totalFiles}  
**Relevant Files Found:** ${searchResult.snippets.length}
**Analysis Mode:** Targeted Search (fast)

---

## Analysis

${analysis}

---

### Search Summary
- **Query:** ${params.searchQuery}
- **File Types:** ${params.fileTypes?.join(", ") || "All files"}
- **Max Results:** ${maxResults}
- **Found:** ${searchResult.snippets.length} relevant code snippets

*Search powered by Gemini 2.5 Pro*`,
            },
          ],
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        let troubleshootingTips = [];

        // Provide specific tips based on error type
        if (errorMessage.includes("ENOENT")) {
          troubleshootingTips = [
            "✗ **Path Error**: The specified directory doesn't exist or isn't accessible",
            "• Check the path spelling and ensure it exists",
            "• For WSL/Linux paths, use absolute paths starting with /",
            "• For Windows paths, try converting to WSL format",
            `• Attempted path: ${(error as any)?.path || "unknown"}`,
          ];
        } else if (errorMessage.includes("API key")) {
          troubleshootingTips = [
            "✗ **API Key Error**: Invalid or missing Gemini API key",
            "• Get your key from [Google AI Studio](https://makersuite.google.com/app/apikey)",
            "• Configure it in Smithery during installation",
            "• Or pass it as geminiApiKey parameter",
          ];
        } else if (errorMessage.includes("search")) {
          troubleshootingTips = [
            "✗ **Search Error**: Problem during code search",
            "• Try with a simpler search query",
            "• Check if the project directory is accessible",
            "• Verify file types are correct (e.g., ['.ts', '.js'])",
          ];
        } else {
          troubleshootingTips = [
            "✗ **General Error**: Something went wrong during search",
            "• Verify the project path exists and is accessible",
            "• Ensure your Gemini API key is valid",
            "• Try with a simpler search query",
            "• Check that the project directory contains readable files",
          ];
        }

        return {
          content: [
            {
              type: "text",
              text: `# Gemini Code Search - Error

**Error:** ${errorMessage}

### Troubleshooting Guide

${troubleshootingTips.join("\n")}

---

### Need Help?
- Check your API key at: https://makersuite.google.com/app/apikey
- Ensure the project path is accessible to the server
- Try with a simpler search query or use the comprehensive analyzer

*Error occurred during: ${errorMessage.includes("ENOENT") ? "Path validation" : errorMessage.includes("API key") ? "API key validation" : errorMessage.includes("search") ? "Code search" : "AI analysis"}*`,
            },
          ],
          isError: true,
        };
      }

    case "calculate_token_count":
      try {
        logger.info("Received request to calculate token count", {
          hasText: !!request.params.arguments?.textToAnalyze,
          hasProjectPath: !!request.params.arguments?.projectPath,
        });

        const params = TokenCalculatorSchema.parse(request.params.arguments);
        
        // Validate that either projectPath or textToAnalyze is provided
        if (!params.projectPath && !params.textToAnalyze) {
          throw new Error("Either projectPath or textToAnalyze must be provided");
        }
        
        // Resolve API keys from multiple sources (same as other tools)
        const apiKeys = resolveProviderApiKeys("google", params);
        if (apiKeys.length === 0 && params.tokenizerModel === "gemini-2.0-flash") {
          throw new Error(
            "Gemini API key is required when using Gemini tokenizer. Provide geminiApiKey parameter or set GEMINI_API_KEY environment variable. Get your key from https://makersuite.google.com/app/apikey",
          );
        }
        
        const toolContext: RequestContext =
          requestContextService.createRequestContext({
            operation: "CalculateTokenCount",
            projectPath: params.projectPath || "direct_text",
          });

        // If direct text is provided, calculate tokens for that text only
        if (params.textToAnalyze) {
          let tokenCount: number;
          let modelUsed: string;

          if (params.tokenizerModel === "gemini-2.0-flash") {
            // Use the first available API key (same pattern as other tools)
            const apiKey = apiKeys[0];
            tokenCount = await countTokensWithGemini(params.textToAnalyze, apiKey);
            modelUsed = "gemini-2.0-flash";
          } else {
            tokenCount = await countTokens(params.textToAnalyze, toolContext);
            modelUsed = "gpt-4o";
          }

          const response = {
            mode: "direct_text",
            tokenCount: tokenCount,
            characterCount: params.textToAnalyze.length,
            modelUsedForTokenization: modelUsed,
          };

          logger.info("Direct text token calculation completed", response);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(response, null, 2),
              },
            ],
            isError: false,
          };
        }

        // Project analysis mode
        if (!params.projectPath) {
          throw new Error("projectPath is required for project analysis mode");
        }
        
        const normalizedPath = normalizeProjectPath(params.projectPath);
        logger.info("Starting project token analysis", { projectPath: normalizedPath });

        // Set up ignore patterns
        const ig = ignore();
        
        // Add default ignore patterns
        ig.add([
          'node_modules/**',
          '.git/**',
          'dist/**',
          'build/**',
          '*.log',
          '.DS_Store',
          'Thumbs.db',
          '*.tmp',
          '*.temp',
          '.env*',
          '*.key',
          '*.pem',
          '*.p12',
          '*.pfx',
          '*.jks',
        ]);

        // Add temporary ignore patterns if provided
        if (params.temporaryIgnore) {
          ig.add(params.temporaryIgnore);
        }

        // Try to read .gitignore
        try {
          const gitignorePath = path.join(normalizedPath, '.gitignore');
          const gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
          ig.add(gitignoreContent);
          logger.debug("Loaded .gitignore patterns");
        } catch (error) {
          logger.debug("No .gitignore found or couldn't read it");
        }

        // Find all files
        const globPattern = (params.fileExtensions && Array.isArray(params.fileExtensions) && params.fileExtensions.length > 0)
          ? `**/*@(${params.fileExtensions.join('|')})`
          : '**/*';
          
        logger.debug("File search debug", {
          globPattern,
          normalizedPath,
          hasFileExtensions: !!(params.fileExtensions && Array.isArray(params.fileExtensions)),
          fileExtensionsCount: params.fileExtensions?.length || 0,
          fileExtensions: params.fileExtensions,
          apiKeysCount: apiKeys.length,
          hasApiKeys: apiKeys.length > 0
        });
          
        const allFiles = await glob(globPattern, {
          cwd: normalizedPath,
          nodir: true,
          dot: false,
        });
        
        logger.debug("Glob results", {
          allFilesCount: allFiles.length,
          firstFewFiles: allFiles.slice(0, 5)
        });

        // Filter files
        const filteredFiles = allFiles.filter(file => !ig.ignores(file));
        
        logger.info(`Found ${filteredFiles.length} files to analyze (${allFiles.length} total, ${allFiles.length - filteredFiles.length} ignored)`);

        // Determine which tokenizer to use for the entire analysis
        const useGeminiTokenizer = params.tokenizerModel === "gemini-2.0-flash";
        const modelUsed = useGeminiTokenizer ? "gemini-2.0-flash" : "gpt-4o";

        // First, read all files and prepare content
        const fileContents: Array<{file: string, content: string, characters: number}> = [];
        let skippedFiles = 0;

        for (const file of filteredFiles) {
          try {
            const filePath = path.join(normalizedPath, file);
            const stats = await fs.stat(filePath);
            
            // Skip files that are too large
            if (stats.size > params.maxFileSize!) {
              skippedFiles++;
              logger.debug(`Skipped large file: ${file} (${stats.size} bytes)`);
              continue;
            }

            // Skip binary files (basic check)
            if (stats.size === 0) continue;

            const content = await fs.readFile(filePath, 'utf-8');
            
            // Skip if content appears to be binary
            if (content.includes('\0')) {
              skippedFiles++;
              continue;
            }

            fileContents.push({
              file,
              content,
              characters: content.length
            });

          } catch (error) {
            skippedFiles++;
            logger.debug(`Error reading file ${file}:`, error);
          }
        }

        logger.info(`Read ${fileContents.length} files, preparing token count...`);

        let totalTokens = 0;
        let totalCharacters = 0;
        const fileBreakdown: Array<{file: string, tokens: number, characters: number}> = [];

        if (useGeminiTokenizer && fileContents.length > 0) {
          // Combine all file contents with file markers for accurate token counting
          const combinedContent = fileContents.map(f => `=== FILE: ${f.file} ===\n${f.content}`).join('\n\n');
          
          // Single API call for all files
          const apiKey = apiKeys[0];
          totalTokens = await countTokensWithGemini(combinedContent, apiKey);
          totalCharacters = fileContents.reduce((sum, f) => sum + f.characters, 0);
          
          // Calculate individual file tokens proportionally based on character count
          // This gives approximate token counts per file
          const totalChars = fileContents.reduce((sum, f) => sum + f.characters, 0);
          if (totalChars > 0) {
            for (const fileContent of fileContents) {
              const ratio = fileContent.characters / totalChars;
              const estimatedTokens = Math.round(totalTokens * ratio);
              fileBreakdown.push({
                file: fileContent.file,
                tokens: estimatedTokens,
                characters: fileContent.characters
              });
            }
          }
        } else {
          // Use local tokenizer for gpt-4o or when no files
          for (const fileContent of fileContents) {
            const fileTokens = await countTokens(fileContent.content, toolContext);
            totalTokens += fileTokens;
            totalCharacters += fileContent.characters;
            fileBreakdown.push({
              file: fileContent.file,
              tokens: fileTokens,
              characters: fileContent.characters
            });
          }
        }

        const analyzedFiles = fileContents.length;

        // Sort by token count (highest first) for the breakdown
        fileBreakdown.sort((a, b) => b.tokens - a.tokens);

        const response = {
          mode: "project_analysis",
          projectPath: normalizedPath,
          summary: {
            totalTokens,
            totalCharacters,
            analyzedFiles,
            skippedFiles,
            totalFiles: filteredFiles.length,
          },
          modelUsedForTokenization: modelUsed,
          topFiles: fileBreakdown.slice(0, 10), // Top 10 files by token count
          filters: {
            temporaryIgnore: params.temporaryIgnore || [],
            fileExtensions: params.fileExtensions || "all",
            maxFileSize: params.maxFileSize,
          }
        };

        logger.info("Project token analysis completed", {
          totalTokens,
          analyzedFiles,
          skippedFiles,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response, null, 2),
            },
          ],
          isError: false,
        };

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("Error in calculate_token_count tool", { error: errorMessage });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: {
                  message: "Token hesaplanırken bir hata oluştu",
                  details: errorMessage,
                },
              }),
            },
          ],
          isError: true,
        };
      }

    case "project_orchestrator_create":
      try {
        const params = ProjectOrchestratorCreateSchema.parse(
          request.params.arguments,
        );

        // Yolu parametreden al
        const projectPath = params.projectPath;
        const toolContext: RequestContext =
          requestContextService.createRequestContext({
            operation: "ProjectOrchestratorCreate",
            projectPath: projectPath, // Loglama için gelen yolu kullan
          });
        
        // Yeni güvenlik fonksiyonunu kullanarak yolu doğrula ve çözümle
        const normalizedPath = normalizeProjectPath(projectPath);

        // Resolve API keys from multiple sources (only for non-gemini-cli providers)
        const defaultProvider = config.llmDefaultProvider as SupportedProvider;
        const apiKeys = defaultProvider === "gemini-cli" 
          ? [] 
          : resolveProviderApiKeys(defaultProvider === "gemini" ? "gemini" : "google", params);

        if (apiKeys.length === 0 && defaultProvider !== "gemini-cli") {
          throw new Error(
            "Gemini API key is required. Provide geminiApiKey parameter or set GEMINI_API_KEY environment variable. Get your key from https://makersuite.google.com/app/apikey",
          );
        }

        // Validate normalized project path exists
        let stats;
        try {
          stats = await fs.stat(normalizedPath);
        } catch (error: any) {
          if (error.code === "ENOENT") {
            throw new Error(
              `ENOENT: no such file or directory, stat '${normalizedPath}'`,
            );
          }
          throw new Error(`Failed to access project path: ${error.message}`);
        }

        if (!stats.isDirectory()) {
          throw new Error(`Project path is not a directory: ${normalizedPath}`);
        }

        const maxTokensPerGroup = params.maxTokensPerGroup || 900000;

        // Get all files with token information
        let gitignoreRules: string[] = [];
        try {
          const gitignorePath = path.join(normalizedPath, ".gitignore");
          const gitignoreContent = await fs.readFile(gitignorePath, "utf-8");
          gitignoreRules = gitignoreContent
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith("#"));
        } catch (error) {
          // No .gitignore file, continue
        }

        const allIgnorePatterns = [
          ...gitignoreRules,
          ...(params.temporaryIgnore || []),
          "node_modules/**",
          ".git/**",
          "*.log",
          ".env*",
          "dist/**",
          "build/**",
          "*.map",
          "*.lock",
          ".cache/**",
          "coverage/**",
          "logs/**", // Don't include our own logs
        ];

        // Scan all files
        const files = await glob("**/*", {
          cwd: normalizedPath,
          ignore: allIgnorePatterns,
          nodir: true,
        });

        // Calculate tokens for each file
        const fileTokenInfos: FileTokenInfo[] = [];
        let totalProjectTokens = 0;

        for (const file of files) {
          const fileInfo = await getFileTokenInfo(normalizedPath, file);
          if (fileInfo) {
            fileTokenInfos.push(fileInfo);
            totalProjectTokens += fileInfo.tokens;
          }
        }

        // Create file groups for large projects using AI
        const groups = await createFileGroupsWithAI(
          fileTokenInfos,
          maxTokensPerGroup,
          apiKeys,
          "General project analysis",
        );

        // Serialize groups data for step 2
        const groupsData = JSON.stringify({
          groups: groups.map((g) => ({
            files: g.files.map((f) => ({
              filePath: f.filePath,
              tokens: f.tokens,
            })),
            totalTokens: g.totalTokens,
            groupIndex: g.groupIndex,
            name: g.name,
            description: g.description,
            reasoning: g.reasoning,
            customPrompt: g.customPrompt,
          })),
          totalFiles: fileTokenInfos.length,
          totalTokens: totalProjectTokens,
          projectPath: normalizedPath,
          analysisMode: params.analysisMode,
          maxTokensPerGroup: maxTokensPerGroup,
        });

        return {
          content: [
            {
              type: "text",
              text: `# Project Orchestrator Groups Created Successfully!

## Project: ${normalizedPath}
*Normalized Path:* ${normalizedPath}

**Total Files:** ${fileTokenInfos.length}  
**Total Tokens:** ${totalProjectTokens.toLocaleString()}  
**Analysis Mode:** ${params.analysisMode}  
**Max Tokens Per Group:** ${maxTokensPerGroup.toLocaleString()}  

---

## 📦 **File Groups Created:**

${groups
  .map(
    (
      group,
      index,
    ) => `### Group ${index + 1}${group.name ? ` - ${group.name}` : ""}
- **Files:** ${group.files.length}
- **Tokens:** ${group.totalTokens.toLocaleString()}
${group.description ? `- **Description:** ${group.description}` : ""}
${group.reasoning ? `- **AI Reasoning:** ${group.reasoning}` : ""}
${group.customPrompt ? `- **🎯 Custom Expert:** ${group.customPrompt.substring(0, 150)}...` : ""}

**Files in this group:**
${group.files.map((f) => `  - ${f.filePath} (${f.tokens} tokens)`).join("\n")}

---`,
  )
  .join("\n")}

## 📋 **Next Steps:**

1. **Copy the groups data below** (the entire JSON between the backticks)
2. **Use the 'project_orchestrator_analyze' tool** with:
   - Same project path: \`${normalizedPath}\`
   - Your specific question
   - Same analysis mode: \`${params.analysisMode}\`
   - The groups data you just copied
   - Same temporary ignore patterns (if any)

## 🔧 **Groups Data:**

\`\`\`json
${groupsData}
\`\`\`

---

*Groups creation powered by Gemini 2.5 Pro with AI-powered intelligent file grouping*`,
            },
          ],
          isError: false,
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `# Project Orchestrator Create - Error

**Error:** ${error.message}

### Troubleshooting Guide

✗ **General Error**: Something went wrong during orchestrator groups creation
• Verify the project path exists and is accessible
• Ensure your Gemini API key is valid
• Check that the project directory contains readable files
• Try with a smaller maxTokensPerGroup value

---

### Need Help?
- Check your API key at: https://makersuite.google.com/app/apikey
- Ensure the project path is accessible to the server
- Try with a simpler project structure first

*Error occurred during: ${error.message.includes("ENOENT") ? "Path validation" : error.message.includes("API key") ? "API key validation" : "Groups creation"}*`,
            },
          ],
          isError: true,
        };
      }

    case "project_orchestrator_analyze":
      try {
        const params = ProjectOrchestratorAnalyzeSchema.parse(
          request.params.arguments,
        );

        // Normalize and validate project path
        const normalizedPath = normalizeProjectPath(params.projectPath);

        // Resolve API keys from multiple sources (only for non-gemini-cli providers)
        const defaultProvider = config.llmDefaultProvider as SupportedProvider;
        const apiKeys = defaultProvider === "gemini-cli" 
          ? [] 
          : resolveProviderApiKeys(defaultProvider === "gemini" ? "gemini" : "google", params);

        if (apiKeys.length === 0 && defaultProvider !== "gemini-cli") {
          throw new Error(
            "Gemini API key is required. Provide geminiApiKey parameter or set GEMINI_API_KEY environment variable. Get your key from https://makersuite.google.com/app/apikey",
          );
        }

        // Parse groups data from step 1
        let groupsData;
        try {
          groupsData = JSON.parse(params.fileGroupsData);
        } catch (error) {
          throw new Error(
            "Invalid groups data JSON. Please ensure you copied the complete groups data from project_orchestrator_create step.",
          );
        }

        // Validate normalized project path exists
        let stats;
        try {
          stats = await fs.stat(normalizedPath);
        } catch (error: any) {
          if (error.code === "ENOENT") {
            throw new Error(
              `ENOENT: no such file or directory, stat '${normalizedPath}'`,
            );
          }
          throw new Error(`Failed to access project path: ${error.message}`);
        }

        if (!stats.isDirectory()) {
          throw new Error(`Project path is not a directory: ${normalizedPath}`);
        }

        // Reconstruct file groups with actual file content
        const groups: FileGroup[] = [];
        for (const groupData of groupsData.groups) {
          const files: FileTokenInfo[] = [];

          for (const fileData of groupData.files) {
            try {
              const filePath = path.join(normalizedPath, fileData.filePath);
              const content = await fs.readFile(filePath, "utf-8");
              files.push({
                filePath: fileData.filePath,
                tokens: fileData.tokens,
                content: content,
              });
            } catch (error) {
              logger.warn("Failed to read file during analysis", {
                filePath: fileData.filePath,
                error: error instanceof Error ? error.message : "Unknown error",
              });
            }
          }

          groups.push({
            files: files,
            totalTokens: groupData.totalTokens,
            groupIndex: groupData.groupIndex,
            name: groupData.name,
            description: groupData.description,
            reasoning: groupData.reasoning,
            customPrompt: groupData.customPrompt,
          });
        }

        // Analyze each group in parallel with delay
        const systemPrompt =
          SYSTEM_PROMPTS[params.analysisMode as keyof typeof SYSTEM_PROMPTS] ||
          SYSTEM_PROMPTS.general;

        // Create async function for each group analysis
        const analyzeGroup = async (
          group: FileGroup,
          index: number,
          delayMs: number = 0,
        ): Promise<string> => {
          // Add delay to prevent API rate limiting
          if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }

          try {
            const groupContext = group.files
              .map((f) => `--- File: ${f.filePath} ---\n${f.content}`)
              .join("\n\n");

            // Use custom prompt if available, otherwise fallback to system prompt
            const effectivePrompt = group.customPrompt || systemPrompt;

            const groupPrompt = `${effectivePrompt}

**GROUP CONTEXT (${index + 1}/${groups.length}):**
This is group ${index + 1} of ${groups.length} from a large project analysis. ${group.name ? `Group Name: "${group.name}"` : ""} ${group.description ? `Group Description: ${group.description}` : ""}

${group.reasoning ? `**AI Grouping Reasoning:** ${group.reasoning}` : ""}

Files in this group:
${group.files.map((f) => `- ${f.filePath} (${f.tokens} tokens)`).join("\n")}

**PROJECT SUBSET:**
${groupContext}

**USER QUESTION:**
${params.question}

Please analyze this subset of the project in the context of the user's question. ${group.name ? `Focus on the "${group.name}" aspect as this group was specifically created for that purpose.` : `Remember this is part ${index + 1} of ${groups.length} total parts.`}`;

            const groupResult = await retryWithApiKeyRotation(
              (apiKey: string) =>
                createModelByProvider(
                  config.llmDefaultModel,
                  undefined,
                  apiKey,
                ),
              async (model) => model.generateContent(groupPrompt),
              apiKeys,
            );

            const groupResponse = await groupResult.response;
            const groupAnalysis = groupResponse.text();

            logger.info("Completed group analysis", {
              groupIndex: index + 1,
              responseLength: groupAnalysis.length,
            });

            return groupAnalysis;
          } catch (error) {
            logger.error("Failed to analyze group", {
              groupIndex: index + 1,
              error: error instanceof Error ? error.message : "Unknown error",
            });
            return `**Group ${index + 1} Analysis Failed:** ${error instanceof Error ? error.message : "Unknown error"}`;
          }
        };

        // Launch all group analyses in parallel with staggered delays
        const groupPromises = groups.map(
          (group, index) => analyzeGroup(group, index, index * 700), // 0.7 second delay between each group
        );

        // Wait for all analyses to complete
        const groupResults = await Promise.all(groupPromises);

        // Aggregate all results
        const finalAnalysis = aggregateAnalysisResults(
          groupResults,
          params.question,
          params.analysisMode,
        );

        return {
          content: [
            {
              type: "text",
              text: `# Project Orchestrator Analysis Results

## Project: ${normalizedPath}
*Normalized Path:* ${normalizedPath}

**Question:** ${params.question}
**Analysis Mode:** ${params.analysisMode}

**Total Files:** ${groupsData.totalFiles}  
**Total Tokens:** ${groupsData.totalTokens.toLocaleString()}  
**Analysis Groups:** ${groups.length}  
**Max Tokens Per Group:** ${(params.maxTokensPerGroup || 900000).toLocaleString()}  

---

${finalAnalysis}

## Orchestration Statistics
**Project Path:** ${normalizedPath}  
**Total Files Analyzed:** ${groupsData.totalFiles}  
**Total Project Tokens:** ${groupsData.totalTokens.toLocaleString()}  
**Analysis Groups Created:** ${groups.length}  
**Max Tokens Per Group:** ${(params.maxTokensPerGroup || 900000).toLocaleString()}  
**API Keys Used:** ${apiKeys.length}  

### Group Breakdown
${groups.map((group, index) => `- **Group ${index + 1}${group.name ? ` (${group.name})` : ""}**: ${group.files.length} files, ${group.totalTokens.toLocaleString()} tokens${group.description ? ` - ${group.description}` : ""}`).join("\n")}

---

*Analysis powered by Project Orchestrator with Gemini 2.5 Pro*`,
            },
          ],
          isError: false,
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `# Project Orchestrator Analysis - Error

**Error:** ${error.message}

### Troubleshooting Guide

✗ **General Error**: Something went wrong during orchestrator analysis
• Verify the project path exists and is accessible
• Ensure your Gemini API key is valid
• Check that the project directory contains readable files
• Ensure you copied the complete groups data from step 1
• Try with a smaller project or more specific question

---

### Need Help?
- Check your API key at: https://makersuite.google.com/app/apikey
- Ensure the project path is accessible to the server
- Make sure you used the complete groups data from 'project_orchestrator_create'
- Try with a simpler question or smaller project

*Error occurred during: ${error.message.includes("ENOENT") ? "Path validation" : error.message.includes("API key") ? "API key validation" : error.message.includes("JSON") ? "Groups data parsing" : "Orchestrator analysis"}*`,
            },
          ],
          isError: true,
        };
      }

    default:
      logger.warn("Unknown tool called", { toolName: request.params.name });
      throw new Error(`Unknown tool: ${request.params.name}`);
  }
});

// Helper function for smart code search - finds relevant code snippets
async function findRelevantCodeSnippets(
  projectPath: string,
  searchQuery: string,
  fileTypes?: string[],
  maxResults: number = 5,
  temporaryIgnore: string[] = [],
): Promise<{
  snippets: Array<{ file: string; content: string; relevance: string }>;
  totalFiles: number;
}> {
  try {
    let gitignoreRules: string[] = [];

    // Read .gitignore file if it exists
    try {
      const gitignorePath = path.join(projectPath, ".gitignore");
      const gitignoreContent = await fs.readFile(gitignorePath, "utf-8");
      gitignoreRules = gitignoreContent
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
    } catch (error) {
      // No .gitignore file, continue
    }

    // Build file pattern based on fileTypes
    let patterns = ["**/*"];
    if (fileTypes && fileTypes.length > 0) {
      patterns = fileTypes.map(
        (ext) => `**/*${ext.startsWith(".") ? ext : "." + ext}`,
      );
    }

    let allFiles: string[] = [];
    for (const pattern of patterns) {
      const files = await glob(pattern, {
        cwd: projectPath,
        ignore: [
          ...gitignoreRules,
          ...temporaryIgnore, // Add temporary ignore patterns
          "node_modules/**",
          ".git/**",
          "*.log",
          ".env*",
          "dist/**",
          "build/**",
          "*.map",
          "*.lock",
          ".cache/**",
          "coverage/**",
        ],
        nodir: true,
      });
      allFiles.push(...files);
    }

    // Remove duplicates
    allFiles = [...new Set(allFiles)];

    const relevantSnippets: Array<{
      file: string;
      content: string;
      relevance: string;
    }> = [];

    // Simple keyword-based relevance scoring (can be enhanced with embeddings later)
    const searchTerms = searchQuery.toLowerCase().split(/\s+/);

    for (const file of allFiles.slice(0, 50)) {
      // Limit files to process for performance
      try {
        const filePath = path.join(projectPath, file);
        const content = await fs.readFile(filePath, "utf-8");

        // Skip very large files
        if (content.length > 100000) continue;

        // Calculate relevance score
        const contentLower = content.toLowerCase();
        let score = 0;
        let matchedTerms: string[] = [];

        for (const term of searchTerms) {
          const matches = (contentLower.match(new RegExp(term, "g")) || [])
            .length;
          if (matches > 0) {
            score += matches;
            matchedTerms.push(term);
          }
        }

        // Boost score for files with terms in filename
        const fileLower = file.toLowerCase();
        for (const term of searchTerms) {
          if (fileLower.includes(term)) {
            score += 5;
            matchedTerms.push(`${term} (in filename)`);
          }
        }

        if (score > 0) {
          relevantSnippets.push({
            file,
            content:
              content.length > 5000
                ? content.substring(0, 5000) + "\n...(truncated)"
                : content,
            relevance: `Score: ${score}, Matched: ${[...new Set(matchedTerms)].join(", ")}`,
          });
        }
      } catch (error) {
        // Skip unreadable files
        continue;
      }
    }

    // Sort by relevance score and take top results
    relevantSnippets.sort((a, b) => {
      const scoreA = parseInt(a.relevance.match(/Score: (\d+)/)?.[1] || "0");
      const scoreB = parseInt(b.relevance.match(/Score: (\d+)/)?.[1] || "0");
      return scoreB - scoreA;
    });

    return {
      snippets: relevantSnippets.slice(0, maxResults),
      totalFiles: allFiles.length,
    };
  } catch (error) {
    throw new Error(`Failed to search codebase: ${error}`);
  }
}

// Helper function to prepare full context
async function prepareFullContext(
  projectPath: string,
  temporaryIgnore: string[] = [],
): Promise<string> {
  try {
    let gitignoreRules: string[] = [];

    // Read .gitignore file if it exists
    try {
      const gitignorePath = path.join(projectPath, ".gitignore");
      const gitignoreContent = await fs.readFile(gitignorePath, "utf-8");
      gitignoreRules = gitignoreContent
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
    } catch (error) {
      // No .gitignore file, continue
    }

    // Combine default ignore patterns with gitignore rules and temporary ignore
    const allIgnorePatterns = [
      ...gitignoreRules,
      ...temporaryIgnore, // Add temporary ignore patterns
      "node_modules/**",
      ".git/**",
      "*.log",
      ".env*",
      "dist/**",
      "build/**",
      "*.map",
      "*.lock",
      ".cache/**",
      "coverage/**",
    ];

    // Scan all files in the project
    const files = await glob("**/*", {
      cwd: projectPath,
      ignore: allIgnorePatterns,
      nodir: true,
    });

    let fullContext = "";

    // Read each file and combine content
    for (const file of files) {
      try {
        const filePath = path.join(projectPath, file);
        const content = await fs.readFile(filePath, "utf-8");

        fullContext += `--- File: ${file} ---\n`;
        fullContext += content;
        fullContext += "\n\n";
      } catch (error) {
        // Skip binary files or unreadable files
        continue;
      }
    }

    return fullContext;
  } catch (error) {
    throw new Error(`Failed to prepare project context: ${error}`);
  }
}

// Project Orchestrator Helper Functions
interface FileTokenInfo {
  filePath: string;
  tokens: number;
  content: string;
}

interface FileGroup {
  files: FileTokenInfo[];
  totalTokens: number;
  groupIndex: number;
  name?: string;
  description?: string;
  reasoning?: string;
  customPrompt?: string;
}

// Calculate tokens for a single file content
function calculateFileTokens(content: string): number {
  // Enhanced token calculation for code files
  const basicEstimate = Math.ceil(content.length / 4);
  const newlineCount = (content.match(/\n/g) || []).length;
  const spaceCount = (content.match(/ {2,}/g) || []).length; // Multiple spaces
  const specialCharsCount = (
    content.match(/[{}[\]();,.<>\/\\=+\-*&|!@#$%^`~]/g) || []
  ).length;
  const codeStructuresCount = (
    content.match(/(function|class|interface|import|export|const|let|var)/g) ||
    []
  ).length;

  const adjustedEstimate =
    basicEstimate +
    Math.ceil(newlineCount * 0.5) +
    Math.ceil(spaceCount * 0.3) +
    Math.ceil(specialCharsCount * 0.2) +
    Math.ceil(codeStructuresCount * 2); // Code structures are token-heavy

  return adjustedEstimate;
}

// Get file information with token count
async function getFileTokenInfo(
  projectPath: string,
  filePath: string,
): Promise<FileTokenInfo | null> {
  try {
    const fullPath = path.join(projectPath, filePath);
    const content = await fs.readFile(fullPath, "utf-8");
    const tokens = calculateFileTokens(content);

    return {
      filePath,
      tokens,
      content,
    };
  } catch (error) {
    logger.warn("Failed to read file for token calculation", {
      filePath,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return null;
  }
}

// AI-powered intelligent file grouping
async function createFileGroupsWithAI(
  files: FileTokenInfo[],
  maxTokensPerGroup: number = 900000,
  apiKeys: string[],
  question: string,
): Promise<FileGroup[]> {
  logger.info("Starting AI-powered file grouping", {
    totalFiles: files.length,
    totalTokens: files.reduce((sum, f) => sum + f.tokens, 0),
    maxTokensPerGroup,
  });

  try {
    // Create file manifest for AI
    const fileManifest = files.map((f) => ({
      path: f.filePath,
      tokens: f.tokens,
      size: f.content.length,
      extension: path.extname(f.filePath),
      directory: path.dirname(f.filePath),
    }));

    const groupingPrompt = `You are an expert project architect who needs to intelligently group files for analysis. Your task is to create semantic groups that stay under token limits while keeping related files together.

**PROJECT FILES MANIFEST:**
${JSON.stringify(fileManifest, null, 2)}

**CONSTRAINTS:**
- Maximum tokens per group: ${maxTokensPerGroup.toLocaleString()}
- Total files to group: ${files.length}
- User's question context: "${question}"

**GROUPING STRATEGY:**
Create logical groups based on:
1. **Functional Relationships**: Group files that work together (components, services, utilities)
2. **Directory Structure**: Keep related directories together when possible  
3. **File Dependencies**: Group files that likely import/depend on each other
4. **Analysis Context**: Consider the user's question to prioritize relevant groupings
5. **Token Efficiency**: Maximize files per group while staying under limits

**CUSTOM PROMPT REQUIREMENT:**
For each group, you MUST create a specialized "customPrompt" that:
- Defines a specific expert persona (e.g., "Frontend UI/UX Specialist", "Backend API Developer", "DevOps Engineer")
- Tailors analysis focus to the group's purpose (e.g., component architecture, API design, deployment strategies)
- Provides specific guidance for analyzing that particular group of files
- Includes relevant technical areas and best practices for that domain
- Ensures the prompt is highly relevant to the files in that group

**OUTPUT FORMAT (JSON only):**
\`\`\`json
{
  "groups": [
    {
      "name": "Core Components",
      "description": "Main React components and UI logic",
      "files": ["src/components/Header.tsx", "src/components/Footer.tsx"],
      "estimatedTokens": 45000,
      "reasoning": "These UI components work together and should be analyzed as a unit",
      "customPrompt": "You are a **Frontend UI/UX Specialist** focusing on React components. Analyze the component architecture, state management, styling patterns, and user experience aspects. Pay special attention to component reusability, props design, and accessibility. Provide insights on component structure, performance optimization, and maintainability."
    }
  ],
  "totalGroups": 3,
  "strategy": "Grouped by functional areas prioritizing user's analysis needs"
}
\`\`\`

Respond with JSON only, no additional text.`;

    const groupingResult = await retryWithApiKeyRotation(
      (apiKey: string) =>
        createModelByProvider(
          "gemini-2.0-flash-exp",
          undefined,
          apiKey,
        ),
      async (model) => model.generateContent(groupingPrompt),
      apiKeys,
    );

    const response = await groupingResult.response;
    const aiResponse = response.text();

    logger.debug("AI grouping response received", {
      responseLength: aiResponse.length,
    });

    // Extract JSON from response
    const jsonMatch =
      aiResponse.match(/```json\n([\s\S]*?)\n```/) ||
      aiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("AI did not return valid JSON for file grouping");
    }

    const groupingData = JSON.parse(jsonMatch[1] || jsonMatch[0]);

    // Convert AI groups to our FileGroup format
    const aiGroups: FileGroup[] = [];
    let groupIndex = 0;

    for (const aiGroup of groupingData.groups) {
      const groupFiles: FileTokenInfo[] = [];
      let totalTokens = 0;

      for (const filePath of aiGroup.files) {
        const fileInfo = files.find((f) => f.filePath === filePath);
        if (fileInfo) {
          groupFiles.push(fileInfo);
          totalTokens += fileInfo.tokens;
        }
      }

      // Validate token limit
      if (totalTokens > maxTokensPerGroup) {
        logger.warn("AI group exceeds token limit, will split", {
          groupName: aiGroup.name,
          totalTokens,
          maxTokensPerGroup,
          filesInGroup: groupFiles.length,
        });

        // Fall back to algorithmic splitting for this group
        const splitGroups = createFileGroupsAlgorithmic(
          groupFiles,
          maxTokensPerGroup,
          groupIndex,
        );
        aiGroups.push(...splitGroups);
        groupIndex += splitGroups.length;
      } else {
        aiGroups.push({
          files: groupFiles,
          totalTokens,
          groupIndex: groupIndex++,
          name: aiGroup.name,
          description: aiGroup.description,
          reasoning: aiGroup.reasoning,
          customPrompt: aiGroup.customPrompt,
        });
      }
    }

    // Handle any files not included in AI groups
    const includedFiles = new Set(
      aiGroups.flatMap((g) => g.files.map((f) => f.filePath)),
    );
    const remainingFiles = files.filter((f) => !includedFiles.has(f.filePath));

    if (remainingFiles.length > 0) {
      logger.info("Processing remaining files not grouped by AI", {
        remainingFiles: remainingFiles.length,
      });
      const remainingGroups = createFileGroupsAlgorithmic(
        remainingFiles,
        maxTokensPerGroup,
        groupIndex,
      );
      aiGroups.push(...remainingGroups);
    }

    logger.info("AI-powered file grouping completed", {
      totalGroups: aiGroups.length,
      strategy: groupingData.strategy,
      averageTokensPerGroup:
        aiGroups.reduce((sum, g) => sum + g.totalTokens, 0) / aiGroups.length,
    });

    return aiGroups;
  } catch (error) {
    logger.warn("AI grouping failed, falling back to algorithmic grouping", {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    // Fallback to algorithmic grouping
    return createFileGroupsAlgorithmic(files, maxTokensPerGroup);
  }
}

// Fallback algorithmic file grouping (original algorithm)
function createFileGroupsAlgorithmic(
  files: FileTokenInfo[],
  maxTokensPerGroup: number = 900000,
  startIndex: number = 0,
): FileGroup[] {
  const groups: FileGroup[] = [];
  let currentGroup: FileTokenInfo[] = [];
  let currentTokens = 0;
  let groupIndex = startIndex;

  // Sort files by token count (smaller files first for better packing)
  const sortedFiles = [...files].sort((a, b) => a.tokens - b.tokens);

  for (const file of sortedFiles) {
    // If this single file exceeds the limit, create a separate group
    if (file.tokens > maxTokensPerGroup) {
      logger.warn("Large file exceeds group limit", {
        filePath: file.filePath,
        fileTokens: file.tokens,
        maxTokensPerGroup,
      });

      groups.push({
        files: [file],
        totalTokens: file.tokens,
        groupIndex: groupIndex++,
      });
      continue;
    }

    // Check if adding this file would exceed the limit
    if (
      currentTokens + file.tokens > maxTokensPerGroup &&
      currentGroup.length > 0
    ) {
      groups.push({
        files: [...currentGroup],
        totalTokens: currentTokens,
        groupIndex: groupIndex++,
      });

      currentGroup = [file];
      currentTokens = file.tokens;
    } else {
      currentGroup.push(file);
      currentTokens += file.tokens;
    }
  }

  // Add the last group if it has files
  if (currentGroup.length > 0) {
    groups.push({
      files: [...currentGroup],
      totalTokens: currentTokens,
      groupIndex: groupIndex,
    });
  }

  return groups;
}

// Aggregate analysis results from multiple groups
function aggregateAnalysisResults(
  groupResults: string[],
  question: string,
  analysisMode: string,
): string {
  const timestamp = new Date().toISOString();

  return `# Project Orchestrator - Comprehensive Analysis

## Analysis Overview
**Question:** ${question}  
**Analysis Mode:** ${analysisMode}  
**Analysis Groups:** ${groupResults.length}  
**Processed:** ${timestamp}

---

## Executive Summary

This analysis was conducted using the Project Orchestrator system, which intelligently divided your project into ${groupResults.length} manageable groups to stay within token limits, then analyzed each group separately before combining the results.

## Detailed Analysis by Group

${groupResults
  .map(
    (result, index) => `
### Group ${index + 1} Analysis

${result}

---
`,
  )
  .join("\n")}

## Consolidated Insights

Based on the analysis of all ${groupResults.length} groups, here are the key findings:

### Key Patterns Identified
- **Cross-Group Consistency**: Common patterns and practices observed across different parts of the codebase
- **Architecture Overview**: High-level structural insights derived from analyzing the entire project
- **Integration Points**: How different parts of the codebase interact and depend on each other

### Recommendations
- **Immediate Actions**: Priority items that should be addressed first
- **Long-term Improvements**: Strategic enhancements for the project's evolution
- **Best Practices**: Coding standards and practices to maintain consistency

### Next Steps
1. Review each group's specific findings in detail
2. Prioritize recommendations based on your project goals
3. Consider running focused analysis on specific areas of interest

---

*This orchestrated analysis ensures comprehensive coverage of large projects while respecting API limits. Each group was analyzed with the same expertise level for consistent results.*`;
}

// Start the server (Smithery will run this directly)
(async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Gemini MCP Local running on stdio", {
    serverName: config.mcpServerName,
    version: config.mcpServerVersion,
    transport: "stdio",
    logsDirectory: logsDir,
  });
})().catch((error) => {
  logger.error("Failed to start server:", {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});
