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

## Configuração de cidade

O webapp lê a identidade e localização base da cidade por variáveis `VITE_*`. Se alguma delas não
existir, o fallback continua sendo Lisboa.

```env
VITE_APP_NAME=Lisbon Literary Map
VITE_CITY_NAME=Lisboa
VITE_CITY_SLUG=lisboa
VITE_CITY_DEFAULT_LAT=38.7223
VITE_CITY_DEFAULT_LNG=-9.1393
VITE_MAP_CENTER_LAT=38.7223
VITE_MAP_CENTER_LNG=-9.1393
VITE_MAP_ZOOM=12.2
VITE_MAP_DEFAULT_RADIUS=1500
```

## Scripts do workspace

- `npm run dev`: Vite de desenvolvimento;
- `npm run build`: TypeScript e build de produção;
- `npm run preview`: serve o build localmente;
- `npm run lint`: ESLint;
- `npm run storybook`: catálogo de componentes;
- `npm run build-storybook`: build estático do Storybook.
