Languages: [English](README.md) | Türkçe

# CodeMentor (Türkçe)

Bu proje, yerel makinenizde çalıştırabileceğiniz hafif bir Model Context Protocol (MCP) sunucusudur. `npx` ile anında başlatılabilir. Supabase, DuckDB veya ajan bağımlılıkları olmadan kapsamlı analiz iş akışları sağlar. Ortam değişkenleri ile API anahtarlarınızı tanımlayın, bir taşıyıcı seçin (varsayılan `stdio`, gerektiğinde `http`) ve Claude Desktop ya da MCP uyumlu herhangi bir istemciye bağlanın.

---

## Hızlı Başlangıç

### `npx` ile anında çalıştır

Varsayılan: Gemini CLI Sağlayıcısı (OAuth)

```bash
# gemini CLI'yi yükleyin ve kimlik doğrulayın
npm install -g @google/gemini-cli
gemini  # "Login with Google" seçeneğini kullanın

# Sunucuyu çalıştırın
npx codementor
```

Alternatif: API Anahtarı ile

```bash
# ⚠️ GÜVENLİK UYARISI: API anahtarlarını asla dosyalara gömmeyin!
export GOOGLE_API_KEY="google veya gemini anahtarınız"
LLM_DEFAULT_PROVIDER=gemini npx codementor
```

CLI varsayılan olarak STDIO taşımacılığıyla başlar; Claude Desktop ve yerel MCP istemcileri için hazırdır.

### Yerel kurulum

```bash
git clone <repo-url>
cd codementor
npm install
npm run build
npm start
```

Geliştirme sırasında canlı TypeScript çalıştırmak için: `npm run start:local`

---

## Yapılandırma

Tüm davranış ortam değişkenleriyle yönetilir. Yalnızca ihtiyaç duyduğunuz sağlayıcı anahtarlarını ayarlayın.

### Varsayılan Sağlayıcı

Sunucu varsayılan olarak Gemini CLI sağlayıcısını (`gemini-cli`) ve `gemini` CLI üzerinden OAuth kimlik doğrulamayı kullanır.

1. Global kurulum: `npm install -g @google/gemini-cli`
2. Kimlik doğrulama: `gemini` (Google ile giriş yapın)
3. Sunucu OAuth kimlik bilgilerinizi otomatik kullanır

API anahtarı tabanlı kimlik doğrulamaya dönmek için `LLM_DEFAULT_PROVIDER=gemini` veya `LLM_DEFAULT_PROVIDER=google` ayarlayın.

### Çekirdek Sunucu Ayarları

| Değişken | Açıklama | Varsayılan |
| --- | --- | --- |
| `MCP_TRANSPORT_TYPE` | `stdio` veya `http` | `stdio` |
| `MCP_HTTP_PORT` | HTTP modu portu | `3010` |
| `MCP_HTTP_HOST` | HTTP host | `127.0.0.1` |
| `MCP_LOG_LEVEL` | Log seviyesi (`debug`, `info`, `warning`, …) | `debug` |
| `LOGS_DIR` | Log dosyaları dizini | `./logs` |
| `LLM_DEFAULT_PROVIDER` | Varsayılan LLM sağlayıcı | `gemini-cli` |
| `LLM_DEFAULT_MODEL` | Varsayılan LLM modeli | `gemini-2.5-pro` |
| `MAX_GIT_BLOB_SIZE_BYTES` | Git diff analizi için maksimum dosya boyutu | `4194304` |

### Sağlayıcı API Anahtarları (opsiyonel)

⚠️ Güvenlik: API anahtarlarını asla depoya commit etmeyin. Ortam değişkenlerini kullanın.

- `GOOGLE_API_KEY` / `GEMINI_API_KEY`
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `PERPLEXITY_API_KEY`, `MISTRAL_API_KEY`, `GROQ_API_KEY`
- `OPENROUTER_API_KEY`, `XAI_API_KEY`
- `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`
- `OLLAMA_API_KEY`, `OLLAMA_HOST`

