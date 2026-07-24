# Mobile

Fundação Expo/React Native para os aplicativos Android e iOS do Lisboa por Outros.

Os apps são uma etapa posterior ao MVP PWA + admin. Este workspace não deve ser descrito como
uma experiência mobile pronta ou com paridade funcional até a conclusão dos cartões pós-MVP.

## Desenvolvimento

```bash
npm install
npm run mobile:start
```

Configure `EXPO_PUBLIC_API_BASE_URL` a partir de `.env.example`.

Dados mockados ficam desabilitados por padrão. Para desenvolvimento isolado, habilite explicitamente:

```env
EXPO_PUBLIC_ENABLE_MOCKS=true
```
