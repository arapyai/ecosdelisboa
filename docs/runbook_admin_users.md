# Runbook de usuários administrativos

Este runbook cobre a criação do primeiro administrador no deploy, a operação da seção
**Usuários** e a recuperação de falhas de configuração. Senhas e chaves reais nunca devem ser
registradas neste repositório, em tickets ou em logs.

## Ordem do deploy do backend

O arquivo `backend/railway.toml` versiona o ciclo do serviço no Railway:

1. `uv run alembic upgrade head` aplica as migrations, incluindo `auth_version`;
2. `uv run python -m app.scripts.seed_admin` verifica se `admin_users` está vazia;
3. o Railway inicia `uv run uvicorn app.main:app --host 0.0.0.0 --port $PORT`.

O Railway executa `preDeployCommand` antes de iniciar a nova aplicação. A configuração em código
sobrescreve os mesmos campos configurados no painel. Consulte a
[documentação oficial de Config as Code](https://docs.railway.com/config-as-code) ao alterar esse
arquivo.

Confirme no serviço que o caminho do arquivo de configuração é `/backend/railway.toml` quando o
Railway não o detectar automaticamente a partir do diretório-fonte `backend/`.

## Variáveis obrigatórias

Configure como secrets distintos em staging e produção:

```env
ENVIRONMENT=staging
ADMIN_SECRET_KEY=<chave JWT aleatória>
ADMIN_INITIAL_EMAIL=<email do primeiro administrador>
ADMIN_INITIAL_PASSWORD=<senha inicial com pelo menos 12 caracteres>
```

Em produção, use `ENVIRONMENT=production`. O seed recusa `admin@example.com`, `change-me`, senhas
menores que 12 caracteres e emails inválidos nesses dois ambientes. O valor da senha não aparece
na saída do seed.

As variáveis `ADMIN_INITIAL_*` são somente um mecanismo de bootstrap. Depois que existir qualquer
linha em `admin_users`, inclusive uma conta inativa, novos deploys não criam, reativam nem alteram
usuários. Mudanças posteriores devem ser feitas na seção **Usuários** do admin.

## Verificação pós-deploy

1. Confirme nos logs que a migration terminou antes do seed.
2. Procure por uma destas mensagens, sem senha:
   - `Initial admin created: <email>` no primeiro deploy com banco vazio;
   - `Initial admin seed skipped: admin_users is not empty` nos deploys seguintes.
3. Verifique `GET /health` e a conexão com o banco.
4. Entre no admin com a conta inicial e abra **Usuários**.
5. Crie uma segunda conta ativa antes de testar bloqueio ou exclusão.
6. Redefina a senha inicial pelo painel; essa ação revoga todos os JWTs anteriores da conta.

## Falhas e recuperação

### Deploy para no seed

Leia a mensagem de erro sem tentar imprimir as variáveis. Corrija `ENVIRONMENT`,
`ADMIN_INITIAL_EMAIL` ou `ADMIN_INITIAL_PASSWORD` no ambiente correto e faça um novo deploy. Não
edite o banco manualmente para contornar a validação.

### O seed informa que a tabela não está vazia

Esse é o comportamento idempotente esperado. Se ninguém consegue entrar, verifique diretamente no
banco se há usuários inativos. O seed não cria uma conta paralela nesse caso. A recuperação exige
uma alteração auditada no estado de uma conta existente ou outro procedimento autorizado de
recuperação de acesso.

### Uma redefinição de senha encerra a sessão

É esperado: a operação incrementa `auth_version` e invalida imediatamente todos os tokens emitidos
antes da troca. Entre novamente com a nova senha.

### Rollback da aplicação

Reverter o commit de infraestrutura remove a automação dos deploys seguintes, mas não desfaz a
migration nem exclui usuários já criados. Não execute downgrade da migration ou exclusão manual de
contas em produção sem aprovação explícita. Para rollback de código, preserve a coluna
`auth_version` até que todas as versões em execução sejam compatíveis.

## Validação local

Dentro de `backend/`, com um banco descartável já migrado:

```bash
nix develop --command uv run alembic upgrade head
nix develop --command uv run python -m app.scripts.seed_admin
nix develop --command uv run python -m app.scripts.seed_admin
```

A primeira execução cria a conta; a segunda deve informar que a tabela não está vazia. Para testes
automatizados, use `nix develop --command uv run pytest tests/test_seed_admin.py`.