> Geriye dönük uyumluluk için `GEMINI_API_KEY` ve istek parametresi `geminiApiKey` desteklenir.

---

## Taşıyıcılar (Transports)

- STDIO (varsayılan): Claude Desktop gibi yerel MCP orkestratörleri için idealdir.
- HTTP: `MCP_TRANSPORT_TYPE=http` ayarlayın. Akışlı HTTP uç noktası `http://<host>:<port>/mcp`.

Her iki modda loglar `logs/activity.log` ve `logs/error.log` dosyalarına yazılır.

### HTTP Oturum Deposu (opsiyonel Redis)

Varsayılan olarak HTTP oturumları bellek içinde takip edilir; bu, tek süreçli dağıtımlar için uygundur. Yük dengeleyici arkasında çok örnekli/clustered dağıtımlar için oturum yapışkanlığı (sticky-session) gerektiğinde Redis tabanlı oturum koordinasyonunu etkinleştirin.

```bash
# Redis destekli oturum sahipliliği takibi
export MCP_SESSION_STORE=redis
export REDIS_URL="redis://localhost:6379"
# İsteğe bağlı anahtar öneki (varsayılan: mcp:sessions:)
export REDIS_PREFIX="mcp:sessions:"
```

Notlar:
- Yalnızca oturum sahipliliği (instance ID) meta verisi kalıcıdır; transport nesneleri değildir.
- Yönlendirme katmanı, sahip bilgilerinden yararlanarak yapışkanlığı uygulayabilir.
- Redis kullanmak istemiyorsanız `MCP_SESSION_STORE=memory` ile bellek içi moda dönersiniz.

Neden Redis?
- Birden çok sunucu örneği çalışırken aynı oturumla ilgili takip, bellek içi modelde örnekler arası senkronize değildir.
- Redis, oturumun hangi örneğe ait olduğunu merkezi şekilde paylaşır ve yük dengeleyicide doğru örneğe yönlendirme yapılmasına yardımcı olur.

---

## Araç Öne Çıkanlar

- Kapsamlı proje analizi ve entegre orkestrasyon - ayrı araçlara gerek yok
- Hedefli kod arama ve bilgiyi çıkarma yardımcıları
- Token muhasebesi (Gemini uyumlu)
- Büyük projeler için yerleşik gruplanmış analiz

---

## Git Diff ile Kod İncelemesi (Review Modu)

`gemini_codebase_analyzer` aracı `review` modunda git diff entegrasyonunu destekler.

Değişmemiş commitler için:

```json
{
  "projectPath": "./",
  "question": "Değişikliklerimi güvenlik ve kalite açısından incele",
  "analysisMode": "review",
  "includeChanges": { "revision": "." }
}
```

Belirli bir commit için:

```json
{
  "projectPath": "./",
  "question": "Bu commit'te potansiyel bugları analiz et",
  "analysisMode": "review",
  "includeChanges": { "revision": "a1b2c3d" }
}
```

Son N commit:

```json
{
  "projectPath": "./",
  "question": "Son değişiklikleri gözden geçir",
  "analysisMode": "review",
  "includeChanges": { "count": 5 }
}
```

Özellikler:
- Güvenlik, performans ve en iyi uygulamalara odaklı uzman inceleme personası
- Makine tarafından okunabilir yapılandırılmış diff girdisi
- Tüm kod tabanıyla birlikte bağlam içinde analiz
- Büyük dosya koruması: `MAX_GIT_BLOB_SIZE_BYTES` üzerinde kalanlar atlanır ve raporlanır
- Otomatik orkestrasyon: `autoOrchestrate=true` ile büyük projelerde grup bazlı analiz

#### Otomatik Orkestrasyon (büyük projeler)

