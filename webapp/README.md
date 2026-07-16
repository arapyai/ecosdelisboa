# PWA pública

Experiência pública do Lisboa por Outros em React 19 e Vite. Inclui mapa, pontos, autores,
percursos, reprodução de áudio, seleção de idioma e suporte de cache offline. A validação offline
real e o polimento de lançamento permanecem acompanhados no GitHub Project.

O nome de pacote `@ecosdelisboa/webapp` é um identificador técnico legado.

## Desenvolvimento

Na raiz do monorepo:

```bash
npm install
npm run webapp:dev
npm run webapp:build
```

## Scripts do workspace

- `npm run dev`: Vite de desenvolvimento;
- `npm run build`: TypeScript e build de produção;
- `npm run preview`: serve o build localmente;
- `npm run lint`: ESLint;
- `npm run storybook`: catálogo de componentes;
- `npm run build-storybook`: build estático do Storybook.
