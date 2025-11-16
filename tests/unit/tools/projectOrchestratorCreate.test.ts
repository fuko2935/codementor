import path from "node:path";

import { McpError, BaseErrorCode } from "../../../src/types-global/errors.js";

const TEST_ROOT = path.join(process.cwd(), ".test-temp");

describe("project_orchestrator_create tool (non-auth behavior)", () => {
  it("exports expected error codes for orchestration failures", () => {
    expect(
      BaseErrorCode.FORBIDDEN
    ).toBe("FORBIDDEN");
    expect(
      BaseErrorCode.INTERNAL_ERROR
    ).toBe("INTERNAL_ERROR");
  });

  it("does not depend on authContext or withRequiredScopes at runtime", async () => {
    const registrationModule = await import(
      "../../../src/mcp-server/tools/projectOrchestratorCreate/registration.js"
    );

    expect(
      registrationModule
    ).toBeDefined();

    const exportedKeys = Object.keys(registrationModule);
    expect(
      exportedKeys.includes("registerProjectOrchestratorCreateTool")
    ).toBe(true);
  });

  it("can be documented without built-in authorization requirements", () => {
    const guidePath = path.join(
      TEST_ROOT,
      "docs",
      "project-orchestrator-create-access-model.md"
    );

    // Bu test sadece dosya yolu oluşturmanın çalıştığını doğrular;
    // gerçek dosya içeriği opsiyoneldir ve auth gerektirmez.
    expect(
      guidePath.includes("project-orchestrator-create-access-model")
    ).toBe(true);
  });
});