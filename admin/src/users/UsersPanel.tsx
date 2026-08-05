import { type AdminManagedUser, type AdminUser } from '@ecosdelisboa/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { redirectIfAuthError } from '../adminApi';
import { autoSyncQueryOptions, client } from '../adminConfig';
import { adminUserError, canDeleteAdmin, confirmsAdminEmail, formatAdminCreatedAt } from './userModel';

type EditorMode = 'create' | 'edit' | 'password' | null;

type UserDraft = {
  email: string;
  password: string;
  isActive: boolean;
};

const emptyDraft: UserDraft = { email: '', password: '', isActive: true };

export function UsersPanel({
  currentUser,
  token,
  onAuthExpired
}: {
  currentUser: AdminUser;
  token: string;
  onAuthExpired: () => void;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<EditorMode>(null);
  const [selected, setSelected] = useState<AdminManagedUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminManagedUser | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [draft, setDraft] = useState<UserDraft>(emptyDraft);
  const [error, setError] = useState('');

  const queryKey = ['admin-users', token] as const;
  const usersQuery = useQuery({
    queryKey,
    queryFn: () => client.get<AdminManagedUser[]>('/api/v1/admin/users', token),
    retry: false,
    ...autoSyncQueryOptions
  });

  function closeEditor() {
    setMode(null);
    setSelected(null);
    setDraft(emptyDraft);
    setError('');
  }

  function openCreate() {
    setMode('create');
    setSelected(null);
    setDraft(emptyDraft);
    setError('');
  }

  function openEdit(user: AdminManagedUser) {
    setMode('edit');
    setSelected(user);
    setDraft({ email: user.email, password: '', isActive: user.is_active });
    setError('');
  }

  function openPassword(user: AdminManagedUser) {
    setMode('password');
    setSelected(user);
    setDraft({ email: user.email, password: '', isActive: user.is_active });
    setError('');
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (mode === 'create') {
        return client.post<AdminManagedUser>(
          '/api/v1/admin/users',
          { email: draft.email, password: draft.password, is_active: draft.isActive },
          token
        );
      }
      if (mode === 'edit' && selected) {
        return client.put<AdminManagedUser>(
          `/api/v1/admin/users/${selected.id}`,
          { email: draft.email, is_active: draft.isActive },
          token
        );
      }
      if (mode === 'password' && selected) {
        return client.put<AdminManagedUser>(
          `/api/v1/admin/users/${selected.id}/password`,
          { password: draft.password },
          token
        );
      }
      throw new Error('Editor de usuário sem ação selecionada.');
    },
    onSuccess: async () => {
      if (mode === 'password' && selected?.id === currentUser.id) {
        onAuthExpired();
        return;
      }
      await queryClient.invalidateQueries({ queryKey });
      closeEditor();
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setError(adminUserError(cause));
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (user: AdminManagedUser) =>
      client.delete<{ deleted: boolean }>(`/api/v1/admin/users/${user.id}`, token),
    onSuccess: async () => {
      setDeleteTarget(null);
      setDeleteConfirmation('');
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setError(adminUserError(cause));
      setDeleteTarget(null);
      setDeleteConfirmation('');
    }
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    saveMutation.mutate();
  }

  const users = usersQuery.data ?? [];
  const actionsPending = saveMutation.isPending || deleteMutation.isPending;
  const editorTitle =
    mode === 'create'
      ? 'Criar usuário'
      : mode === 'password'
        ? 'Redefinir senha'
        : 'Editar usuário';

  return (
    <section className={`content-panel users-panel ${mode ? 'editor-open' : ''}`}>
      <div className="users-main">
        <div className="users-heading">
          <div>
            <h2>Usuários</h2>
            <p>Gerencie quem pode acessar o painel administrativo.</p>
          </div>
          <button type="button" onClick={openCreate}>Novo usuário</button>
        </div>

        {error ? <p className="users-error" role="alert">{error}</p> : null}
        {usersQuery.isError ? (
          <div className="admin-state error-state">
            <p>Não foi possível carregar os usuários.</p>
            <button type="button" onClick={() => usersQuery.refetch()}>Tentar novamente</button>
          </div>
        ) : null}

        <div className="table-wrap users-table-wrap" aria-busy={usersQuery.isLoading}>
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Status</th>
                <th>Criado em</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {usersQuery.isLoading ? (
                <tr><td colSpan={4}>Carregando usuários...</td></tr>
              ) : null}
              {!usersQuery.isLoading && users.length === 0 ? (
                <tr><td colSpan={4}>Nenhum usuário cadastrado.</td></tr>
              ) : null}
              {users.map((user) => (
                <tr key={user.id} className={selected?.id === user.id ? 'selected-row' : ''}>
                  <td>
                    <strong>{user.email}</strong>
                    {user.id === currentUser.id ? <small className="current-user-label">Você</small> : null}
                  </td>
                  <td>
                    <span className={`user-status ${user.is_active ? 'active' : 'inactive'}`}>
                      {user.is_active ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td>{formatAdminCreatedAt(user.created_at)}</td>
                  <td>
                    <div className="user-row-actions">
                      <button type="button" className="text-action" disabled={actionsPending} onClick={() => openEdit(user)}>Editar</button>
                      <button type="button" className="text-action" disabled={actionsPending} onClick={() => openPassword(user)}>Redefinir senha</button>
                      <button
                        type="button"
                        className="text-action delete-text-action"
                        disabled={actionsPending || !canDeleteAdmin(user, currentUser.id)}
                        title={user.id === currentUser.id ? 'Você não pode excluir a própria conta.' : undefined}
                        onClick={() => {
                          setDeleteTarget(user);
                          setDeleteConfirmation('');
                        }}
                      >
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!usersQuery.isLoading ? <p className="users-count">Mostrando {users.length} usuário{users.length === 1 ? '' : 's'}.</p> : null}
        </div>
      </div>

      {mode ? (
        <aside className="user-editor" aria-label={editorTitle}>
          <div className="user-editor-heading">
            <div>
              <h3>{editorTitle}</h3>
              <p>
                {mode === 'create'
                  ? 'Adicione uma nova pessoa ao painel.'
                  : mode === 'password'
                    ? `Defina uma nova senha para ${selected?.email}.`
                    : 'Atualize os dados e o acesso deste usuário.'}
              </p>
            </div>
            <button type="button" className="close-editor" aria-label="Fechar" onClick={closeEditor}>×</button>
          </div>

          <form onSubmit={submit}>
            {mode !== 'password' ? (
              <label>
                Email
                <input
                  type="email"
                  required
                  value={draft.email}
                  onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
                />
              </label>
            ) : null}
            {mode === 'create' || mode === 'password' ? (
              <label>
                {mode === 'create' ? 'Senha inicial' : 'Nova senha'}
                <input
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  value={draft.password}
                  onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))}
                />
                <small>Use pelo menos 12 caracteres.</small>
              </label>
            ) : null}
            {mode !== 'password' ? (
              <label className="user-active-field">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  disabled={selected?.id === currentUser.id}
                  onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))}
                />
                <span>
                  Usuário ativo
                  <small>Usuários inativos não conseguem acessar o painel.</small>
                </span>
              </label>
            ) : null}
            {error ? <p className="users-error" role="alert">{error}</p> : null}
            <div className="user-editor-actions">
              <button type="button" className="secondary-action" onClick={closeEditor}>Cancelar</button>
              <button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Salvando...' : mode === 'create' ? 'Criar usuário' : 'Salvar'}
              </button>
            </div>
          </form>
        </aside>
      ) : null}

      {deleteTarget ? (
        <div className="dialog-backdrop" role="presentation">
          <section className="delete-user-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-user-title">
            <h3 id="delete-user-title">Excluir usuário?</h3>
            <p>
              A conta <strong>{deleteTarget.email}</strong> será removida permanentemente e perderá o acesso imediatamente.
            </p>
            <label>
              Digite o email para confirmar
              <input
                type="email"
                value={deleteConfirmation}
                autoComplete="off"
                onChange={(event) => setDeleteConfirmation(event.target.value)}
              />
            </label>
            <div className="user-editor-actions">
              <button
                type="button"
                className="secondary-action"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteConfirmation('');
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="danger"
                disabled={deleteMutation.isPending || !confirmsAdminEmail(deleteTarget.email, deleteConfirmation)}
                onClick={() => deleteMutation.mutate(deleteTarget)}
              >
                {deleteMutation.isPending ? 'Excluindo...' : 'Excluir permanentemente'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
