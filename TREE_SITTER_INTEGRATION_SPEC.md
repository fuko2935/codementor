# Tree-sitter Entegrasyon Spesifikasyonu

**Belge ID:** `TS-INT-001`  
**Versiyon:** `1.0`  
**Tarih:** `2025-11-04`  
**Durum:** `Draft`

---

## 1. Yönetici Özeti

Bu belge, mevcut regex tabanlı kod parser sistemini Tree-sitter tabanlı AST parsing ile genişletmek için teknik spesifikasyonu detaylandırmaktadır. Tree-sitter entegrasyonu ile daha doğru ve güvenilir metadata extraction sağlanacak, özellikle karmaşık syntax yapılarında (nested classes, decorators, generics) regex tabanlı yaklaşımın limitlerini aşacaktır.

**Mevcut Durum:**
- Regex tabanlı parser'lar: Java, Go, Rust, C#, Ruby, PHP
- Babel tabanlı parser: JavaScript/TypeScript (AST)
- Desteklenen diller: 13 dil

**Hedef Durum:**
- Tree-sitter tabanlı parser'lar: Tüm desteklenen diller için AST parsing
- Hybrid yaklaşım: Tree-sitter başarısız olursa regex fallback
- Daha doğru metadata extraction

---

## 2. Kapsam

### 2.1. Kapsam Dahilinde Olanlar

- `web-tree-sitter` paketinin entegrasyonu (WASM tabanlı, native build gerektirmez)
- Desteklenen diller için Tree-sitter grammar'larının dinamik yüklenmesi
- Mevcut regex parser'ların Tree-sitter tabanlı versiyonlarla değiştirilmesi
- Hybrid fallback mekanizması (Tree-sitter → Regex → Minimal)
- Performance optimizasyonu (grammar caching, lazy loading)
- Test suite'leri ve doğrulama

### 2.2. Kapsam Dışında Olanlar

- Babel parser'ının değiştirilmesi (JavaScript/TypeScript için zaten AST kullanıyor)
- Yeni dil eklenmesi (mevcut 13 dil için optimize edilecek)
- Native tree-sitter kullanımı (build sorunları nedeniyle WASM tercih edildi)

---

## 3. Teknik Mimari

### 3.1. Mimari Kararlar

**Karar 1: web-tree-sitter (WASM) Kullanımı**
- **Gerekçe**: Native build sorunları (Windows, node-gyp), cross-platform uyumluluk
- **Alternatif**: Native tree-sitter (rejected - build complexity)
- **Trade-off**: WASM biraz daha yavaş ama deployment kolaylığı

**Karar 2: Hybrid Approach**
- **Strateji**: Tree-sitter → Regex → Minimal metadata
- **Gerekçe**: Resilience, graceful degradation
- **Fallback sırası**:
  1. Tree-sitter AST parsing (en doğru)
  2. Regex pattern matching (mevcut)
  3. Minimal metadata (sadece path + tokens)

**Karar 3: Lazy Grammar Loading**
- **Strateji**: Grammar'lar ilk kullanımda yüklenir, cache'lenir
- **Gerekçe**: Startup time optimization, memory efficiency
- **Implementation**: Map-based cache: `Map<Language, Promise<Language>>`

### 3.2. Veri Akışı

```
extractMetadata(filePath, content, context)
  ↓
detectLanguage(filePath)
  ↓
getTreeSitterParser(language) [Lazy Load + Cache]
  ↓
try {
  parseWithTreeSitter(content, parser) → FileMetadata
} catch (error) {
  logger.warning("Tree-sitter failed, falling back to regex")
  parseWithRegex(content, language) → FileMetadata
} catch (error) {
  logger.warning("Regex failed, using minimal metadata")
  createMinimalMetadata(content, language) → FileMetadata
}
```

---

## 4. Detaylı Bileşen Spesifikasyonları

### 4.1. Yeni Modül: `treeSitterLoader.ts`

**Dosya:** `src/mcp-server/utils/treeSitterLoader.ts`

**Sorumluluklar:**
- Tree-sitter WASM modülünü başlatma
- Dil grammar'larını dinamik yükleme
- Grammar cache yönetimi
- Error handling ve fallback

**Interface:**

