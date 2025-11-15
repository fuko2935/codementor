# codementor - Directory Structure

Generated on: 2025-11-04 00:56:14

```
codementor
├── .github
│   ├── workflows
│   │   └── publish.yml
│   └── FUNDING.yml
├── .kiro
│   ├── specs
│   │   ├── mcp-logger-initialization-fix
│   │   │   ├── design.md
│   │   │   ├── requirements.md
│   │   │   └── tasks.md
│   │   └── mcp-tool-display-fix
│   │       └── requirements.md
│   └── steering
│       ├── language.md
│       ├── product.md
│       ├── structure.md
│       └── tech.md
├── docs
│   ├── api-references
│   │   ├── jsdoc-standard-tags.md
│   │   └── typedoc-reference.md
│   ├── best-practices.md
│   └── tree.md
├── scripts
│   ├── clean.ts
│   ├── fetch-openapi-spec.ts
│   ├── make-executable.ts
│   ├── README.md
│   └── tree.ts
├── src
│   ├── config
│   │   └── index.ts
│   ├── mcp-client
│   │   ├── client-config
│   │   │   ├── configLoader.ts
│   │   │   ├── mcp-config.json.example
│   │   │   └── README.md
│   │   ├── core
│   │   │   ├── clientConnectionLogic.ts
│   │   │   └── clientManager.ts
│   │   ├── transports
│   │   │   ├── httpClientTransport.ts
│   │   │   ├── index.ts
│   │   │   ├── stdioClientTransport.ts
│   │   │   └── transportFactory.ts
│   │   ├── AGENTS.md
│   │   ├── index.ts
│   │   └── README.md
│   ├── mcp-server
│   │   ├── resource-blueprints
│   │   │   └── echoResource
│   │   │       ├── echoResourceLogic.ts
│   │   │       ├── index.ts
│   │   │       └── registration.ts
│   │   ├── resources
│   │   ├── tool-blueprints
│   │   │   ├── catFactFetcher
│   │   │   │   ├── index.ts
│   │   │   │   ├── logic.ts
│   │   │   │   └── registration.ts
│   │   │   ├── echoTool
│   │   │   │   ├── index.ts
│   │   │   │   ├── logic.ts
│   │   │   │   └── registration.ts
│   │   │   └── imageTest
│   │   │       ├── index.ts
│   │   │       ├── logic.ts
│   │   │       └── registration.ts
│   │   ├── tools
│   │   │   ├── calculateTokenCount
│   │   │   │   ├── index.ts
│   │   │   │   ├── logic.ts
│   │   │   │   └── registration.ts
│   │   │   ├── dynamicExpertAnalyze
│   │   │   │   ├── index.ts
│   │   │   │   ├── logic.ts
│   │   │   │   └── registration.ts
│   │   │   ├── dynamicExpertCreate
│   │   │   │   ├── index.ts
│   │   │   │   ├── logic.ts
│   │   │   │   └── registration.ts
│   │   │   ├── geminiCodebaseAnalyzer
│   │   │   │   ├── index.ts
│   │   │   │   ├── logic.ts
│   │   │   │   └── registration.ts
│   │   │   ├── projectOrchestratorAnalyze
│   │   │   │   ├── index.ts
│   │   │   │   ├── logic.ts
│   │   │   │   └── registration.ts
│   │   │   └── projectOrchestratorCreate
│   │   │       ├── index.ts
│   │   │       ├── logic.ts
│   │   │       └── registration.ts
│   │   ├── transports
│   │   │   ├── auth
│   │   │   │   ├── core
│   │   │   │   │   ├── authContext.ts
│   │   │   │   │   ├── authTypes.ts
│   │   │   │   │   └── authUtils.ts
│   │   │   │   ├── strategies
│   │   │   │   │   ├── jwt
│   │   │   │   │   │   └── jwtMiddleware.ts
│   │   │   │   │   └── oauth
│   │   │   │   │       └── oauthMiddleware.ts
│   │   │   │   └── index.ts
│   │   │   ├── httpErrorHandler.ts
│   │   │   ├── httpTransport.ts
│   │   │   └── stdioTransport.ts
│   │   ├── utils
│   │   │   └── tokenizer.ts
│   │   ├── AGENTS.md
│   │   ├── prompts.ts
│   │   ├── README.md
│   │   └── server.ts
│   ├── services
│   │   └── llm-providers
│   │       ├── geminiCliProvider.ts
│   │       └── openRouterProvider.ts
│   ├── types-global
│   │   └── errors.ts
│   ├── utils
│   │   ├── internal
│   │   │   ├── errorHandler.ts
│   │   │   ├── index.ts
│   │   │   ├── logger.ts
│   │   │   └── requestContext.ts
│   │   ├── metrics
│   │   │   ├── index.ts
│   │   │   └── tokenCounter.ts
│   │   ├── network
│   │   │   ├── fetchWithTimeout.ts
│   │   │   └── index.ts
│   │   ├── parsing
│   │   │   ├── dateParser.ts
│   │   │   ├── index.ts
│   │   │   └── jsonParser.ts
│   │   ├── scheduling
│   │   ├── security
│   │   │   ├── idGenerator.ts
│   │   │   ├── index.ts
│   │   │   ├── rateLimiter.ts
│   │   │   └── sanitization.ts
│   │   ├── AGENTS.md
│   │   └── index.ts
│   ├── validation
│   │   ├── integrationTest.ts
│   │   ├── README.md
│   │   └── startupValidation.ts
│   ├── index.ts
│   └── README.md
├── .dockerignore
├── .env.example
├── .gitignore
├── .ncurc.json
├── AGENTS.md
├── CHANGELOG.md
├── claude_desktop_config.example.json
├── CLAUDE.md
├── cursor_mcp_config.json
├── CURSOR_SETUP.md
├── eslint.config.js
├── LICENSE
├── mcp.json
├── package-lock.json
├── package.json
├── PUBLISH.md
├── README.md
├── repomix.config.json
├── SETUP.md
├── tsconfig.json
├── tsconfig.typedoc.json
├── tsdoc.json
└── typedoc.json
```

_Note: This tree excludes files and directories matched by .gitignore and default patterns._
