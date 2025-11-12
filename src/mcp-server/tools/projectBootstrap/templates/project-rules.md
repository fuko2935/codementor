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
{{PROJECT_RULES_YAML}}