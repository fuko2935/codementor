# DROID-FACTORY Configuration


<!-- MCP:CODEMENTOR:START -->
# 🧠 CodeMentor AI - Gelişmiş Çalışma Protokolü

Bu dosya, bu projede çalışan AI asistanları (Sen) için **Kesin Doğruluk Kaynağıdır (Single Source of Truth)**.
Aşağıdaki kurallar, araç kullanım stratejileri ve bağlam yönetimi prensipleri **zorunludur**.

---

## 1. 🛡️ Temel Prensipler ve Güvenlik

1.  **Önce Güvenlik**: Asla API anahtarlarını, şifreleri veya hassas verileri loglara yazma veya analiz çıktısına ekleme.
2.  **Yıkıcı Değil**: Kod tabanını analiz ederken dosyaları değiştirmezsin (read-only). Önerilerini kod blokları halinde sun.
3.  **Bağlam Farkındalığı**: Kullanıcı sana "bu proje ne yapıyor?" dediğinde, tüm dosyaları okumaya çalışma. Önce yapıyı anla, sonra derinleş.

---

## 2. 🔄 Analiz Düşünce Zinciri (Chain of Thought)

Her karmaşık istek için şu döngüyü uygula:

1.  **KEŞİF (Scout)**: Projenin büyüklüğünü ve yapısını anla.
    *   *Araç:* `calculate_token_count`
2.  **STRATEJİ (Plan)**: Token sayısı sınırların üzerindeyse bağlamı daralt.
    *   *Strateji:* `.mcpignore` kurallarını kontrol et veya `temporaryIgnore` kullan.
3.  **ANALİZ (Action)**: Sorunu çözmek için en uygun mod ile analiz yap.
    *   *Araç:* `gemini_codebase_analyzer`
4.  **DOĞRULAMA (Verify)**: Cevabın kullanıcının sorusunu tam karşıladığından emin ol.

---

## 3. 🛠️ Araç Kullanım Stratejileri (v5.0+)

**DİKKAT:** Eski `project_orchestrator` araçları kaldırılmıştır. Büyük projeler için aşağıdaki "Akıllı Bağlam Yönetimi"ni uygula.

### A. Ana Analiz Aracı: `gemini_codebase_analyzer`

Bu senin ana silahındır. Sadece `projectPath` ve `question` vermek yetersizdir; parametreleri akıllıca kullan:

*   **Genel Analiz**:
    ```json
    {
      "projectPath": ".",
      "analysisMode": "general",
      "question": "Projenin mimarisini açıkla"
    }
    ```

*   **Kod İnceleme (Code Review)**:
    *Kullanıcı bir PR veya değişiklik kontrolü istediğinde:*
    ```json
    {
      "projectPath": ".",
      "analysisMode": "review",
      "includeChanges": { "revision": "." }, // . = working directory, veya commit hash
      "question": "Bu değişikliklerdeki güvenlik açıklarını ve mantık hatalarını bul"
    }
    ```

*   **Uzman Modu (Custom Persona)**:
    *Özel bir uzmanlık gerekiyorsa (örn: React Performans Uzmanı):*
    ```json
    {
      "projectPath": ".",
      "analysisMode": "custom:react-perf-expert", // Önceden oluşturulmuşsa
      "question": "Render döngülerini optimize et"
    }
    ```

### B. Bağlam Yöneticisi: `calculate_token_count`

Analize başlamadan önce maliyeti ve fizibiliteyi ölç.

*   Eğer token sayısı > 1.000.000 ise:
    *   Kullanıcıyı uyar.
    *   Analizi alt klasörlere böl (örn: `./src/backend` ve `./src/frontend` ayrı ayrı).
    *   `temporaryIgnore` kullanarak gereksiz klasörleri (test, docs, legacy) hariç tut.

### C. Uzman Oluşturucu: `create_analysis_mode`

Kullanıcı sık sık belirli bir tür analiz istiyorsa (örn: "Her zaman güvenlik odaklı bak"), ona özel bir mod oluşturmayı teklif et.

```json
{
  "expertiseHint": "Sen paranoyak bir güvenlik uzmanısın. Her satırda SQL Injection ve XSS ararsın.",
  "saveAs": "paranoid-security",
  "withAi": true,
  "projectPath": "."
}
```

---

## 4. 📉 Akıllı Bağlam Yönetimi (Büyük Projeler İçin)

Token limitine takılmamak için `gemini_codebase_analyzer` kullanırken `temporaryIgnore` parametresini agresif kullan:

**Senaryo:** Kullanıcı sadece veritabanı katmanını soruyor.
**Yanlış:** Tüm projeyi analiz etmek.
**Doğru:**
```json
{
  "projectPath": ".",
  "question": "Veritabanı şemasını analiz et",
  "temporaryIgnore": [
    "frontend/**",
    "**/*.test.ts",
    "docs/**",
    "scripts/**"
  ]
}
```

---

## 5. ⚠️ Yasaklı Hareketler (Anti-Patterns)

1.  **Orchestrator Kullanımı:** `project_orchestrator_create` veya `analyze` araçlarını çağırma. Bunlar kaldırıldı.
2.  **Körlemesine Analiz:** Token sayısını kontrol etmeden devasa bir repoyu (örn: Linux kernel) analiz etmeye çalışma.
3.  **API Key Sorma:** Kullanıcıdan asla API key isteme. Bunlar environment variable olarak tanımlı olmalıdır.
4.  **Halüsinasyon Dosyalar:** Var olmayan dosyaları okumaya çalışma, önce `ls` veya dosya listesi isteme yetkin yoksa `calculate_token_count` ile dosya varlığını dolaylı teyit et.

---

## 6. Project-Specific Rules (Kullanıcı Kuralları)

Aşağıdaki kurallar, bu proje için **Anayasa** niteliğindedir. Yaptığın her öneri bu kurallarla uyumlu olmalıdır.

## Project-Specific Rules

Bu bölüm, proje için AI asistanlarının uyması gereken bağlam ve kısıtları içerir.
`project_bootstrap` aracı tarafından otomatik yönetilir ve aşağıdaki YAML bloğu
üzerinden yapılandırılır.

AI için kurallar:

- Bu blokta belirtilen politika ve sınırlamalar, diğer tüm genel önerilerin önündedir.
- Lisans/paket kısıtları ile çelişen bağımlılık önerileri yapılmamalıdır.
- "proprietary", "internal-only" vb. ifadeler varsa, dışa veri sızdırma veya
  kod/paylaşım önerilerinden kaçınılmalıdır.
- Dağıtım modeli ve hedef kitleye uygun olmayan mimari/dependency kararları
  önermekten kaçınılmalıdır.

```yaml
openSourceStatus: open-source
distributionModel: library
targetAudience: "developers"
licenseConstraints:
  - "MIT"
packageConstraints:
  - "official npm registry"
deploymentNotes: |
  npm package for MCP server implementation
<!-- MCP:CODEMENTOR:END -->