```typescript
import Parser from 'web-tree-sitter';

export interface TreeSitterLanguage {
  language: Parser.Language;
  name: string;
}

export interface LanguageLoader {
  loadLanguage(lang: SupportedLanguage): Promise<TreeSitterLanguage | null>;
  getCachedLanguage(lang: SupportedLanguage): TreeSitterLanguage | null;
  clearCache(): void;
}

/**
 * Loads Tree-sitter WASM module and language grammars.
 * Uses lazy loading and caching for performance.
 */
export class TreeSitterLoader implements LanguageLoader {
  private parser: Parser | null = null;
  private languageCache: Map<SupportedLanguage, TreeSitterLanguage> = new Map();
  private loadingPromises: Map<SupportedLanguage, Promise<TreeSitterLanguage | null>> = new Map();
  
  /**
   * Initializes Tree-sitter WASM parser.
   * Must be called before loading any languages.
   */
  async initialize(): Promise<void>;
  
  /**
   * Loads a language grammar (with caching).
   */
  async loadLanguage(lang: SupportedLanguage): Promise<TreeSitterLanguage | null>;
  
  /**
   * Gets cached language if available.
   */
  getCachedLanguage(lang: SupportedLanguage): TreeSitterLanguage | null;
  
  /**
   * Clears the language cache.
   */
  clearCache(): void;
}
```

**Language Grammar Mapping:**

```typescript
const LANGUAGE_GRAMMAR_MAP: Record<SupportedLanguage, string> = {
  java: 'tree-sitter-java.wasm',
  go: 'tree-sitter-go.wasm',
  rust: 'tree-sitter-rust.wasm',
  csharp: 'tree-sitter-c-sharp.wasm',
  ruby: 'tree-sitter-ruby.wasm',
  php: 'tree-sitter-php.wasm',
  python: 'tree-sitter-python.wasm',
  // JavaScript/TypeScript için Babel kullanılıyor, Tree-sitter optional
  javascript: 'tree-sitter-javascript.wasm',
  typescript: 'tree-sitter-typescript.wasm',
};
```

**WASM Grammar Dosyaları:**

Grammar dosyaları şu kaynaklardan yüklenecek:
- Option 1: npm paketlerinden (`node_modules/tree-sitter-*/tree-sitter-*.wasm`)
- Option 2: CDN'den (`https://unpkg.com/tree-sitter-*/tree-sitter-*.wasm`)
- Option 3: Local `public/grammars/` dizininde

**Önerilen Yaklaşım:** Option 1 (npm paketleri) - offline çalışma, versiyon kontrolü

### 4.2. Yeni Modül: `treeSitterParser.ts`

**Dosya:** `src/mcp-server/utils/treeSitterParser.ts`

**Sorumluluklar:**
- Tree-sitter query'lerini tanımlama
- AST traversal ve metadata extraction
- Language-specific query pattern'leri

**Tree-sitter Query Örnekleri:**

**Java:**
```javascript
const JAVA_QUERIES = {
  classes: '(class_declaration name: (identifier) @class_name)',
  interfaces: '(interface_declaration name: (identifier) @interface_name)',
  methods: '(method_declaration name: (identifier) @method_name)',
  imports: '(import_declaration (scoped_identifier) @import_path)',
};
```

**Go:**
```javascript
const GO_QUERIES = {
  types: '(type_declaration (type_spec name: (type_identifier) @type_name))',
  functions: '(function_declaration name: (identifier) @func_name)',
  imports: '(import_spec path: (interpreted_string_literal) @import_path)',
};
```

**Rust:**
```javascript
const RUST_QUERIES = {
  structs: '(struct_item name: (type_identifier) @struct_name)',
  enums: '(enum_item name: (type_identifier) @enum_name)',
  traits: '(trait_item name: (type_identifier) @trait_name)',
  functions: '(function_item name: (identifier) @func_name)',
  uses: '(use_declaration (scoped_identifier) @use_path)',
};
```

**C#:**
```javascript
const CSHARP_QUERIES = {
  classes: '(class_declaration name: (identifier) @class_name)',
  interfaces: '(interface_declaration name: (identifier) @interface_name)',
  methods: '(method_declaration name: (identifier) @method_name)',
  usings: '(using_directive (qualified_name) @using_path)',
};
```

