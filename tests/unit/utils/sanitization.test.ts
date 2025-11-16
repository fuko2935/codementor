import { describe, it, beforeEach, afterEach } from "@jest/globals";
import {
  sanitization,
  sanitizeInputForLogging,
} from "../../../src/utils/security/sanitization.js";

describe("sanitizeInputForLogging", () => {
  it("redacts keys from MCP_REDACT_KEYS when provided", () => {
  const originalEnv = process.env.MCP_REDACT_KEYS;
  process.env.MCP_REDACT_KEYS = "extra_secret";

  const input = {
    username: "user1",
    extra_secret: "should-be-redacted",
    nested: {
      Extra_Secret_Field: "also-redacted",
    },
  };

  const result = sanitizeInputForLogging(input) as any;

  expect(result.extra_secret).toBe("[REDACTED]");
  expect(result.nested.Extra_Secret_Field).toBe("[REDACTED]");

  // Orijinal obje değişmemeli
  expect(input.extra_secret).toBe("should-be-redacted");
  expect(input.nested.Extra_Secret_Field).toBe("also-redacted");

  // Cleanup
  if (originalEnv === undefined) {
    delete process.env.MCP_REDACT_KEYS;
  } else {
    process.env.MCP_REDACT_KEYS = originalEnv;
  }
});

  it("redacts core sensitive fields without regression", () => {
  const input = {
    username: "user1",
    password: "my-password",
    token: "plain-token",
    secret: "top-secret",
    apiKey: "AKIA-OLD",
    key: "some-key",
    nested: {
      secretToken: "nested-token",
      dbPassword: "db-pass",
    },
  };

  const result = sanitizeInputForLogging(input) as any;

  // Orijinal obje mutasyona uğramamalı (structuredClone/JSON clone sonrası referans farkı)
  expect(result).not.toBe(input);

  // Temel alanlar
  expect(result.password).toBe("[REDACTED]");
  expect(result.token).toBe("[REDACTED]");
  expect(result.secret).toBe("[REDACTED]");
  expect(result.apiKey).toBe("[REDACTED]");
  expect(result.key).toBe("[REDACTED]");

  // Substring bazlı eşleşme (secretToken, dbPassword vb.)
  expect(result.nested.secretToken).toBe("[REDACTED]");
  expect(result.nested.dbPassword).toBe("[REDACTED]");

  // Orijinal input korunur
  expect(input.password).toBe("my-password");
  expect(input.token).toBe("plain-token");
  expect(input.secret).toBe("top-secret");
  expect(input.apiKey).toBe("AKIA-OLD");
  expect(input.key).toBe("some-key");
  expect(input.nested.secretToken).toBe("nested-token");
  expect(input.nested.dbPassword).toBe("db-pass");
});

  it("redacts newly added sensitive fields including nested and case-insensitive variants", () => {
  const input = {
    access_key: "AKIA123456",
    secret_key: "super-secret",
    api_token: "token-abc",
    authorization: "Bearer top-secret",
    jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    // Case & format variants (substring + case-insensitive)
    Access_Key: "upper-1",
    "SECRET-KEY": "dash-secret",
    Api_Token: "mixed-1",
    headers: {
      Authorization: "Bearer nested-header",
      "x-api-token": "nested-api-token",
    },
    nested: {
      jwt: "nested-jwt",
      inner: {
        AUTHORIZATION: "Bearer deep-nested",
      },
    },
  };

  const result = sanitizeInputForLogging(input) as any;

  // Doğrudan alanlar
  expect(result.access_key).toBe("[REDACTED]");
  expect(result.secret_key).toBe("[REDACTED]");
  expect(result.api_token).toBe("[REDACTED]");
  expect(result.authorization).toBe("[REDACTED]");
  expect(result.jwt).toBe("[REDACTED]");

  // Case-insensitive + substring bazlı anahtar isimleri
  expect(result.Access_Key).toBe("[REDACTED]");
  expect(result["SECRET-KEY"]).toBe("[REDACTED]");
  expect(result.Api_Token).toBe("[REDACTED]");

  // Nested header & jwt
  expect(result.headers.Authorization).toBe("[REDACTED]");
  expect(result.headers["x-api-token"]).toBe("[REDACTED]");
  expect(result.nested.jwt).toBe("[REDACTED]");
  expect(result.nested.inner.AUTHORIZATION).toBe("[REDACTED]");

  // Orijinal input değişmemeli
  expect(input.access_key).toBe("AKIA123456");
  expect(input.secret_key).toBe("super-secret");
  expect(input.api_token).toBe("token-abc");
  expect(input.authorization).toBe("Bearer top-secret");
  expect(input.jwt).toBe("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...");
  expect(input.Access_Key).toBe("upper-1");
  expect(input["SECRET-KEY"]).toBe("dash-secret");
  expect(input.Api_Token).toBe("mixed-1");
  expect(input.headers.Authorization).toBe("Bearer nested-header");
  expect(input.headers["x-api-token"]).toBe("nested-api-token");
  expect(input.nested.jwt).toBe("nested-jwt");
  expect(input.nested.inner.AUTHORIZATION).toBe("Bearer deep-nested");
});

  it("does not alter non-sensitive keys and does not introduce XSS", () => {
  const payloads = [
    '<script>alert("x")</script>',
    '<img src=x onerror=alert(1)>',
    '<a href="javascript:alert(1)">link</a>',
    '<div onclick="alert(1)">click</div>',
  ];

  const input = {
    message: payloads[0],
    description: payloads[1],
    link: payloads[2],
    htmlSnippet: payloads[3],
  };

  const result = sanitizeInputForLogging(input) as any;

  // Hassas alan listesi sadece key adına göre çalışır; bu alanlar değişmemeli.
  expect(result.message).toBe(payloads[0]);
  expect(result.description).toBe(payloads[1]);
  expect(result.link).toBe(payloads[2]);
  expect(result.htmlSnippet).toBe(payloads[3]);

  // sanitizeForLogging sadece değerleri [REDACTED] yapar; yeni script/event handler eklememeli.
  const serialized = JSON.stringify(result);
  expect(serialized.includes("<script>")).toBe(true);
  expect(serialized.includes("<img src=x onerror=alert(1)>")).toBe(true);
  expect(serialized.includes("<a href=\"javascript:alert(1)\">link</a>")).toBe(true);
  expect(serialized.includes("<div onclick=\"alert(1)\">click</div>")).toBe(true);
  expect(serialized.includes("<script")).toBe(true);
});

describe("sanitization", () => {
  it("sanitizeHtml strips dangerous tags, event handlers, and javascript: URLs according to configured defaults", () => {
  const html = [
    '<script>alert("x")</script>',
    '<img src=x onerror=alert(1)>',
    '<a href="javascript:alert(1)">link</a>',
    '<div onclick="alert(1)">click</div>',
  ].join("");

  const sanitized = sanitization.sanitizeHtml(html);

  // sanitize-html + default config:
  // - allowedTags: h1-h6, p, a, ul, ol, li, b, i, strong, em, strike, code,
  //   hr, br, div, table, thead, tbody, tr, th, td, pre
  // - allowedAttributes: a[href,name,target], img[src,alt,title,width,height], *[class,id,style]
  // - script tag removed, event handler removed, javascript: URL removed.
  expect(sanitized.includes("<script>alert")).toBe(false);
  expect(sanitized.includes("onerror=")).toBe(false);
  expect(sanitized.toLowerCase().includes("javascript:alert(1)")).toBe(false);
  expect(sanitized.includes("onclick=")).toBe(false);
});

  it("sanitizeString with context html neutralizes dangerous constructs", () => {
  const html =
    '<div onclick="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">link</a></div>';

  const sanitized = sanitization.sanitizeString(html, { context: "html" });

  expect(sanitized.includes("onclick=")).toBe(false);
  expect(sanitized.toLowerCase().includes("javascript:alert(3)")).toBe(false);
  expect(sanitized.includes("<script>")).toBe(false);
});
});
});