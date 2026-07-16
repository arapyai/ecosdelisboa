# Importação CSV de conteúdo

O importador administrativo recebe textos e resolve, no mesmo fluxo, os autores, os pontos e
as traduções fornecidas pela equipe editorial. Tradução automática e geração de áudio não são
disparadas pela importação.

Cada linha representa um texto original em português associado a um ponto e a um autor.

## Template oficial

O template versionado está em `docs/templates/content_import_template.csv` e também pode ser
baixado, com autenticação administrativa, por:

```http
GET /api/v1/admin/points/import/template
```

O endpoint é a fonte recomendada para a interface administrativa, pois acompanha o contrato
implantado no backend.

## Fluxo da API

1. `POST /api/v1/admin/points/import/preview`: valida o arquivo, resolve entidades e executa o
   geocoding necessário, sem gravar alterações.
2. A interface mostra as ações previstas para autor, ponto, texto e traduções.
3. `POST /api/v1/admin/points/import/confirm`: revalida o mesmo arquivo e grava somente as
   linhas sem erro.

Os dois `POST`s recebem multipart com o arquivo no campo `file`.

## Colunas principais

```csv
point_name,address,neighborhood,city,country,lat_override,lng_override,author_name,author_bio_pt,birth_date,death_date,content_pt,content_en,content_type,source_work,source_year
```

### Cabeçalhos obrigatórios

| Campo | Descrição |
| --- | --- |
| `point_name` | Nome editorial do ponto. |
| `author_name` | Nome do autor. |
| `content_pt` | Texto original em português. |

O valor de cada um também deve estar preenchido em todas as linhas.

### Localização

| Campo | Descrição |
| --- | --- |
| `address` | Endereço usado para encontrar um ponto existente ou fazer geocoding. |
| `neighborhood` | Bairro ou zona. |
| `city` | Cidade; o padrão é `Lisboa`. |
| `country` | País; o padrão é `Portugal`. |
| `lat_override` | Latitude conhecida, entre -90 e 90. |
| `lng_override` | Longitude conhecida, entre -180 e 180. |

As coordenadas manuais devem ser fornecidas juntas. Quando elas estão vazias, `address` passa a
ser obrigatório e o backend executa geocoding.

### Autor e fonte

| Campo | Descrição |
| --- | --- |
| `author_bio_pt` | Biografia curta em português. |
| `birth_date` | Data ou ano de nascimento; o importador extrai o primeiro ano com quatro dígitos. |
| `death_date` | Data ou ano de morte; o importador extrai o primeiro ano com quatro dígitos. |
| `source_work` | Obra ou fonte do trecho. |
| `source_year` | Ano da obra ou fonte. |
| `content_type` | `prose`, `poetry` ou `lyrics`. |

Se `content_type` estiver vazio, textos com várias linhas curtas são classificados como
`poetry`; os demais são classificados como `prose`. Um valor preenchido e desconhecido gera
erro.

Também continuam aceitos os aliases curatoriais:

- `Microbio curta (camada 2 do app)` para `author_bio_pt`;
- `Data de nascimento` para `birth_date`;
- `Data de morte` para `death_date`.

Colunas adicionais da planilha editorial são preservadas no arquivo, mas ignoradas pelo
importador quando não possuem um mapeamento documentado.

## Traduções no mesmo arquivo

Traduções usam o formato `content_<código-do-idioma>`:

```csv
content_pt,content_en,content_es,content_fr
```

- `content_pt` é o original obrigatório e é salvo em `texts`;
- cada outra coluna não vazia é salva em `translations`;
- o código deve existir e estar ativo na gestão de idiomas;
- traduções importadas ficam com `status=pending`, `auto_translated=false` e `origin=import`;
- uma coluna vazia não cria nem remove tradução;
- reimportar o mesmo conteúdo reutiliza o registro; conteúdo diferente atualiza a tradução e
  volta seu estado para `pending`;
- importar nunca chama o LLM e nunca gera áudio.

O arquivo versionado inclui `content_en` como exemplo. O endpoint de template acrescenta uma
coluna para cada idioma ativo, e o parser aceita qualquer idioma ativo no formato acima.

## Correspondência e deduplicação

### Autores

O nome é comparado sem diferença de maiúsculas, acentos, pontuação ou espaços repetidos. Um
autor existente é reutilizado; biografia e datas só preenchem campos que ainda estejam vazios.

### Pontos

O importador tenta, nesta ordem:

1. nome e endereço normalizados;
2. endereço normalizado único;
3. nome normalizado único quando um dos endereços está vazio;
4. coordenada única em um raio de 20 metros, após override ou geocoding.

Somente quando não existe uma correspondência segura um ponto novo é criado. Isso permite
variações como `Praça`/`Praca` sem fundir silenciosamente locais ambíguos.

### Textos

Quando `source_work` ou `source_year` está preenchido, a identidade é:

```txt
ponto + autor + source_work + source_year
```

Sem esses campos, a identidade usa:

```txt
ponto + autor + content_pt
```

Assim, um mesmo autor pode ter vários textos no mesmo ponto. A reimportação do mesmo arquivo é
idempotente e o texto original recebe `origin=import`.

## Resposta do preview

Cada linha informa:

- `action`: compatibilidade resumida (`create`, `update` ou `error`);
- `author_action`, `point_action`, `text_action`;
- `translation_actions`, indexado pelo código do idioma;
- `geocoded`, `lat` e `lng` resolvidos;
- `errors`, com os bloqueios da linha.

As ações detalhadas usam `create`, `update`, `reuse` ou `error`.

## Resposta da confirmação

A confirmação mantém `created`, `updated` e `errors` para compatibilidade com o admin atual e
acrescenta contadores detalhados:

```json
{
  "rows": {"total": 2, "imported": 2, "errors": 0},
  "authors": {"created": 1, "updated": 0, "reused": 1},
  "points": {"created": 1, "updated": 0, "reused": 1, "geocoded": 1},
  "texts": {"created": 2, "updated": 0, "reused": 0},
  "translations": {
    "created": 2,
    "updated": 0,
    "reused": 0,
    "by_language": {"en": {"created": 2, "updated": 0, "reused": 0}}
  }
}
```

## Cuidados com o CSV

- salvar em UTF-8; arquivos com BOM também são aceitos;
- colocar entre aspas textos com vírgulas ou quebras de linha;
- não alterar o prefixo `content_` das traduções;
- sempre executar o preview antes da confirmação;
- corrigir linhas com erro no arquivo e gerar um novo preview.
