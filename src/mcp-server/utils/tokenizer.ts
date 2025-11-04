import { createRequire } from "module";
const require = createRequire(import.meta.url);

type EncodedTokens = number[] | { ids?: number[]; length?: number };

export function countTokensLocally(
  text: string,
  model: string = "gemini-2.0-flash",
): number {
  try {
    // Attempt to use Google's official tokenizer if available as a subpath export
    const { getTokenizerForModel }: {
      getTokenizerForModel: (m: string) => {
        encode?: (t: string) => number[];
        tokenize?: (t: string) => EncodedTokens;
      };
    } = require("@google/generative-ai/tokenizer");
    const tokenizer = getTokenizerForModel(model);
    const tokens: EncodedTokens = tokenizer.encode
      ? tokenizer.encode(text)
      : tokenizer.tokenize
        ? tokenizer.tokenize(text)
        : [];
    if (Array.isArray(tokens)) return tokens.length;
    if (tokens && Array.isArray((tokens as { ids?: number[] }).ids))
      return (tokens as { ids: number[] }).ids.length;
    if (typeof (tokens as { length?: number }).length === "number")
      return (tokens as { length: number }).length;
  } catch {
    // Fallback to tiktoken if Gemini tokenizer is not available
    try {
      const { encodingForModel } = require("tiktoken");
      const encoding = encodingForModel("gpt-4o");
      return encoding.encode(text).length;
    } catch {
      // Final fallback: heuristic method if both tokenizers fail
      const basicEstimate = Math.ceil(text.length / 4);
      const newlineCount = (text.match(/\n/g) || []).length;
      const specialCharsCount = (
        text.match(/[{}[\]();,.<>/\\=+\-*&|!@#$%^`~]/g) || []
      ).length;
      return (
        basicEstimate +
        Math.ceil(newlineCount * 0.5) +
        Math.ceil(specialCharsCount * 0.2)
      );
    }
  }
  return 0;
}