- `gemini_codebase_analyzer` aracı artık büyük projeler için yerleşik orkestrasyon yeteneklerine sahip
- Token sınırı aşıldığında otomatik gruplandırılmış analize geçmek için `autoOrchestrate=true` ayarlayın
- `orchestratorThreshold` (varsayılan `0.75`) `tokenCount / maxTokens` temelinde ne zaman orkestrasyon tetikleneceğini kontrol eder
- Herhangi bir proje boyutu için orkestrasyonu zorlamak için `orchestratorThreshold: 0` ayarlayın
- Orkestrasyon modunda `analysisMode: "review"` desteklenmez; akış `analysisMode: "general"` moduna geçer ve sonuçları grup toplu analizlerinden sentezler
- Bu sorunsuz bir deneyim sağlar - artık ayrı `project_orchestrator_create` ve `project_orchestrator_analyze` araçlarına ihtiyaç yok (kullanım dışı)

> **⚠️ Not:** Ayrı `project_orchestrator_create` ve `project_orchestrator_analyze` araçları artık kullanım dışıdır. Aynı işlevsellik için daha iyi entegrasyonla `autoOrchestrate=true` parametresiyle `gemini_codebase_analyzer` kullanın.

---

## Erişim Modeli

- Bu projedeki HTTP ve STDIO MCP endpoint'leri, yerleşik bir kimlik doğrulama veya scope tabanlı yetkilendirme mekanizması içermez.
- Sunucu; yerel geliştirme, güvenli/izole ortamlar veya kendi ağ/kimlik katmanınızın arkasında çalıştırılmak üzere tasarlanmıştır.
- Üretim veya paylaşılan ortamlarda erişimi korumak için DAİMA harici mekanizmalar kullanın:
  - Reverse proxy arkasında JWT/OIDC doğrulaması
  - mTLS
  - IP allowlist veya ağ segmentasyonu
  - API gateway / WAF
- Araçlar ve kaynaklar, sunucu tarafında scope kontrolü olmadan çağrılabilir; `withRequiredScopes` sadece geriye dönük uyumluluk için bırakılmış bir no-op yardımcıdır ve güvenlik kontrolü olarak KESİNLİKLE görülmemelidir.

## Güvenlik ve Mimari Öne Çıkanlar

### Güvenli Yol Yönetimi (BASE_DIR + validateSecurePath)

Tüm dosya sistemi erişimleri, tanımlı bir proje köküne (`BASE_DIR`) sabitlenir. [`validateSecurePath`](src/mcp-server/utils/securePathValidator.ts:1) benzeri yardımcılar path traversal girişimlerini engeller ve araçların proje kökü dışına çıkmasını önler. Bu yaklaşım; kod analizi, diff okuma ve dosya tabanlı MCP kaynakları için tutarlı şekilde uygulanır.

### Rate Limiting ve Redis Desteği

Sunucu, upstream LLM sağlayıcılarını ve yerel kaynaklarınızı korumak için hız sınırlama katmanına sahiptir.

- Varsayılan: Bellek içi (lokal/single-node senaryolar için).
- Redis backend etkinleştirme:
  - `MCP_RATE_LIMIT_STORE=redis`
  - `REDIS_URL=redis://user:pass@host:6379/0`
- Anahtar kimlik öncelik sırası:
  1. `userId`
  2. `clientId`
  3. `ip`
  4. `anon:global`

Bu model, farklı istemciler arasında adil kullanım ve suiistimal koruması sağlar.

### Oturum Deposu (Session Store)

HTTP oturum sahipliği ve koordinasyonu benzer esnek yapıyı kullanır:

- Varsayılan: Bellek içi (basit dağıtımlar için).
- Redis: `MCP_SESSION_STORE=redis` ile etkinleştirildiğinde çoklu instance senaryolarında tutarlı yönlendirme ve stickiness desteği sağlar.

### CI/CD Güvenliği

Tavsiye edilen yayın hattı, güvenli yayın ve bağımlılık hijyenini hedefler:

- Üretim bağımlılıkları için `npm audit --production --audit-level=high` çalıştırılması,
- CodeQL (veya eşdeğer) statik analiz ile güvenlik regresyonlarının yakalanması,
- Dependabot benzeri araçlarla otomatik güvenlik güncellemeleri,
- `publish.yml` iş akışının yalnızca SemVer etiketleri (`v*.*.*`) ile tetiklenmesi; böylece yayınların izlenebilir olması.

### Log Maskeleme (Redaction)

