
import { createModelByProvider } from "../src/services/llm-providers/modelFactory.js";
import { config } from "../src/config/index.js";

async function main() {
    console.log("Testing Proxy Provider...");

    // Force the provider to be 'proxy' for this test
    // We can't easily mutate config, so we'll rely on the fact that we can pass 'proxy' via env or just assume the user sets it.
    // Actually, createModelByProvider reads config.llmDefaultProvider.
    // Let's try to instantiate the ProxyModel directly via createModelByProvider by mocking config if possible,
    // or just by setting the env var before running this script.

    // However, we can't easily set env vars for the imported module here without reloading it.
    // But wait, createModelByProvider checks config.llmDefaultProvider.

    // Let's just use the factory and assume the user will run this with LLM_DEFAULT_PROVIDER=proxy

    try {
        // We can also manually instantiate it if we want to test just the class, 
        // but testing the factory integration is better.

        // Hack: we can't easily change the config object at runtime since it's a const export.
        // But we can check if we can pass the provider to the factory? No, it reads from config.

        // So we will instruct the user (or myself) to run this with the env var.

        console.log(`Current configured provider: ${config.llmDefaultProvider}`);

        if (config.llmDefaultProvider !== 'proxy') {
            console.warn("WARNING: LLM_DEFAULT_PROVIDER is not set to 'proxy'. Test might fail or use wrong provider.");
        }

        const model = createModelByProvider("gemini-3-pro-preview");

        console.log("Model created. Sending request...");

        const result = await model.generateContent("Hello, are you working?");
        const response = await result.response;
        const text = response.text();

        console.log("Response received:");
        console.log(text);

    } catch (error) {
        console.error("Test failed:", error);
    }
}

main();
