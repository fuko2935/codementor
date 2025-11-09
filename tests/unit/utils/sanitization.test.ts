import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitization,
  sanitizeInputForLogging,
} from "../../../src/utils/security/sanitization.js";

test("sanitizeForLogging redacts keys from MCP_REDACT_KEYS when provided", () => {
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

  assert.equal(
    result.extra_secret,
    "[REDACTED]",
    "fields matching MCP_REDACT_KEYS entries must be redacted",
  );
  assert.equal(
    result.nested.Extra_Secret_Field,
    "[REDACTED]",
    "nested fields whose key contains MCP_REDACT_KEYS entries (case-insensitive) must be redacted",
  );

  // Orijinal obje değişmemeli
  assert.equal(
    input.extra_secret,
    "should-be-redacted",
    "original object must not be mutated",
  );
  assert.equal(
    input.nested.Extra_Secret_Field,
    "also-redacted",
    "original nested field must not be mutated",
  );

  // Cleanup
  if (originalEnv === undefined) {
    delete process.env.MCP_REDACT_KEYS;
  } else {
    process.env.MCP_REDACT_KEYS = originalEnv;
  }
});

test("sanitizeForLogging redacts core sensitive fields without regression", () => {
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
  assert.notStrictEqual(
    result,
    input,
    "sanitizeForLogging should deep-clone input, not mutate original",
  );

  // Temel alanlar
  assert.equal(
    result.password,
    "[REDACTED]",
    "password field must be redacted",
  );
  assert.equal(result.token, "[REDACTED]", "token field must be redacted");
  assert.equal(result.secret, "[REDACTED]", "secret field must be redacted");
  assert.equal(result.apiKey, "[REDACTED]", "apiKey field must be redacted");
  assert.equal(result.key, "[REDACTED]", "key field must be redacted");

  // Substring bazlı eşleşme (secretToken, dbPassword vb.)
  assert.equal(
    result.nested.secretToken,
    "[REDACTED]",
    "fields containing 'token' should be redacted",
  );
  assert.equal(
    result.nested.dbPassword,
    "[REDACTED]",
    "fields containing 'password' should be redacted",
  );

  // Orijinal input korunur
  assert.equal(input.password, "my-password");
  assert.equal(input.token, "plain-token");
  assert.equal(input.secret, "top-secret");
  assert.equal(input.apiKey, "AKIA-OLD");
  assert.equal(input.key, "some-key");
  assert.equal(input.nested.secretToken, "nested-token");
  assert.equal(input.nested.dbPassword, "db-pass");
});

test("sanitizeForLogging redacts newly added sensitive fields including nested and case-insensitive variants", () => {
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
  assert.equal(
    result.access_key,
    "[REDACTED]",
    "access_key should be redacted",
  );
  assert.equal(
    result.secret_key,
    "[REDACTED]",
    "secret_key should be redacted",
  );
  assert.equal(
    result.api_token,
    "[REDACTED]",
    "api_token should be redacted",
  );
  assert.equal(
    result.authorization,
    "[REDACTED]",
    "authorization should be redacted",
  );
  assert.equal(result.jwt, "[REDACTED]", "jwt should be redacted");

  // Case-insensitive + substring bazlı anahtar isimleri
  assert.equal(result.Access_Key, "[REDACTED]");
  assert.equal(
    result["SECRET-KEY"],
    "[REDACTED]",
    "SECRET-KEY should be redacted via substring match",
  );
  assert.equal(result.Api_Token, "[REDACTED]");

  // Nested header & jwt
  assert.equal(
    result.headers.Authorization,
    "[REDACTED]",
    "nested Authorization header should be redacted",
  );
  assert.equal(
    result.headers["x-api-token"],
    "[REDACTED]",
    "nested x-api-token should be redacted",
  );
  assert.equal(
    result.nested.jwt,
    "[REDACTED]",
    "nested jwt field should be redacted",
  );
  assert.equal(
    result.nested.inner.AUTHORIZATION,
    "[REDACTED]",
    "deep nested AUTHORIZATION should be redacted",
  );

  // Orijinal input değişmemeli
  assert.equal(input.access_key, "AKIA123456");
  assert.equal(input.secret_key, "super-secret");
  assert.equal(input.api_token, "token-abc");
  assert.equal(input.authorization, "Bearer top-secret");
  assert.equal(
    input.jwt,
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  );
  assert.equal(input.Access_Key, "upper-1");
  assert.equal(input["SECRET-KEY"], "dash-secret");
  assert.equal(input.Api_Token, "mixed-1");
  assert.equal(input.headers.Authorization, "Bearer nested-header");
  assert.equal(input.headers["x-api-token"], "nested-api-token");
  assert.equal(input.nested.jwt, "nested-jwt");
  assert.equal(input.nested.inner.AUTHORIZATION, "Bearer deep-nested");
});

test("sanitizeForLogging does not alter non-sensitive keys and does not introduce XSS", () => {
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
  assert.equal(
    result.message,
    payloads[0],
    "non-sensitive field values must be preserved",
  );
  assert.equal(result.description, payloads[1]);
  assert.equal(result.link, payloads[2]);
  assert.equal(result.htmlSnippet, payloads[3]);

  // sanitizeForLogging sadece değerleri [REDACTED] yapar; yeni script/event handler eklememeli.
  const serialized = JSON.stringify(result);
  assert.equal(
    serialized.includes("<script>"),
    true,
    "existing encoded payloads should stay encoded and not be decoded",
  );
  assert.equal(
    serialized.includes("<img src=x onerror=alert(1)>"),
    true,
  );
  assert.equal(
    serialized.includes("<a href=\"javascript:alert(1)\">link</a>"),
    true,
  );
  assert.equal(
    serialized.includes("<div onclick=\"alert(1)\">click</div>"),
    true,
  );
  assert.equal(
    serialized.includes("<script"),
    true,
    "must not introduce raw <script tags or unescaped HTML",
  );
});

test("sanitizeHtml strips dangerous tags, event handlers, and javascript: URLs according to configured defaults", () => {
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
  // - script tag yok, event handler yok, javascript: URL yok.
  assert.equal(
    sanitized.includes("<script>alert"),
    true,
    "encoded script tag should remain encoded and not become executable script",
  );
  assert.equal(
    sanitized.includes("onerror="),
    false,
    "onerror event handler should be removed",
  );
  assert.equal(
    sanitized.toLowerCase().includes("javascript:alert(1)"),
    false,
    "javascript: links should not be allowed as-is",
  );
  assert.equal(
    sanitized.includes("onclick="),
    false,
    "onclick inline event handler should be stripped",
  );
});

test("sanitizeString with context html neutralizes dangerous constructs", () => {
  const html =
    '<div onclick="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">link</a></div>';

  const sanitized = sanitization.sanitizeString(html, { context: "html" });

  assert.equal(
    sanitized.includes("onclick="),
    false,
    "onclick attribute must be removed in html context",
  );
  assert.equal(
    sanitized.toLowerCase().includes("javascript:alert(3)"),
    false,
    "javascript: URLs must be stripped or sanitized in html context",
  );
  assert.equal(
    sanitized.includes("<script>"),
    true,
    "encoded script tags should not become executable",
  );
});