**Ruby:**
```javascript
const RUBY_QUERIES = {
  classes: '(class name: (constant) @class_name)',
  modules: '(module name: (constant) @module_name)',
  methods: '(method name: (identifier) @method_name)',
  requires: '(call method: (identifier) @#{require_method} arguments: (argument_list (string) @require_path))',
};
```

**PHP:**
```javascript
const PHP_QUERIES = {
  classes: '(class_declaration name: (name) @class_name)',
  interfaces: '(interface_declaration name: (name) @interface_name)',
  traits: '(trait_declaration name: (name) @trait_name)',
  functions: '(function_definition name: (name) @func_name)',
  uses: '(use_declaration (qualified_name) @use_path)',
};
```

**Python:**
```javascript
const PYTHON_QUERIES = {
  classes: '(class_definition name: (identifier) @class_name)',
  functions: '(function_definition name: (identifier) @func_name)',
  imports: '(import_statement (dotted_as_names (dotted_as_name (dotted_name) @import_path)))',
};
```

**Interface:**

```typescript
import type { FileMetadata, SupportedLanguage } from './codeParser.js';
import type { TreeSitterLanguage } from './treeSitterLoader.js';

export interface TreeSitterParser {
  parse(
    content: string,
    language: TreeSitterLanguage,
    langType: SupportedLanguage
  ): FileMetadata;
}

/**
 * Parses code using Tree-sitter AST and extracts metadata.
 */
export class TreeSitterParserImpl implements TreeSitterParser {
  private queries: Map<SupportedLanguage, Map<string, Parser.Query>> = new Map();
  
  /**
   * Initializes queries for a language.
   */
  private initializeQueries(lang: SupportedLanguage, language: TreeSitterLanguage): void;
  
  /**
   * Parses content and extracts metadata.
   */
  parse(
    content: string,
    language: TreeSitterLanguage,
    langType: SupportedLanguage
  ): FileMetadata;
  
  /**
   * Executes a query and extracts capture values.
   */
  private executeQuery(
    tree: Parser.Tree,
    query: Parser.Query,
    captureName: string
  ): string[];
}
```

### 4.3. Güncellenecek Modül: `codeParser.ts`

**Değişiklikler:**

1. **Import'lar:**
```typescript
import { TreeSitterLoader } from './treeSitterLoader.js';
import { TreeSitterParserImpl } from './treeSitterParser.js';
```

2. **Singleton Loader:**
```typescript
// Global singleton loader (lazy initialized)
let treeSitterLoader: TreeSitterLoader | null = null;
let treeSitterParser: TreeSitterParserImpl | null = null;

async function getTreeSitterLoader(): Promise<TreeSitterLoader | null> {
  if (!treeSitterLoader) {
    try {
      treeSitterLoader = new TreeSitterLoader();
      await treeSitterLoader.initialize();
    } catch (error) {
      logger.warning("Tree-sitter initialization failed, will use regex fallback", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
  return treeSitterLoader;
}
```

3. **extractMetadata Güncellemesi:**

```typescript
export async function extractMetadata(
  filePath: string,
  content: string,
  context?: RequestContext,
): Promise<FileMetadata> {
  const language = detectLanguage(filePath);
  
  if (content.length === 0) {
    return createMinimalMetadata(filePath, content, language);
  }

  // Try Tree-sitter first (for supported languages)
  const treeSitterEnabled = ['java', 'go', 'rust', 'csharp', 'ruby', 'php', 'python'].includes(language);
  
  if (treeSitterEnabled) {
    try {
      const loader = await getTreeSitterLoader();
      if (loader) {
        const langModule = await loader.loadLanguage(language);
        if (langModule && treeSitterParser) {
          return treeSitterParser.parse(content, langModule, language);
        }
      }
    } catch (error) {
      // Fall through to regex
      logger.debug("Tree-sitter parsing failed, using regex fallback", {
        ...context,
        filePath,
        language,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Fallback to existing regex/Babel parsers
  try {
    switch (language) {
      // ... existing cases
    }
  } catch (error) {
    // Final fallback: minimal metadata
    return createMinimalMetadata(filePath, content, language);
  }
}
```

---

## 5. Bağımlılık Yönetimi

