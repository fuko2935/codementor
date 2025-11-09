# Güvenlik Sertleştirme Rehberi

Bu doküman, Gemini MCP Local projesini prod ortamlarında güvenli ve dayanıklı şekilde çalıştırmak için önerilen sertleştirme adımlarını içerir. Aşağıdaki pratikler HTTP/STDIO transportları, kimlik doğrulama, giriş doğrulama/sanitizasyon, kaynak sınırları ve tedarik zinciri güvenliğini kapsar.

## 1) Kimlik Doğrulama ve Yetkilendirme

- HTTP transportta auth’u zorunlu tutun:
  - `MCP_TRANSPORT_TYPE=http` kullanıyorsanız prod’da `MCP_DISABLE_AUTH` kesinlikle `false` olmalı.
  - `MCP_AUTH_MODE=oauth` tercih edin; `jwt` sadece basit/dev senaryolar içindir.
- OAuth (önerilir):
  - `OAUTH_ISSUER_URL`, `OAUTH_JWKS_URI`, `OAUTH_AUDIENCE` değerlerini doğru yapılandırın.
  - Token doğrulamada issuer ve audience kontrollerini zorunlu kılın.
- JWT (geliştirme/kapalı ağlar):
  - `MCP_AUTH_SECRET_KEY` en az 32+ karakter, yüksek entropili bir değer olmalı.
  - Anahtar rotasyonu planlayın ve eski token’lar için geçici tolerans penceresi oluşturun.
- İstek bağlamında kimlik:
  - Auth context `AsyncLocalStorage` ile talep yaşam döngüsünde taşınıyor. Bu bilgiyi yetki kontrolü, log korelasyonu ve rate-limit anahtarı olarak kullanın.
- Kaynaklar ve araçlar:
  - Yetki tabanlı erişimi (scope/role) devreye almak için handler seviyesinde kontrol katmanı eklenebilir.

İlgili dosyalar:
- src/mcp-server/transports/auth/core/[authContext.ts](src/mcp-server/transports/auth/core/authContext.ts:1)
- src/mcp-server/transports/auth/strategies/jwt/[jwtMiddleware.ts](src/mcp-server/transports/auth/strategies/jwt/jwtMiddleware.ts:1)
- src/mcp-server/transports/auth/strategies/oauth/[oauthMiddleware.ts](src/mcp-server/transports/auth/strategies/oauth/oauthMiddleware.ts:1)

## 2) Sır Yönetimi ve Ortam Değişkenleri

- API anahtarlarını asla depoya koymayın; yalnızca ortam değişkenleri ile geçirin.
- CI/CD ve runtime’da gizleri gizli değişken kasalarında saklayın (GitHub Secrets, Vault, KMS).
- `.env` dosyasını versiyon kontrolünden hariç tutun. Örnek için [.env.example](.env.example:1) dosyasını kullanın.
- Konfigürasyon Zod ile doğrulanır; hatalı/eksik env’lerde fail-fast davranışı güvenlik için doğrudur.

İlgili dosya:
- src/config/[index.ts](src/config/index.ts:1)

## 3) CORS, Ağ Yüzeyi ve HTTP Sertleştirme

- CORS kısıtlaması:
  - `MCP_ALLOWED_ORIGINS` ile yalnızca izin verilen origin’leri tanımlayın.
- Host/Port:
  - Prod’da `MCP_HTTP_HOST` için public interface yerine servis mesh/proxy arkasında özel ağ arayüzü kullanın veya reverse proxy (Nginx/Envoy) arkasına alın.
- Güvenlik başlıkları:
  - Hono middleware ile `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY` gibi başlıklar ekleyin.
  - CSP (Content-Security-Policy), SRI ve Strict-Transport-Security (HSTS) ters proxy katmanında etkinleştirin.

İlgili dosya:
- src/mcp-server/transports/[httpTransport.ts](src/mcp-server/transports/httpTransport.ts:1)

## 4) Rate Limiting ve DoS Korumaları

- Araç/endpoint bazında temel rate limit uygulayın.
- Hono rate limit middleware veya mevcut `utils/security/rateLimiter.ts` ile IP/kimlik tabanlı sınırlama yapın.
- Büyük istekler için gövde boyutu limitleri ve zaman aşımı ayarlayın.

İlgili dosya:
- src/utils/security/[rateLimiter.ts](src/utils/security/rateLimiter.ts:1)

## 5) Yol Güvenliği ve Girdi Sanitizasyonu

