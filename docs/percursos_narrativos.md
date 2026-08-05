# Percursos narrativos

## Princípio de produto

Um percurso é uma sequência editorial de textos situados no espaço. Não é uma sequência de
pontos que por acaso contém textos. A ordem narrativa é a fonte de verdade; coordenadas,
geometria e waypoints apenas permitem caminhar entre etapas dessa narrativa.

Isso implica quatro regras:

1. cada segmento `text` referencia exatamente um `text_id` e herda autor, obra, localização,
   traduções e áudios desse texto;
2. dois textos no mesmo ponto continuam sendo duas etapas independentes;
3. um segmento `bridge` pertence somente ao percurso e pode ser introdução, transição ou
   encerramento em PT/EN, com áudio curatorial próprio;
4. waypoints pertencem às pernas pedonais e nunca são exibidos como conteúdo.

O campo público `items` é um alias de leitura depreciado de `segments` por uma versão. Código
novo deve consumir `segments`.

## Modelo e contratos

`routes` guarda metadados, publicação, totais e estado de roteamento. `route_items` guarda os
segmentos ordenados (`text` ou `bridge`). `route_legs` liga dois segmentos de texto consecutivos
e persiste uma `LineString` GeoJSON, distância, duração, waypoints, provedor e posição. Bridges
não dividem uma perna.

O detalhe público localizado é obtido em:

```text
GET /api/v1/routes/{id}?lang=pt
GET /api/v1/routes/{id}?lang=en
```

Cada segmento de texto retorna o texto localizado, o original PT, autor, obra, ponto e apenas os
áudios identificados por idioma. Bridges retornam `content`, `content_pt` e `audio_files`. O
cliente nunca chama um provedor de direções.

Contratos administrativos principais:

```text
GET|POST              /api/v1/admin/routes
PUT|DELETE            /api/v1/admin/routes/{id}
POST                  /api/v1/admin/routes/{id}/recalculate
GET                   /api/v1/admin/routes/{id}/readiness?lang=pt
PUT|DELETE            /api/v1/admin/routes/{id}/segments/{segment_id}/translations/{lang}
POST                  /api/v1/admin/routes/{id}/segments/{segment_id}/audio/{lang}/generate
PUT                   /api/v1/admin/routes/{id}/segments/{segment_id}/audio/{lang}/upload
```

Excluir um texto ou ponto usado por um percurso retorna `409`. Publicar uma rota incompleta
retorna `409` com `detail.code=route_not_ready` e readiness estruturada por idioma.

## Roteamento pedonal

O backend usa `DirectionsProvider`; a implementação hospedada é openrouteservice com perfil
`foot-walking`. Configure:

```env
ROUTING_PROVIDER=openrouteservice
OPENROUTESERVICE_API_KEY=...
OPENROUTESERVICE_BASE_URL=https://api.openrouteservice.org
ROUTING_TIMEOUT_S=15
ROUTING_RETRY_COUNT=2
ROUTING_RETRY_BACKOFF_S=0.25
```

O recálculo recebe overrides opcionais por perna:

```json
{"legs":[{"position":0,"waypoints":[{"lat":38.709,"lng":-9.137}]}]}
```

Um hash cobre sequência, coordenadas e waypoints. Alterar qualquer um deles marca a geometria
como desatualizada. Timeout ou falha do ORS coloca o estado em `failed`, registra o erro e
preserva a última geometria válida. GPX usa as coordenadas completas das pernas, não retas entre
pontos.

## Readiness e áudio

A publicação exige, em cada idioma de `ROUTE_REQUIRED_LANGUAGES` (por padrão PT e EN):

- pelo menos dois segmentos de texto;
- título, descrição, autor, obra e coordenadas válidas;
- tradução aprovada quando o idioma não é a fonte;
- áudio do idioma para todos os textos e bridges;
- geometria atual e uma perna válida entre cada par de textos.

