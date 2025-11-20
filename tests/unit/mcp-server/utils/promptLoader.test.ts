import { describe, it, expect } from "@jest/globals";
import path from "path";
import { PromptLoader } from "../../../../src/mcp-server/utils/promptLoader.js";
import { BaseErrorCode } from "../../../../src/types-global/errors.js";

describe("PromptLoader", () => {
  it("replaces placeholders with provided template data", async () => {
    const loader = PromptLoader.getInstance();
    const prompt = await loader.getPrompt("general", undefined, {
      USER_QUESTION: "What is the question?",
      PROJECT_CONTEXT: "Project context goes here.",
    });

    expect(prompt).toContain("What is the question?");
    expect(prompt).toContain("Project context goes here.");
  });

  it("throws when custom prompt is missing", async () => {
    const loader = PromptLoader.getInstance();
    await expect(
      loader.getPrompt(
        "custom:missing-mode",
        path.join("/tmp", "non-existent-project"),
        {
          USER_QUESTION: "",
          PROJECT_CONTEXT: "",
        },
      ),
    ).rejects.toMatchObject({ code: BaseErrorCode.NOT_FOUND });
  });
});
