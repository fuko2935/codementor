# Güvenlik Sertleştirme Rehberi

Bu doküman, CodeMentor projesini prod ortamlarında güvenli ve dayanıklı şekilde çalıştırmak için önerilen sertleştirme adımlarını içerir. Aşağıdaki pratikler HTTP/STDIO transportları, kimlik doğrulama, giriş doğrulama/sanitizasyon, kaynak sınırları ve tedarik zinciri güvenliğini kapsar.

## SEC-01) Logging & Sanitization

Bu bölüm, loglarda hassas veri sızıntısını önlemek ve XSS benzeri vektörlerin log/sanitizasyon katmanları üzerinden sisteme geri sokulmamasını sağlamak için zorunlu pratikleri tanımlar.

### Hassas Alan Redaksiyonu

Log sanitizasyon katmanı, anahtar isimlerini case-insensitive ve substring bazlı olarak eşler ve ilgili değerleri `[REDACTED]` ile maskeler. Hem düz JSON gövdeleri hem de nested objeler ve header map yapıları için geçerlidir.

Varsayılan hassas alan kapsamı:

- password
- token
- secret
- key
- apiKey
- access_key
- secret_key
- api_token
- authorization
- jwt

Örnek JSON log girişi:

```json
{
  "userId": "123",
  "password": "plain-text",
  "api_token": "secret-token",
  "profile": {
    "jwt": "eyJhbGciOi",
    "note": "ok"
  }
}
```

Sanitize edilmiş log çıktısı:

```json
{
  "userId": "123",
  "password": "[REDACTED]",
  "api_token": "[REDACTED]",
  "profile": {
    "jwt": "[REDACTED]",
    "note": "ok"
  }
}
```

Headers.Authorization ve benzeri başlıklar da aynı mantıkla maskelenir:

```json
{
  "headers": {
    "authorization": "[REDACTED]",
    "x-api-key": "[REDACTED]"
  }
}
```

Notlar:

- Redaksiyon sadece key bazlıdır; değer içeriğine göre pattern eşleme yapılmaz.
- Yeni hassas alanlar eklemek için sanitizasyon yardımcılarının hassas alan listesi genişletilebilir; bu, uygulama boyunca merkezi olarak devreye girer.
- XSS benzeri payload’lar loglanırken sanitizasyon katmanı yeni bir XSS vektörü eklemez; HTML sanitize fonksiyonları script, event attributeleri ve `javascript:` URI şemalarını etkisizleştirir.

İlgili dosyalar:

- src/utils/security/[sanitization.ts](src/utils/security/sanitization.ts:1)
- tests/unit/utils/[sanitization.test.ts](tests/unit/utils/sanitization.test.ts:1)

## SEC-02) Path Security & BASE_DIR

Dosya sistemi ve depo erişimlerinde tüm path işlemleri merkezi bir taban dizin üzerinden sınırlandırılır.

### BASE_DIR Konsepti

- `BASE_DIR`, proje kökünü temsil eden merkezi referanstır.
- Tüm dosya/dizin erişimleri `BASE_DIR` altında kalacak şekilde tasarlanmalıdır.
- Bu yaklaşım, path traversal girişimlerini ve proje dışına yetkisiz erişimleri engellemek için temel güvenlik sınırını oluşturur.

### Güvenli Path Doğrulama

- `validateSecurePath` benzeri yardımcılar, verilen path’in:
  - Boş veya sadece whitespace olmadığını,
  - Null byte içermediğini,
  - Mutlak path olarak gelmediğini,
  - `..` gibi traversal denemeleriyle `BASE_DIR` dışına taşmadığını doğrular.
- Geçersiz path girişimleri güvenli hata türleri ile sonuçlanır; kullanıcıya sınırlı ve bilgi sızdırmayan mesaj döndürülmelidir.

### BASE_DIR Kullanan Bileşenler

Aşağıdaki araç ve modüller path güvenliğini sağlamak için `BASE_DIR` ve secure path doğrulama mantığını kullanır:

- src/index.ts içindeki `BASE_DIR` export’u
- src/mcp-server/utils/[securePathValidator.ts](src/mcp-server/utils/securePathValidator.ts:1)
- src/mcp-server/tools/geminiCodebaseAnalyzer/[logic.ts](src/mcp-server/tools/geminiCodebaseAnalyzer/logic.ts:1)
- src/mcp-server/tools/projectOrchestratorCreate/[logic.ts](src/mcp-server/tools/projectOrchestratorCreate/logic.ts:1)
- src/mcp-server/tools/projectOrchestratorAnalyze/[logic.ts](src/mcp-server/tools/projectOrchestratorAnalyze/logic.ts:1)