Vozes de bridge são definidas por idioma:

```env
ROUTE_CURATORIAL_VOICE_IDS={"pt":"voice-pt","en":"voice-en"}
```

Geração automática nunca substitui um MP3 com `manually_uploaded=true`. O RSS localizado inclui
cada áudio definitivo como `enclosure`.

## Seed “Do Tejo ao Chiado”

A fixture versionada fica em `backend/app/fixtures/do_tejo_ao_chiado.json`. Ela cria, nessa
ordem, Almeida Garrett no Terreiro do Paço, Fernando Pessoa/Bernardo Soares na Rua dos
Douradores, Eça de Queirós na Rua Nova do Carmo e Alberto Pimentel no Chiado. A sequência inclui
introdução, três transições e encerramento.

O comando é idempotente e recusa qualquer ambiente fora de `development` e `staging`:

```bash
cd backend
ENVIRONMENT=development nix develop --command uv run python -m app.scripts.seed_narrative_routes
```

O registro do percurso é commitado antes de os jobs PT/EN serem enfileirados. Nenhum provedor é
chamado em migration ou deploy. O seed deixa a rota como rascunho com roteamento pendente; no
admin, recalcule, acompanhe os jobs de áudio, revise readiness e só então publique.

## Jornada e offline

O cliente separa os estados `preview`, `going_to_first_text`, `arrived`, `listening`, `walking` e
`completed`. A perna ativa é a única linha exibida durante a caminhada. A chegada automática usa
raio base de 35 m, considera precisão, exige duas leituras consecutivas e é suspensa acima de 60
m de precisão. “Cheguei” e “Abrir no mapa” permanecem disponíveis.

Áudio só começa após ação explícita. Bridges podem ser ouvidas durante a caminhada sem alterar a
etapa ativa. A sessão fica em `localStorage` e só é retomada quando a versão da rota coincide.

“Baixar percurso” guarda detalhe, geometria, textos, imagens e áudios em Cache Storage, mostra
tamanho/progresso e detecta versões novas ou downloads incompletos. GPS, áudio baixado e avanço
manual funcionam sem a API. Limitações da PWA:

- navegadores móveis podem suspender JavaScript, GPS e áudio com a tela bloqueada ou a PWA em
  background;
- navegação contínua em background não é prometida;
- recursos externos sem resposta CORS podem impedir o download e deixam o pacote incompleto;
- “Abrir no mapa” depende de um aplicativo externo e pode precisar de rede para calcular rota.

## Runbook de staging

1. aplique migrations com `nix develop --command uv run alembic upgrade head`;
2. configure ORS, ElevenLabs, storage de áudio, `ROUTE_REQUIRED_LANGUAGES` e vozes curatoriais;
3. execute o seed em `ENVIRONMENT=staging` e confirme que uma segunda execução não cria linhas;
4. no admin, confira ordem textual, PT/EN, bridges, waypoints e preview; recalcule e publique
   somente com readiness verde;
5. valide `GET /api/v1/routes?lang=pt|en`, detalhe, GPX e RSS no domínio de staging;
6. em um dispositivo real, baixe o percurso, desligue a rede depois do download, inicie, use
   “Cheguei”, ouça, avance e conclua;
7. confirme GPS negado/ruim, áudio ausente e ORS indisponível sem perda da última geometria;
8. registre URL, commit e resultado do smoke antes de qualquer promoção. Produção exige uma
   autorização separada.

## Verificação local

```bash
cd backend && nix develop --command uv run pytest
npm run shared:test
npm run test --workspace @ecosdelisboa/admin
npm run build --workspace @ecosdelisboa/admin
npm run test --workspace @ecosdelisboa/webapp
npm run lint --workspace @ecosdelisboa/webapp
npm run build --workspace @ecosdelisboa/webapp
npm run build-storybook --workspace @ecosdelisboa/webapp
npm run e2e
```