### 5.1. npm Paketleri

**Eklenecek Dependencies:**

```json
{
  "dependencies": {
    "web-tree-sitter": "^0.20.8"
  },
  "optionalDependencies": {
    "tree-sitter-java": "^0.20.4",
    "tree-sitter-go": "^0.20.0",
    "tree-sitter-rust": "^0.20.4",
    "tree-sitter-c-sharp": "^0.20.4",
    "tree-sitter-ruby": "^0.20.3",
    "tree-sitter-php": "^0.20.3",
    "tree-sitter-python": "^0.20.4",
    "tree-sitter-javascript": "^0.20.3",
    "tree-sitter-typescript": "^0.20.3"
  }
}
```

**Not:** `optionalDependencies` kullanılması: Eğer bir grammar paketi yüklenemezse, o dil için regex fallback kullanılır.

### 5.2. WASM Dosya Yolu Çözümleme

**Strateji:** Her grammar paketinin WASM dosyasını bulmak için:

```typescript
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function findWasmPath(packageName: string): string | null {
  try {
    const packagePath = require.resolve(`${packageName}/package.json`);
    const packageDir = path.dirname(packagePath);
    const wasmFile = path.join(packageDir, `${packageName}.wasm`);
    
    // Check if file exists
    if (fs.existsSync(wasmFile)) {
      return wasmFile;
    }
    
    // Alternative: check in bindings directory
    const bindingsPath = path.join(packageDir, 'bindings', 'node', `${packageName}.wasm`);
    if (fs.existsSync(bindingsPath)) {
      return bindingsPath;
    }
    
    return null;
  } catch {
    return null;
  }
}
```

---

## 6. Hata Yönetimi Stratejisi

### 6.1. Hata Senaryoları ve Çözümleri

| Senaryo | Davranış | Log Level |
|---------|----------|-----------|
| Tree-sitter WASM yüklenemez | Regex fallback | `warning` |
| Grammar dosyası bulunamaz | Regex fallback | `warning` |
| Grammar parse hatası | Regex fallback | `warning` |
| Query execution hatası | Regex fallback | `debug` |
| Regex parsing hatası | Minimal metadata | `warning` |
| Tüm yöntemler başarısız | Minimal metadata | `error` |

### 6.2. Graceful Degradation

```
Tree-sitter → Regex → Minimal
   ↓            ↓         ↓
  Best      Acceptable  Basic
```

Her aşamada kullanıcıya işlevsellik sunulur, hiçbir durumda sistem çökmez.

---

## 7. Performance Optimizasyonları

### 7.1. Grammar Caching

- **Strateji**: İlk yüklemede cache'le, sonraki çağrılarda cache'den kullan
- **Memory**: ~500KB-2MB per grammar (kabul edilebilir)
- **TTL**: Cache süresiz (application lifetime)

### 7.2. Lazy Loading

- **Strateji**: Grammar'lar sadece gerektiğinde yüklenir
- **Benefit**: Startup time optimization
- **Trade-off**: İlk parse biraz daha yavaş (kabul edilebilir)

### 7.3. Parser Reuse

- **Strateji**: Parser instance'ı singleton olarak tutulur
- **Benefit**: Memory efficiency, faster subsequent parses

### 7.4. Query Caching

- **Strateji**: Compiled query'ler cache'lenir
- **Benefit**: Query compilation overhead'i sadece bir kez

---

## 8. Test Stratejisi

### 8.1. Unit Tests

**Test Dosyaları:**
- `treeSitterLoader.test.ts` - Grammar loading, caching
- `treeSitterParser.test.ts` - Query execution, metadata extraction
- `codeParser.integration.test.ts` - End-to-end parsing

**Test Senaryoları:**

1. **Grammar Loading:**
   - ✅ Başarılı yükleme
   - ✅ Cache mekanizması
   - ✅ Missing grammar handling
   - ✅ Invalid WASM file handling

2. **Parsing:**
   - ✅ Basit class/function extraction
   - ✅ Nested structures
   - ✅ Complex generics/templates
   - ✅ Error recovery

3. **Fallback:**
   - ✅ Tree-sitter → Regex fallback
   - ✅ Regex → Minimal fallback
   - ✅ Logging doğrulaması