Log çıktılarında hassas değerler agresif şekilde maskelenir.

- `MCP_REDACT_KEYS` ile (virgülle ayrılmış) ek redaksiyon anahtarları tanımlanabilir.
- Bu anahtarlara uyan değerler dahili logger tarafından üretilen yapılandırılmış loglarda otomatik gizlenir.

> Not: README.tr, İngilizce README ile senkron tutulur. Gelecekte planlanan `translate-readme` workflow'u, iki dil arasındaki drift'i minimumda tutmak için kullanılacaktır.

---

## Güvenlik

Üretim ortamı için detaylı sertleştirme rehberi:
`docs/security-hardening.md` dosyasındaki önerileri izleyin.

Özetle:
- Bu MCP sunucusunu iç servis olarak konumlandırın.
- TLS terminasyonu, kimlik doğrulama/yetkilendirme ve ağ sınırlandırmalarını ters proxy veya API gateway katmanında uygulayın.
- Dosya sistemi, rate limiting, log redaksiyonu ve path güvenliği için mevcut yardımcıları etkin kullanın.

---

## .mcpignore Desteği

MCP bağlamını `.gitignore` üzerine ek desenlerle optimize eder.

Nasıl çalışır:
1. `.gitignore` desenleri yüklenir
2. `.mcpignore` desenleri üzerine eklenir
3. Tüm MCP araçları her ikisine de uyar

Örnek oluşturma:

```bash
cp .mcpignore.example .mcpignore
```

Sık kullanım örnekleri:

Test dosyalarını hariç tutma:

```gitignore
**/*.test.ts
**/*.spec.ts
**/tests/**
__tests__/**
```

Dokümantasyonu hariç tutma:

```gitignore
docs/**
*.md
!README.md
```

Üretilmiş dosyaları hariç tutma:

```gitignore
**/generated/**
**/*.generated.ts
```

---

## Geliştirme Komutları

| Komut | Amaç |
| --- | --- |
| `npm run build` | TypeScript'i `dist/`'e derler |
| `npm start` | Derlenmiş CLI'yi STDIO ile çalıştırır |
| `npm run start:local` | TypeScript'i `ts-node` ile doğrudan çalıştırır |
| `npm run start:http` | HTTP taşıyıcısı ile başlatır |
| `npm run lint` / `npm run lint:fix` | ESLint analizi |
| `npm run docs:generate` | TypeDoc dokümantasyonu üretir |

---

## Proje Dizilimi

```
src/
├── config/
├── mcp-server/
├── services/
│   └── llm-providers/
├── utils/
└── index.ts
```

Eski ajan ve dağıtım artefaktları `2.0.0` öncesi geçmişte mevcuttur.

---

## Mimarî Genel Bakış

Yüksek seviye bileşen haritası, akışlar, güvenlik ve performans için `docs/architecture.md` dosyasına bakın.

---

## Cursor ile Bağlantı

Ayrıntılar için `CURSOR_SETUP.md` dosyasını izleyin.

Hızlı kurulum:

```bash
npm install -g @google/gemini-cli
gemini  # Google ile giriş
```

`cursor_mcp_config.json` içeriğini ekleyin ve Cursor'u yeniden başlatın.

## Claude Desktop ile Bağlantı

Örnek yapılandırma: `claude_desktop_config.example.json`

API anahtarı ile kullanımda anahtarları config dosyasına gömmeyin; ortam değişkeni kullanın.

---

## Dil Stratejisi

Birincil dokümantasyon İngilizce sunulur. Türkçe okuyucular için bu dosya sağlanmıştır. Yeni eklemeler önce README.md üzerinde güncellenir, ardından mümkün oldukça README.tr.md senkronize tutulur.

---

## Sonraki Adımlar

- Yeni araçları `src/mcp-server` alt yapısına taşıyın veya entegre edin
- Sağlayıcı anahtar çözücüsüne yeni satıcılar ekleyin
- API değişiklikleri sonrası belgeleri güncellemek için `npm run docs:generate` çalıştırın

Keyifli kullanımlar!