Geliştirici rehberi:

- Yeni dosya/payload path alanları eklerken:
  - Her zaman `BASE_DIR` referansını kullanın.
  - Mutlaka `validateSecurePath` benzeri güvenli doğrulama yardımcılarını entegre edin.
  - `BASE_DIR` dışına çıkmayı gerektiren bir senaryo varsa, bu açıkça belgelenmeli ve ek kontrol (allowlist vb.) ile sınırlandırılmalıdır.

İlgili dosyalar:

- src/[index.ts](src/index.ts:1)
- src/mcp-server/utils/[securePathValidator.ts](src/mcp-server/utils/securePathValidator.ts:1)
- tests/unit/mcp-server/utils/[securePathValidator.test.ts](tests/unit/mcp-server/utils/securePathValidator.test.ts:1)

## SEC-03) Dış Katman Erişim Kontrolleri (Önerilen Model)

Bu proje, yerleşik bir kimlik doğrulama veya scope tabanlı yetkilendirme mekanizması sağlamaz.
Tasarım hedefi, MCP sunucusunu yerel/güvenli ağ içinde hafif bir bileşen olarak kullanmak ve
erişim kontrollerini aşağıdaki dış katmanlara devretmektir:

- Reverse proxy (Nginx/Envoy/Traefik vb.) ile:
  - JWT/OIDC doğrulaması
  - IP allowlist / ağ segmentasyonu
  - Oran sınırlama (rate limiting) ve WAF kuralları
- mTLS ile karşılıklı sertifika doğrulaması
- VPN veya sıfır güven (zero trust) ağ çözümleri
- IDE/desktop istemcilerinin yalnızca güvenilir yerel süreçleri başlatabilmesi

Önemli notlar:

- `withRequiredScopes` yalnızca geriye dönük uyumluluk için bırakılmış no-op bir yardımcıdır;
  herhangi bir güvenlik garantisi vermez.
- Güvenlik kritik kurallar her zaman yukarıdaki harici katmanlarda uygulanmalıdır.

## SEC-04) Rate Limiting

Bu bölüm, kimlik-temelli ve IP-aware rate limiting stratejisini açıklar.

### Kimlik Temelli Anahtar Stratejisi

Rate limiter, istek bağlamından kimlik bilgilerini okuyarak adil ve güvenli bir sınırlama uygular:

- userId mevcutsa → `id:{userId}`
- clientId mevcutsa → `client:{clientId}`
- Yalnızca IP mevcutsa → `ip:{address}`
- Auth yok, IP yok veya belirsiz konteks → `anon:global`
  - Bu bucket daha sıkı limitler ile yapılandırılmalıdır.

`anon:global` modeli:

- Kimliği olmayan istemciler paylaşılan ve kısıtlı bir kovayı paylaşır.
- Böylece kimliksiz taramalar, kimliği doğrulanmış üretim trafiğini tüketemez.

### HTTP Transport Entegrasyonu

- src/mcp-server/transports/[httpTransport.ts](src/mcp-server/transports/httpTransport.ts:1) içinde:
  - authContext ve istemci IP’sinden `RequestContextLike` türetilir.
  - `RateLimiter.check("http:mcp", context)` çağrısı ile kimlik/IP-aware limit uygulanır.
- Limit aşıldığında:
  - `RATE_LIMITED` sonucu HTTP 429 Too Many Requests olarak map edilir.
  - Yanıt ve log formatı `httpErrorHandler` ile tutarlıdır.

### Konfigürasyon

Rate limiting parametreleri [.env.example](.env.example:1) içinde örneklendirilmiştir:

- `RATE_LIMIT_WINDOW_MS`: pencere süresi
- `RATE_LIMIT_MAX_REQUESTS`: pencere başına izin verilen istek sayısı

Operasyon notları:

- Üretim ortamında bu değerler yük profiline göre ayarlanmalı ve gözlemlenebilirlik metrikleri ile izlenmelidir.
- Rate limit olayları loglanırken, kimlik/anahtar bilgileri sanitizasyon katmanı tarafından redakte edilir.

İlgili dosyalar:

- src/utils/security/[rateLimiter.ts](src/utils/security/rateLimiter.ts:1)
- src/mcp-server/transports/[httpTransport.ts](src/mcp-server/transports/httpTransport.ts:1)
- tests/unit/utils/[rateLimiter.test.ts](tests/unit/utils/rateLimiter.test.ts:1)

## SEC-05) CI & Supply Chain Security

Bu bölüm, CI süreçleri ve tedarik zinciri güvenliğinin, kod kalitesi ve bağımlılık güvenliği ile birlikte nasıl işletildiğini açıklar.

### CI Pipeline Sertleştirmeleri

- [.github/workflows/ci.yml](.github/workflows/ci.yml:1):
  - Lint, build, unit ve integration testleri zorunlu.
  - Build sonrasında `npm audit --production --audit-level=high` çalıştırılır.
  - Ayrı CodeQL job’ı:
    - `github/codeql-action/init`, `autobuild`, `analyze` adımları ile statik kod analizi.
  - GitHub Actions izinleri minimal tutulmuştur.
  - Haftalık schedule ile periyodik güvenlik taramaları tetiklenir.

### Publish Pipeline

- [.github/workflows/publish.yml](.github/workflows/publish.yml:1):
  - Pre-publish aşamasında yüksek seviye odaklı `npm audit` kontrolü.
  - Sadece gerekli izinlerle minimal permission set.
  - Sadece `NPM_TOKEN` kullanımı; gereksiz secret’lar pipeline’a verilmez.

### Dependabot ve Bağımlılık Yönetimi

- [.github/dependabot.yml](.github/dependabot.yml:1):
  - `npm` ve `github-actions` ekosistemleri için günlük tarama.
  - Güvenlik yamaları ve güncellemeler için otomatik PR üretimi.

### Log Redaksiyonu ile Entegrasyon

- Dependabot, CodeQL, npm audit ve benzeri araçların ürettiği bulgular:
  - Merkezi loglama altyapısına aktarılırken sanitizasyon katmanı devrededir.
  - Gizli anahtarlar, token’lar ve hassas yapılandırma değerleri rapor/log çıktılarında `[REDACTED]` olarak maskelenir.
- Böylece:
  - Tedarik zinciri ve güvenlik uyarılarının görünürlüğü korunur.
  - Aynı zamanda operasyon loglarında ek bir veri sızıntısı yüzeyi oluşmaz.

## SEC-06) İzleme, Olay Tepkisi ve Dağıtım Topolojisi

- Log seviyeleri (`MCP_LOG_LEVEL`) prod’da `info`/`warning` aralığında tutulmalıdır.
- Error korelasyonu için:
  - İstek kimliği, kullanıcı/scope bilgisi ve zaman damgası loglarda yer almalı, içerik ise sanitize edilmiş olmalıdır.
- Olay tepkisi:
  - Yetkisiz erişim (401/403), eksik scope, INTERNAL_ERROR, rate limit isabetleri ve path/sanitizasyon validasyon hataları:
    - Metriklenmeli,
    - Alarm ve dashboard’larla izlenmelidir.
- Önerilen dağıtım:
  - MCP HTTP servisi → Reverse proxy (CSP/HSTS/ek rate limit) → Özel ağ → OAuth/JWKS.
  - STDIO sadece kapalı/yerel IDE/desktop senaryolarında kullanılmalıdır.

# Güvenlik Sertleştirme Rehberi

Bu doküman, CodeMentor projesini prod ortamlarında güvenli ve dayanıklı şekilde çalıştırmak için önerilen sertleştirme adımlarını içerir. Aşağıdaki pratikler HTTP/STDIO transportları, kimlik doğrulama, giriş doğrulama/sanitizasyon, kaynak sınırları ve tedarik zinciri güvenliğini kapsar.

## 1) Kimlik Doğrulama ve Yetkilendirme (Dış Katman)

- Bu MCP sunucusu, dahili bir JWT/OAuth veya scope enforcement katmanı içermez.
- Üretim senaryolarında aşağıdakilerden en az birini uygulayın:
  - Reverse proxy ile JWT/OIDC doğrulaması ve zorunlu TLS
  - mTLS ile istemci sertifikası doğrulaması
  - IP allowlist, bastion host veya private network üzerinden erişim
  - API gateway / WAF üzerinde oran sınırlama ve erişim politikaları
- MCP sunucusunu doğrudan internet'e açmayın; her zaman ağ ve kimlik katmanları ile sarın.

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