- Path traversal koruması:
  - Dosya sistemi erişimi öncesi daima `validateSecurePath()` kullanın.
  - `sanitization.sanitizePath()` hataları `VALIDATION_ERROR` olarak sınıflandırır; handler seviyesinde kullanıcıya güvenli mesaj yansıtın.
- Genel sanitizasyon:
  - URL, HTML, metin, sayı ve JSON için `sanitization` yardımcılarını kullanın.
- Git revizyonları:
  - `validateRevision()` kabuk meta karakterlerini engeller; `simple-git` shell kullanmadığı için risk azalır ama validasyon katmanı korunur.

İlgili dosyalar:
- src/mcp-server/utils/[securePathValidator.ts](src/mcp-server/utils/securePathValidator.ts:1)
- src/utils/security/[sanitization.ts](src/utils/security/sanitization.ts:1)
- src/mcp-server/utils/[gitDiffAnalyzer.ts](src/mcp-server/utils/gitDiffAnalyzer.ts:1)

## 6) İçerik Büyüklüğü, Diff ve Bellek Sınırları

- Git diff korumaları:
  - `MAX_GIT_BLOB_SIZE_BYTES` büyük blob’ları otomatik atlar, raporlar.
  - Diff toplam boyutu için 50MB sınırı aşılırsa `VALIDATION_ERROR`.
- Tam proje bağlamı:
  - Çok büyük depolarda orchestrator kullanın veya auto-fallback’i açın (`autoOrchestrate=true`).
- Token sınırı:
  - `MAX_PROJECT_TOKENS` üstünde fail-fast; kullanıcıyı `.gitignore`/`.mcpignore` ile temizlik yapmaya yönlendirin.

İlgili dosyalar:
- src/mcp-server/tools/geminiCodebaseAnalyzer/[logic.ts](src/mcp-server/tools/geminiCodebaseAnalyzer/logic.ts:1)
- src/mcp-server/utils/[projectSizeValidator.ts](src/mcp-server/utils/projectSizeValidator.ts:1)

## 7) Günlükler (Logs) ve Kişisel Veri

- Log PII/Secrets:
  - Log sanitizasyonu kullanın; hassas alan adlarını (password, token, secret, key, apiKey, authorization vs.) maskeler.
  - Loglarda istek bağlamı (request id, user, scope) tutulmalı; içerik ise gerekmedikçe yazılmamalı.
- Dosya logları:
  - `LOGS_DIR` proje kök sınırları içinde olmalı; yoksa devre dışı bırakılır.

İlgili dosyalar:
- src/utils/internal/[logger.ts](src/utils/internal/logger.ts:1)
- src/utils/security/[sanitization.ts](src/utils/security/sanitization.ts:1)
- src/config/[index.ts](src/config/index.ts:1)

## 8) CI/CD ve DevSecOps

- CI’larda:
  - Lint, build, unit ve integration testlerini zorunlu koşun.
  - Örnek iş akışı: [.github/workflows/ci.yml](.github/workflows/ci.yml:1)
  - Secrets (ör. `MCP_AUTH_SECRET_KEY`) yalnızca gerekli adımlarda environment’a verilmeli.
- Bağımlılık güvenliği:
  - `npm audit --production` ve periyodik güncelleme politikası.
  - `ncurc` ile kontrollü yükseltme, `CHANGELOG` güncel tutma ve semver kırıcı değişikliklerde dikkat.
- Tedarik zinciri:
  - Node ve paket versiyonlarını pinleyin (engines, lock file).
  - İmzalı commit/CI (opsiyonel) ve release imzalama.

## 9) İzleme, Gözlemlenebilirlik ve Olay Tepkisi

- Log seviyeleri (`MCP_LOG_LEVEL`) prod’da `info`/`warning` ayarında olmalı.
- Error korrelasyonu için istek-id, kullanıcı/scope bilgisi ve zaman damgası zorunlu.
- Olay tepkisi:
  - Yetkisiz erişim denemeleri (401/403), rate-limit isabetleri ve input validasyon hataları metriklenmeli ve alarmlanmalı.

## 10) Önerilen Çalıştırma Topolojisi

- Prod dağıtım:
  - MCP HTTP servisi → Reverse proxy (CSP/HSTS/Rate Limit) → Özel ağ → OAuth/JWKS
  - STDIO sadece kapalı/yerel senaryolarda (IDE/desktop).
- Ölçeklenebilir oturum:
  - Bellek içi oturumları “opsiyonel Redis store” ile değiştirin (feature flag). Sticky-session gerektiren akışlar için oturum paylaşımı.
