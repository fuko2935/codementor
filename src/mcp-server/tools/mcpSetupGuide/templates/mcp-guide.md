# 🤖 MCP Gemini Local - AI Asistanı Kullanım Rehberi

Bu rehber, AI asistanlarının MCP araçlarını doğru, güvenli ve verimli kullanması için optimize edilmiştir.

---

### 1) Zorunlu İş Akışı (Onay Alana Kadar Tekrarla)
1. Danış (Consult): `analyzer` ile plan al (`implementation`).
2. Kodla (Code): Plana uy.
3. İncelet (Review): `analyzer` ile değişiklikleri incelet (`review`).
4. Düzelt (Fix): Geri bildirimi uygula.
5. Doğrula (Verify): Tekrar incelet.

---

### 2) Hızlı Başlangıç
1. Token Sayısını Ölç: `calculate_token_count`.
2. Araç Seç:
- < 900K: `gemini_codebase_analyzer`
- ≥ 900K: `project_orchestrator` (2 adım)
Örnek: `{"tool_name":"calculate_token_count","params":{"projectPath":"."}}`

---

### 3) Araç Referansı
- calculate_token_count:
  - Parametreler: `projectPath`, `textToAnalyze`, `tokenizerModel`.
  - Doğru: `{"tool_name":"calculate_token_count","params":{"projectPath":"."}}`
  - Yanlış: `{"tool_name":"calculate_token_count","params":{"question":"?"}}`
  - Not: Path traversal engellenir.
- gemini_codebase_analyzer:
  - Parametreler: `projectPath`, `question`, `analysisMode`, `includeChanges`, `autoOrchestrate`.
  - Doğru: `{"tool_name":"gemini_codebase_analyzer","params":{"projectPath":".","question":"Değişiklikleri incele","analysisMode":"review","includeChanges":{"revision":"."}}}`
  - Yanlış: `{"tool_name":"gemini_codebase_analyzer","params":{"analysisMode":"general","includeChanges":{}}}`
  - Not: Büyük projede `autoOrchestrate=true`.
- project_orchestrator_create (Adım 1):
  - Parametreler: `projectPath`, `question`, `analysisMode`, `maxTokensPerGroup`.
  - Doğru: `{"tool_name":"project_orchestrator_create","params":{"projectPath":".","question":"Güvenlik açıklarını bul"}}`
  - Yanlış: `{"tool_name":"project_orchestrator_create","params":{"fileGroupsData":"..."}}`
  - Not: `groupsData` sonraki adım için zorunlu.
- project_orchestrator_analyze (Adım 2):
  - Parametreler: `projectPath`, `question`, `fileGroupsData`, `analysisMode`.
  - Doğru: `{"tool_name":"project_orchestrator_analyze","params":{"question":"Riskleri çıkar","fileGroupsData":"{...}"}}`
  - Yanlış: `{"tool_name":"project_orchestrator_analyze","params":{"question":"Analiz et"}}`
  - Not: Token limiti aşılırsa `.mcpignore`.
- gemini_dynamic_expert_create:
  - Parametreler: `projectPath`, `expertiseHint`.
  - Doğru: `{"tool_name":"gemini_dynamic_expert_create","params":{"projectPath":".","expertiseHint":"React performans"}}`
  - Yanlış: `{"tool_name":"gemini_dynamic_expert_create","params":{"expertPrompt":"..."}}`
  - Not: 1000 dosya / 100MB sınır.
- gemini_dynamic_expert_analyze:
  - Parametreler: `projectPath`, `question`, `expertPrompt`.
  - Doğru: `{"tool_name":"gemini_dynamic_expert_analyze","params":{"question":"Auth mimarisi","expertPrompt":"<prompt>"}}`
  - Yanlış: `{"tool_name":"gemini_dynamic_expert_analyze","params":{"question":"..."}}`
  - Not: Boyut limitleri geçerli.
- mcp_setup_guide:
  - Parametreler: `client`, `projectPath`, `force`.
  - Doğru: `{"tool_name":"mcp_setup_guide","params":{"client":"cursor","projectPath":"."}}`
  - Yanlış: `{"tool_name":"mcp_setup_guide","params":{"client":"unknown-client"}}`
  - Not: Diğer araçlardan önce.

---

### 4) Mod Stratejileri
- general, implementation, review, security, debugging (tek satır özet).

---

### 5) Anti-Pattern’ler
- Analyzer’ı büyük projede zorlamak.
- `includeChanges`'ı `review` olmadan.
- Orchestrator adımını atlamak (`groupsData` aktarmamak).
- `mcp_setup_guide`'ı atlamak.

---

### 6) İstemci Entegrasyonu
- [`CURSOR_SETUP.md`](CURSOR_SETUP.md), [`claude_desktop_config.example.json`](claude_desktop_config.example.json)
- Not: API anahtarlarını ortam değişkeni olarak tutun.

---

### 7) Güvenlik ve Performans
- Path traversal engellenir; `projectPath` doğrulanır.
- Rate limitlerde bekle/yeniden dene.
- `.mcpignore` ile gereksiz klasörleri hariç tut.
- `autoOrchestrate=true` ile büyük projede orchestrator.

---

### 8) SSS
- Analyzer zaman aşımı: `orchestrator` veya `autoOrchestrate=true`.
- Path traversal hatası: `.` gibi göreli yol kullan.
- `fileGroupsData missing`: `create` çıktısını `analyze`’a aktar.