# Importacao CSV de Conteudo

Este documento define o modelo padrao de CSV para a equipe de conteudo importar textos de autores e associa-los a pontos de Lisboa.

A unidade principal do arquivo e o texto. Cada linha representa um texto associado a um ponto e a um autor.

Template: `docs/templates/content_import_template.csv`

## Colunas

```csv
point_name,address,neighborhood,city,country,lat_override,lng_override,author_name,content_pt,content_type,source_work,source_year
```

## Campos obrigatorios

| Campo | Descricao |
| --- | --- |
| `point_name` | Nome editorial do ponto. Ex.: `Chiado`, `Terreiro do Paco`. |
| `address` | Endereco usado para geocoding. Ex.: `Largo do Chiado`. |
| `author_name` | Nome do autor do texto. |
| `content_pt` | Texto original em portugues. |
| `content_type` | Tipo do conteudo. Valores aceitos: `prose`, `poetry`, `lyrics`. |

## Campos opcionais

| Campo | Descricao |
| --- | --- |
| `neighborhood` | Bairro ou zona. Ajuda na revisao editorial e no geocoding. |
| `city` | Cidade. Se vazio, o importador assume `Lisboa`. |
| `country` | Pais. Se vazio, o importador assume `Portugal`. |
| `lat_override` | Latitude manual, quando a equipe ja sabe a coordenada exata ou quer corrigir o geocoder. |
| `lng_override` | Longitude manual, usada junto com `lat_override`. |
| `source_work` | Obra, livro, poema, cronica ou fonte do trecho. |
| `source_year` | Ano da obra ou fonte, quando conhecido. |

## Regras de geocoding

O arquivo nao exige latitude e longitude. Por padrao, o sistema deriva coordenadas a partir de:

```txt
address, neighborhood, city, country
```

Exemplo:

```txt
Largo do Chiado, Chiado, Lisboa, Portugal
```

Se `lat_override` e `lng_override` estiverem preenchidos, eles prevalecem sobre o resultado automatico do geocoding.

## Regras de associacao

- `point_name` + `address` identificam o ponto editorialmente.
- `author_name` identifica ou cria o autor.
- O autor pertence ao texto, nao ao ponto.
- Um mesmo ponto pode aparecer em varias linhas com autores diferentes.
- Um mesmo ponto pode aparecer em varias linhas com textos diferentes do mesmo autor.

## Regras de idempotencia

Para evitar duplicatas, o importador considera como o mesmo texto:

```txt
point_name + address + author_name + source_work + source_year + content_pt
```

Quando `source_work` e `source_year` estiverem vazios, o importador usa:

```txt
point_name + address + author_name + content_pt
```

## Exemplo

```csv
point_name,address,neighborhood,city,country,lat_override,lng_override,author_name,content_pt,content_type,source_work,source_year
Chiado,Largo do Chiado,Chiado,Lisboa,Portugal,,,Fernando Pessoa,"Aqui a cidade tem passos de escritorio, cafe e fantasma.",prose,Fragmento demonstrativo,2026
Terreiro do Paco,Praca do Comercio,Baixa,Lisboa,Portugal,38.7076,-9.1365,Fernando Pessoa,"O rio abre a cidade como uma pagina larga.",poetry,Fragmento demonstrativo,2026
```

## Observacoes para a equipe de conteudo

- Textos com virgula devem ficar entre aspas.
- Quebras de linha dentro de `content_pt` devem ser evitadas no primeiro fluxo de importacao.
- `lat_override` e `lng_override` devem ser preenchidos juntos ou deixados ambos vazios.
- O arquivo deve ser salvo em UTF-8.
