# Cursor MCP Kullanım Kılavuzu

## Hızlı Başlangıç

### 1. Gemini CLI Kurulumu (Önerilen)

Gemini CLI provider varsayılan olarak kullanılır ve OAuth authentication ile çalışır (API key gerektirmez).

```bash
# Gemini CLI'yi global olarak yükleyin
npm install -g @google/gemini-cli

# Gemini CLI ile OAuth authentication yapın
gemini
# Açılan pencerede "Login with Google" seçeneğini seçin
```

### 2. Cursor MCP Config Dosyasını Oluşturun

Cursor'da MCP kullanmak için config dosyasını oluşturun:

**Windows:**

```
%APPDATA%\Cursor\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json
```

**macOS:**

```
~/Library/Application Support/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json
```

**Linux:**

```
~/.config/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json
```

### 3. Config Dosyası İçeriği

Aşağıdaki JSON içeriğini yukarıdaki konuma yapıştırın:

#### Gemini CLI Provider ile (Önerilen - Varsayılan)

```json
{
  "mcpServers": {
    "codementor": {
      "command": "npx",
      "args": ["-y", "codementor"],
      "env": {
        "LLM_DEFAULT_PROVIDER": "gemini-cli"
      }
    }
  }
}
```

#### API Key ile (Alternatif)

**⚠️ GÜVENLİK UYARISI:** API key'leri asla config dosyalarına yazmayın! Environment variable olarak ayarlayın.

```json
{
  "mcpServers": {
    "codementor": {
      "command": "npx",
      "args": ["-y", "codementor"],
      "env": {
        "LLM_DEFAULT_PROVIDER": "gemini"
        // GOOGLE_API_KEY'i buraya EKLEMEYİN - environment variable olarak ayarlayın!
      }
    }
  }
}
```

**API key'i environment variable olarak ayarlayın:**

**Windows (PowerShell):**
```powershell
$env:GOOGLE_API_KEY="your-api-key-here"
```

**macOS/Linux:**
```bash
export GOOGLE_API_KEY="your-api-key-here"
```

**Veya shell profile'ınıza ekleyin** (`~/.bashrc`, `~/.zshrc`, vb.):
```bash
export GOOGLE_API_KEY="your-api-key-here"
```

### 4. Cursor'u Yeniden Başlatın

Config dosyasını oluşturduktan sonra Cursor'u tamamen kapatıp tekrar açın.

## Kullanım

### MCP Araçlarına Erişim

Cursor'da MCP araçlarına şu şekilde erişebilirsiniz:

1. **Chat Panelinde:** Cursor'un chat panelinde `@codementor` yazarak araçları kullanabilirsiniz

2. **Doğrudan Araç Adları:**
   - `gemini_codebase_analyzer` - Proje analizi için kapsamlı analiz
   - `project_orchestrator` - Büyük projeler için orkestrasyon

### Örnek Kullanım

```
@codementor gemini_codebase_analyzer ile proje yolunu analiz et
```

veya

```
Bu projeyi analiz et: /path/to/my/project
```

## Sorun Giderme

### Gemini CLI bulunamadı hatası

```bash
# Gemini CLI'yi global olarak yükleyin
npm install -g @google/gemini-cli

# Kurulumu doğrulayın
gemini --version
```

### OAuth authentication hatası

```bash
# Gemini CLI'yi çalıştırın ve tekrar giriş yapın
gemini
# /auth komutu ile authentication yöntemini değiştirebilirsiniz
```

### Cursor'da araçlar görünmüyor

1. Config dosyasının doğru konumda olduğundan emin olun
2. JSON syntax'ının doğru olduğunu kontrol edin
3. Cursor'u tamamen kapatıp tekrar açın
4. Cursor'un Developer Tools'unda (Cmd/Ctrl + Shift + I) Console'da hataları kontrol edin
5. Cursor Settings > Extensions > MCP bölümünde server'ın aktif olduğunu kontrol edin

### API Key hatası (gemini-cli kullanmıyorsanız)

Eğer `LLM_DEFAULT_PROVIDER=gemini` kullanıyorsanız, `GOOGLE_API_KEY` environment variable'ının ayarlandığından emin olun. **API key'i config dosyasına değil, environment variable olarak ayarlayın!**

API key'i şuradan alabilirsiniz: https://makersuite.google.com/app/apikey

**⚠️ ÖNEMLİ:** API key'leri asla config dosyalarına yazmayın! Bu, güvenlik riski oluşturur ve Git'e commit edilirse secret'ınız açığa çıkabilir.

## Özellikler

- ✅ Gemini CLI Provider ile OAuth authentication (API key gerektirmez)
- ✅ Varsayılan model: `gemini-2.5-pro`
- ✅ Büyük projeler için akıllı token yönetimi
- ✅ Otomatik API key rotation desteği
- ✅ Çoklu dosya analizi ve gruplama
- ✅ Uzman mod oluşturma ve analiz

## Daha Fazla Bilgi

Detaylı dokümantasyon için `README.md` dosyasına bakın.
