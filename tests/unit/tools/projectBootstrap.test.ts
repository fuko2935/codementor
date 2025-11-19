
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { promises as fs } from "fs";
import path from "path";
import { projectBootstrapLogic } from "../../../src/mcp-server/tools/projectBootstrap/logic.js";
import { requestContextService } from "../../../src/utils/index.js";

const TEST_ROOT = path.join(process.cwd(), ".test-temp-bootstrap");

describe("project_bootstrap tool", () => {
    let context: ReturnType<typeof requestContextService.createRequestContext>;

    beforeEach(async () => {
        await fs.mkdir(TEST_ROOT, { recursive: true });
        context = requestContextService.createRequestContext({
            operation: "projectBootstrapTest",
        });
    });

    afterEach(async () => {
        await fs.rm(TEST_ROOT, { recursive: true, force: true });
    });

    it("should generate AGENTS.md for cursor client with correct content", async () => {
        const params = {
            client: "cursor" as const,
            projectPath: TEST_ROOT,
            force: false,
            projectRules: undefined,
        };

        const result = await projectBootstrapLogic(params, context);

        expect(result.success).toBe(true);
        expect(result.actions).toBeDefined();

        // Check if AGENTS.md was created
        const agentsPath = path.join(TEST_ROOT, "AGENTS.md");
        const fileExists = await fs.stat(agentsPath).then(() => true).catch(() => false);
        expect(fileExists).toBe(true);

        // Check content
        const content = await fs.readFile(agentsPath, "utf-8");

        // 1. Check length
        expect(content.length).toBeGreaterThan(500);

        // 2. Check placeholder replacement
        expect(content).not.toContain("{{rules}}");
        expect(content).not.toContain("{{PROJECT_RULES_YAML}}");

        // 3. Check default rules injection
        expect(content).toContain("openSourceStatus: proprietary");

        // 4. Check markers
        expect(content).toContain("<!-- MCP:CODEMENTOR:START -->");
        expect(content).toContain("<!-- MCP:CODEMENTOR:END -->");
    });

    it("should replace legacy markers with new markers", async () => {
        const agentsPath = path.join(TEST_ROOT, "AGENTS.md");
        const legacyContent = `
# Old Config
<!-- MCP:GEMINI-MCP-LOCAL:START -->
Old content
<!-- MCP:GEMINI-MCP-LOCAL:END -->
`;
        await fs.writeFile(agentsPath, legacyContent, "utf-8");

        const params = {
            client: "cursor" as const,
            projectPath: TEST_ROOT,
            force: true, // Force update to ensure replacement happens even if hash matches (unlikely here but safe)
            projectRules: undefined,
        };

        const result = await projectBootstrapLogic(params, context);
        expect(result.success).toBe(true);

        const content = await fs.readFile(agentsPath, "utf-8");

        // Should NOT contain legacy markers anymore
        expect(content).not.toContain("<!-- MCP:GEMINI-MCP-LOCAL:START -->");

        // Should contain new markers
        expect(content).toContain("<!-- MCP:CODEMENTOR:START -->");

        // Should contain new content
        expect(content).toContain("CodeMentor AI - Çalışma Protokolü (v5)");
    });
});