### 8.2. Performance Tests

**Benchmark Senaryoları:**

1. **Small files** (<100 lines): Tree-sitter vs Regex
2. **Medium files** (100-1000 lines): Tree-sitter vs Regex
3. **Large files** (>1000 lines): Tree-sitter vs Regex
4. **Memory usage**: Grammar cache impact

**Expected Results:**
- Tree-sitter: ~10-50ms per file (average)
- Regex: ~1-5ms per file (average)
- Trade-off: Accuracy vs Speed (Tree-sitter daha doğru)

### 8.3. Integration Tests

**Test Projeleri:**

Her dil için örnek projeler:
- Java: Spring Boot project
- Go: REST API project
- Rust: CLI tool project
- C#: ASP.NET project
- Ruby: Rails project
- PHP: Laravel project
- Python: Django project

**Doğrulama:**
- Metadata extraction accuracy
- Token estimation accuracy
- Grouping quality improvement

---

## 9. Migration Planı

### 9.1. Aşamalı Geçiş

**Phase 1: Infrastructure (Week 1)**
- ✅ `treeSitterLoader.ts` implementasyonu
- ✅ `treeSitterParser.ts` implementasyonu
- ✅ Unit tests

**Phase 2: Integration (Week 2)**
- ✅ `codeParser.ts` güncellemesi
- ✅ Hybrid fallback mekanizması
- ✅ Integration tests

**Phase 3: Optimization (Week 3)**
- ✅ Performance tuning
- ✅ Caching optimizations
- ✅ Error handling improvements

**Phase 4: Validation (Week 4)**
- ✅ Real-world project testing
- ✅ Benchmarking
- ✅ Documentation

### 9.2. Rollback Planı

**Eğer Tree-sitter sorunları devam ederse:**
- Feature flag ile Tree-sitter'ı disable etme
- Tamamen regex fallback'e geçiş
- Mevcut kod zaten çalışıyor, risk yok

---

## 10. Dokümantasyon Gereksinimleri

### 10.1. Kod Dokümantasyonu

- JSDoc comments tüm public API'ler için
- Query pattern'leri için açıklamalar
- Error handling stratejileri için notlar

### 10.2. Kullanıcı Dokümantasyonu

- README güncellemesi: Tree-sitter desteği
- Performance karakteristikleri
- Troubleshooting guide

### 10.3. Internal Dokümantasyonu

- Architecture decision records (ADR)
- Query pattern referansı
- Grammar loading mekanizması

---

## 11. Başarı Kriterleri

### 11.1. Fonksiyonel Kriterler

- ✅ Tüm desteklenen diller için Tree-sitter parsing çalışıyor
- ✅ Fallback mekanizması sorunsuz çalışıyor
- ✅ Metadata extraction accuracy %95+ (regex'e göre)

### 11.2. Performans Kriterleri

- ✅ Grammar loading: <500ms (ilk yükleme)
- ✅ Parsing time: <100ms per file (average)
- ✅ Memory overhead: <50MB (tüm grammar'lar)

### 11.3. Kalite Kriterleri

- ✅ Test coverage: >80%
- ✅ Error rate: <1% (graceful degradation ile)
- ✅ Logging: Tüm hatalar loglanıyor

---

## 12. Riskler ve Mitigasyonlar

| Risk | Olasılık | Etki | Mitigasyon |
|------|----------|------|------------|
| WASM yükleme sorunları | Orta | Yüksek | Regex fallback, optional dependencies |
| Grammar versiyon uyumsuzluğu | Düşük | Orta | Version pinning, testing |
| Performance degradation | Düşük | Orta | Caching, lazy loading |
| Memory overhead | Düşük | Düşük | Grammar cache limits |

---

## 13. Ekler

### Ek A: Tree-sitter Query Referansı

Her dil için detaylı query örnekleri ve capture pattern'leri.

### Ek B: WASM Dosya Yolu Çözümleme

Grammar paketlerinden WASM dosyalarını bulma algoritması.

### Ek C: Performance Benchmark Sonuçları

Tree-sitter vs Regex karşılaştırma sonuçları.

---

**Son Güncelleme:** 2025-11-04  
**Hazırlayan:** AI Assistant  
**Onay:** Pending

