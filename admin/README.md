# Admin

Painel editorial interno do Lisboa por Outros em React 19, Vite e TanStack Query.

A interface atual oferece autenticação, CRUD inicial de autores, pontos, textos e percursos,
importação CSV e gestão básica de áudio. Edição multilíngue completa, mapas/geocoding,
import/export unificado e áudio integrado ao editor de texto continuam no roadmap; a existência
dos endpoints no backend não significa que a UI correspondente esteja pronta.

## Desenvolvimento

Na raiz do monorepo:

```bash
npm install
npm run admin:dev
npm run admin:build
```

Ou dentro deste workspace, use `npm run dev` e `npm run build`. Copie `.env.example` para `.env`
e configure `VITE_API_BASE_URL` quando não quiser usar o proxy local.

Dados mockados ficam desabilitados por padrão. Para desenvolvimento isolado, habilite explicitamente:

```env
VITE_ENABLE_MOCKS=true
```
