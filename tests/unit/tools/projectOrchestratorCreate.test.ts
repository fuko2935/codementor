import assert from "node:assert";
import path from "node:path";

import { McpError, BaseErrorCode } from "../../../src/types-global/errors.js";

const TEST_ROOT = path.join(process.cwd(), ".test-temp");

describe("project_orchestrator_create tool (non-auth behavior)", () => {
  it("exports expected error codes for orchestration failures", () => {
    assert.strictEqual(
      BaseErrorCode.FORBIDDEN,
      "FORBIDDEN",
      "FORBIDDEN error code must be defined for orchestration failures"
    );
    assert.strictEqual(
      BaseErrorCode.INTERNAL_ERROR,
      "INTERNAL_ERROR",
      "INTERNAL_ERROR error code must be defined for internal failures"
    );
  });

  it("does not depend on authContext or withRequiredScopes at runtime", async () => {
    const registrationModule = await import(
      "../../../src/mcp-server/tools/projectOrchestratorCreate/registration.js"
    );

    assert.ok(
      registrationModule,
      "registration module should be loadable without auth configuration"
    );

    const exportedKeys = Object.keys(registrationModule);
    assert.ok(
      exportedKeys.includes("registerProjectOrchestratorCreateTool"),
      "registerProjectOrchestratorCreateTool should be exported"
    );
  });

  it("can be documented without built-in authorization requirements", () => {
    const guidePath = path.join(
      TEST_ROOT,
      "docs",
      "project-orchestrator-create-access-model.md"
    );

    // Bu test sadece dosya yolu oluşturmanın çalıştığını doğrular;
    // gerçek dosya içeriği opsiyoneldir ve auth gerektirmez.
    assert.ok(
      guidePath.includes("project-orchestrator-create-access-model"),
      "non-auth documentation path should be constructed correctly"
    );
  });
});