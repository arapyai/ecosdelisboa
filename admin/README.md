# Admin

Painel editorial interno do Lisboa por Outros em React 19, Vite e TanStack Query.

A interface atual oferece autenticação, CRUD de autores, pontos, textos, percursos e usuários
administrativos, importação CSV, edição multilíngue, mapas/geocoding e gestão de áudio e
pronúncias. A existência de outros endpoints no backend não significa que a UI correspondente
esteja pronta.

## Mapa de revisão

A seção **Mapa de revisão** consulta `/api/v1/admin/review-map/preview`, mostra todos os pontos
com seus códigos permanentes e permite baixar o pacote gerado por
`POST /api/v1/admin/review-map/export`. O usuário escolhe papel A0-A4 e uma grade de 1x1 a 4x4;
o território completo é dividido entre as folhas e a planilha XLSX é sempre incluída. Alertas de
coordenadas distantes ou inválidas permanecem visíveis antes do download.

## Gestão de usuários

A seção **Usuários** é carregada apenas depois de `/api/v1/admin/auth/me` identificar o usuário
da sessão. Ela consome os seguintes endpoints, todos protegidos por Bearer JWT:

- `GET /api/v1/admin/users`: lista as contas;
- `POST /api/v1/admin/users`: cria uma conta com email, senha inicial e estado ativo;
- `PUT /api/v1/admin/users/{id}`: altera email e estado ativo;
- `PUT /api/v1/admin/users/{id}/password`: redefine a senha e revoga os tokens anteriores;
- `DELETE /api/v1/admin/users/{id}`: exclui a conta permanentemente.

O painel usa uma tabela com um editor lateral em telas largas e empilha o editor abaixo da tabela
em telas menores. As operações atualizam o cache `admin-users` do TanStack Query somente depois
da confirmação do backend. Não adicione fallback mockado para esta seção: falhas de autenticação
ou indisponibilidade precisam permanecer visíveis.

Proteções importantes:

- o usuário atual não pode desativar nem excluir a própria conta;
- redefinir a própria senha encerra a sessão local após o sucesso;
- ações da tabela ficam bloqueadas enquanto uma mutação está em andamento;
- exclusão permanente exige confirmação mostrando o email afetado;
- senhas novas precisam ter entre 12 e 128 caracteres.

Para estender a tela, mantenha a composição em `src/users/UsersPanel.tsx`, regras puras e
formatadores em `src/users/userModel.ts` e os tipos de contrato no workspace `shared`. Regras de
segurança continuam obrigatoriamente no backend; estados desabilitados no frontend são apenas uma
segunda barreira de UX.

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
