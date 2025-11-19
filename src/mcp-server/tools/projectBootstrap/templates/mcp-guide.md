# 🧠 CodeMentor AI - Çalışma Protokolü (v5)

Bu dosya, bu projede çalışan AI asistanları için **Tek Doğruluk Kaynağıdır**.
Mevcut araç setine göre optimize edilmiştir.

---

## 1. 🛠️ Aktif Araç Seti ve Yetenekler

Sadece aşağıdaki 4 araca erişimin var. Olmayan araçları (örn: orchestrator) halüsinasyon görme.

| Araç | Amaç | Ne Zaman Kullanılır? |
| :--- | :--- | :--- |
| **`calculate_token_count`** | Proje veya metin boyutunu ölçer. | Analize başlamadan önce maliyet/boyut kontrolü için. |
| **`gemini_codebase_analyzer`** | Kod analizi, inceleme ve soru cevaplama. | Ana analiz aracıdır. Kod okuma, mimari analiz ve PR incelemeleri için. |
| **`create_analysis_mode`** | Uzman persona oluşturma. | Kullanıcı spesifik bir uzmanlık (örn: Güvenlik, SEO) istediğinde. |
| **`project_bootstrap`** | Konfigürasyon yönetimi. | Proje kurallarını güncellemek veya `.mcpignore` oluşturmak için. |

---

## 2. 📉 Büyük Projelerle Çalışma Stratejisi (Token Limiti Yönetimi)

Eğer proje çok büyükse veya `calculate_token_count` yüksek sonuç veriyorsa (> 1M token), analizi bölmen gerekir. Otomatik bir "orkestratör" yoktur; stratejiyi sen yönetmelisin.

### Strateji A: Odaklanmış Analiz (Sub-directory)
Tüm projeyi analiz etmek yerine, sadece ilgili klasöre odaklan.

*   **Kullanıcı:** "Backend'deki auth sorununu bul."
*   **Yanlış:** `projectPath: "."` (Tüm projeyi okur, token limitini patlatır)
*   **Doğru:** `projectPath: "src/backend/auth"` (Sadece ilgili modülü okur)

### Strateji B: Gürültü Filtreleme (temporaryIgnore)
Analizle ilgisi olmayan dosyaları hariç tut.

```json
{
  "projectPath": ".",
  "question": "Çekirdek iş mantığını analiz et",
  "temporaryIgnore": [
    "**/*.test.ts",  // Testler
    "docs/**",       // Dokümantasyon
    "scripts/**",    // Build scriptleri
    "ui/**"          // UI kodları (Backend soruluyorsa)
  ]
}
```

---

## 3. 📝 Kod İnceleme (Code Review) Modu

Kullanıcı bir Pull Request (PR) veya son değişiklikleri incelemeni isterse `review` modunu kullan.

**Son Değişiklikleri İncele:**
```json
{
  "projectPath": ".",
  "analysisMode": "review",
  "includeChanges": { "revision": "." }, // . = Kaydedilmemiş değişiklikler
  "question": "Bu değişikliklerdeki güvenlik açıklarını ve bug potansiyellerini incele."
}
```

**Belirli Bir Commiti İncele:**
```json
{
  "projectPath": ".",
  "analysisMode": "review",
  "includeChanges": { "revision": "a1b2c3d" },
  "question": "Bu commit projenin geri kalanını nasıl etkiliyor?"
}
```

---

## 4. 🎭 Uzman Modları (Custom Personas)

Kullanıcı derinlemesine, alan-spesifik bir analiz istiyorsa standart modlar yerine özel bir uzman yarat.

**Adım 1: Uzmanı Yarat**
```json
{
  "tool_name": "create_analysis_mode",
  "params": {
    "expertiseHint": "Sen kıdemli bir React Performans Mühendisisin. Re-render döngülerini ve bellek kaçaklarını avlarsın.",
    "saveAs": "react-perf",
    "withAi": true,
    "projectPath": "."
  }
}
```

**Adım 2: Uzmanı Kullan**
```json
{
  "tool_name": "gemini_codebase_analyzer",
  "params": {
    "projectPath": ".",
    "analysisMode": "custom:react-perf",
    "question": "Dashboard bileşenindeki yavaşlığın sebebi ne?"
  }
}
```

---

## 5. 🛡️ Proje Kuralları (Project Rules)

Bu projeye özel, değiştirilemez kurallar aşağıdadır. Tüm önerilerin bu kurallarla uyumlu olmalıdır.

{{rules}}