import {
  type AdminAudioFile,
  type AdminAuthor,
  type AdminLanguage,
  type AdminLoginResponse,
  type AdminPoint,
  type AdminRoute,
  type AdminText,
  type AdminTranslation,
  type AdminUser,
  type AdminVoice,
} from '@ecosdelisboa/shared';
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import { fallbackUnlessAuth, isAuthError, redirectIfAuthError } from './adminApi';
import {
  ENABLE_MOCKS,
  TOKEN_KEY,
  autoSyncQueryOptions,
  client,
  queryClient
} from './adminConfig';
import { fallbackFor, fallbackLanguages, mockAudioFiles, mockAuthors, mockPoints, mockTexts, mockTranslations } from './adminMocks';
import { CsvPanel } from './csv/CsvPanel';
import { BatchJobTray } from './batches/BatchJobTray';
import { PronunciationPanel } from './pronunciation/PronunciationPanel';
import { TextFilters, filterResourceItems } from './texts/TextFilters';
import { TextVersionsEditor } from './texts/TextVersionsEditor';
import { TextsPanel } from './texts/TextsPanel';
import { UsersPanel } from './users/UsersPanel';
import { ResourceFields } from './resources/ResourceFields';
import { RouteEditor } from './routes/RouteEditor';
import { ReviewMapPanel } from './reviewMap/ReviewMapPanel';
import { columnsFor, draftFromItem, emptyDraft, formatCell, serializeDraft } from './resources/resourceModel';
import type {
  Draft,
  FieldContext,
  Resource,
  ResourceItem,
  Section
} from './adminTypes';

const resourceLabels: Record<Resource, string> = {
  authors: 'Autores',
  points: 'Pontos',
  texts: 'Textos',
  routes: 'Percursos'
};

const sectionLabels: Record<Section, string> = {
  csv: 'CSV',
  authors: resourceLabels.authors,
  points: resourceLabels.points,
  texts: resourceLabels.texts,
  routes: resourceLabels.routes,
  pronunciation: 'Pronúncias',
  'review-map': 'Mapa de revisão',
  users: 'Usuários',
};




function AdminApp() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '');

  function onLogin(nextToken: string) {
    localStorage.setItem(TOKEN_KEY, nextToken);
    setToken(nextToken);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    queryClient.clear();
    setToken('');
  }

  return token ? (
    <Dashboard token={token} onLogout={logout} />
  ) : (
    <Login onLogin={onLogin} />
  );
}

function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: () =>
      client.post<AdminLoginResponse>('/api/v1/admin/auth/login', {
        email,
        password
      }),
    onSuccess: (data) => onLogin(data.access_token),
    onError: () => setError('Login indisponível. Verifique se o backend está rodando e se as credenciais estão corretas.')
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    mutation.mutate();
  }

  return (
    <main className="login-screen">
      <section className="login-panel">
        <div className="admin-brand">
          <img src="/branding/literary-map-icon.png" alt="" />
          <div>
            <span>Administração</span>
            <h1>Lisboa por Outros</h1>
          </div>
        </div>
        <form onSubmit={submit}>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
          </label>
          <label>
            Senha
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'A entrar...' : 'Entrar'}
          </button>
        </form>
      </section>
    </main>
  );
}

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [section, setSection] = useState<Section>('authors');
  const [importedTextIds, setImportedTextIds] = useState<string[]>([]);
  const [reviewBatchId, setReviewBatchId] = useState<string>();
  const me = useQuery({
    queryKey: ['me', token],
    queryFn: () => client.get<AdminUser>('/api/v1/admin/auth/me', token),
    enabled: Boolean(token),
    retry: false
  });

  useEffect(() => {
    if (isAuthError(me.error)) onLogout();
  }, [me.error, onLogout]);

  return (
    <main className="admin-shell">
      <aside className="sidebar">
        <div className="admin-brand">
          <img src="/branding/literary-map-icon.png" alt="" />
          <div>
            <span>Admin</span>
            <h1>Lisboa por Outros</h1>
          </div>
        </div>
        <p>{me.data?.email ?? 'Sessão autenticada'}</p>
        <nav>
          {(Object.keys(sectionLabels) as Section[]).map((key) => (
            <button key={key} className={section === key ? 'active' : ''} type="button" onClick={() => setSection(key)}>
              {sectionLabels[key]}
            </button>
          ))}
        </nav>
        <button type="button" className="secondary-action" onClick={onLogout}>
          Sair
        </button>
      </aside>
      {section === 'csv' ? (
        <CsvPanel
          token={token}
          onAuthExpired={onLogout}
          onGenerate={(textIds) => {
            setImportedTextIds(textIds);
            setSection('texts');
          }}
        />
      ) : null}
      {section === 'pronunciation' ? (
        <PronunciationPanel token={token} onAuthExpired={onLogout} />
      ) : null}
      {section === 'users' && me.data ? (
        <UsersPanel currentUser={me.data} token={token} onAuthExpired={onLogout} />
      ) : null}
      {section === 'review-map' ? (
        <ReviewMapPanel token={token} onAuthExpired={onLogout} />
      ) : null}
      {section === 'texts' ? (
        <TextsPanel
          token={token}
          onAuthExpired={onLogout}
          importedTextIds={importedTextIds}
          reviewBatchId={reviewBatchId}
          onImportedTextIdsConsumed={() => setImportedTextIds([])}
        />
      ) : null}
      {section === 'routes' ? (
        <RouteEditor token={token} onAuthExpired={onLogout} />
      ) : null}
      {section !== 'csv' && section !== 'pronunciation' && section !== 'review-map' && section !== 'users' && section !== 'texts' && section !== 'routes' ? (
        <ResourcePanel token={token} resource={section} onAuthExpired={onLogout} />
      ) : null}
      <BatchJobTray
        token={token}
        onAuthExpired={onLogout}
        onReview={(batchId) => {
          setReviewBatchId(batchId);
          setSection('texts');
        }}
      />
    </main>
  );
}

function ResourcePanel({
  token,
  resource,
  onAuthExpired
}: {
  token: string;
  resource: Resource;
  onAuthExpired: () => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ResourceItem | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft(resource));
  const [isLocal, setIsLocal] = useState(false);
  const [textSearch, setTextSearch] = useState('');
  const [textLanguage, setTextLanguage] = useState('');
  const [textStatus, setTextStatus] = useState('');
  const [textOrigin, setTextOrigin] = useState('');
  const [textAudio, setTextAudio] = useState('');
  const [textGap, setTextGap] = useState('');

  useEffect(() => {
    setEditing(null);
    setDraft(emptyDraft(resource));
    setIsLocal(false);
    setTextSearch('');
    setTextLanguage('');
    setTextStatus('');
    setTextOrigin('');
    setTextAudio('');
    setTextGap('');
  }, [resource]);

  const query = useQuery({
    queryKey: ['admin-resource', resource, token],
    queryFn: async () => {
      try {
        setIsLocal(false);
        return await client.get<ResourceItem[]>(`/api/v1/admin/${resource}`, token);
      } catch (cause) {
        fallbackUnlessAuth(cause, null, onAuthExpired);
        setIsLocal(true);
        return fallbackFor(resource);
      }
    },
    ...autoSyncQueryOptions
  });

  const authorsQuery = useQuery({
    queryKey: ['admin-options', 'authors', token],
    queryFn: async () => {
      try {
        return await client.get<AdminAuthor[]>('/api/v1/admin/authors', token);
      } catch (cause) {
        return fallbackUnlessAuth(cause, mockAuthors, onAuthExpired);
      }
    },
    ...autoSyncQueryOptions
  });

  const pointsQuery = useQuery({
    queryKey: ['admin-options', 'points', token],
    queryFn: async () => {
      try {
        return await client.get<AdminPoint[]>('/api/v1/admin/points', token);
      } catch (cause) {
        return fallbackUnlessAuth(cause, mockPoints, onAuthExpired);
      }
    },
    ...autoSyncQueryOptions
  });

  const languagesQuery = useQuery({
    queryKey: ['admin-languages', token],
    queryFn: async () =>
      client
        .get<AdminLanguage[]>('/api/v1/admin/languages?active=true', token)
        .catch((cause) => fallbackUnlessAuth(cause, fallbackLanguages, onAuthExpired)),
    enabled: resource === 'texts',
    ...autoSyncQueryOptions
  });

  const translationsQuery = useQuery({
    queryKey: ['admin-translations', token],
    queryFn: async () =>
      client
        .get<AdminTranslation[]>('/api/v1/admin/translations', token)
        .catch((cause) => fallbackUnlessAuth(cause, mockTranslations, onAuthExpired)),
    enabled: resource === 'texts',
    ...autoSyncQueryOptions
  });

  const voicesQuery = useQuery({
    queryKey: ['admin-voices', token],
    queryFn: async () =>
      client
        .get<AdminVoice[]>('/api/v1/admin/voices', token)
        .catch((cause) => fallbackUnlessAuth(cause, [], onAuthExpired)),
    enabled: resource === 'texts',
    ...autoSyncQueryOptions
  });

  const audioQuery = useQuery({
    queryKey: ['admin-audio', token],
    queryFn: async () =>
      client
        .get<AdminAudioFile[]>('/api/v1/admin/audio', token)
        .catch((cause) => fallbackUnlessAuth(cause, mockAudioFiles, onAuthExpired)),
    enabled: resource === 'texts',
    ...autoSyncQueryOptions
  });

  const items = query.data ?? (ENABLE_MOCKS ? fallbackFor(resource) : []);
  const languages = languagesQuery.data ?? (ENABLE_MOCKS ? fallbackLanguages : []);
  const translations = translationsQuery.data ?? (ENABLE_MOCKS ? mockTranslations : []);
  const voices = voicesQuery.data ?? [];
  const audios = audioQuery.data ?? (ENABLE_MOCKS ? mockAudioFiles : []);
  const sourceLanguage = languages.find((language) => language.is_source)?.code ?? 'pt';
  const filteredItems = useMemo(
    () =>
      filterResourceItems(resource, items, {
        textSearch,
        textLanguage,
        textStatus,
        textOrigin,
        textAudio,
        textGap,
        translations,
        audios,
        sourceLanguage
      }),
    [audios, items, resource, sourceLanguage, textAudio, textGap, textLanguage, textOrigin, textSearch, textStatus, translations]
  );
  const metrics = useMemo(() => filteredItems.length, [filteredItems.length]);
  const fieldContext = useMemo<FieldContext>(
    () => ({
      authors: authorsQuery.data ?? (ENABLE_MOCKS ? mockAuthors : []),
      authorsReady: Boolean(authorsQuery.data),
      points: pointsQuery.data ?? (ENABLE_MOCKS ? mockPoints : []),
      pointsReady: Boolean(pointsQuery.data)
    }),
    [authorsQuery.data, pointsQuery.data]
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = serializeDraft(resource, draft);
      if (editing) {
        return client.put<ResourceItem>(`/api/v1/admin/${resource}/${editing.id}`, payload, token);
      }
      return client.post<ResourceItem>(`/api/v1/admin/${resource}`, payload, token);
    },
    onSuccess: (saved) => {
      const savedItem = editing ? ({ ...editing, ...saved, id: editing.id } as ResourceItem) : saved;
      queryClient.setQueryData<ResourceItem[]>(['admin-resource', resource, token], (current) => {
        const list = current ?? (ENABLE_MOCKS ? fallbackFor(resource) : []);
        if (editing) return list.map((item) => (item.id === editing.id ? savedItem : item));
        return [savedItem, ...list];
      });
      syncRelationshipOptions(savedItem);
      invalidateRelatedQueries();
      if (resource === 'texts') {
        setEditing(savedItem);
        setDraft(draftFromItem(resource, savedItem));
        return;
      }
      setEditing(null);
      setDraft(emptyDraft(resource));
    },
    onError: (cause) => {
      redirectIfAuthError(cause, onAuthExpired);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await client.delete<{ deleted: boolean }>(`/api/v1/admin/${resource}/${id}`, token);
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData<ResourceItem[]>(['admin-resource', resource, token], (current) =>
        (current ?? (ENABLE_MOCKS ? fallbackFor(resource) : [])).filter((item) => item.id !== id)
      );
      removeRelationshipOption(id);
      invalidateRelatedQueries();
    },
    onError: (cause) => {
      redirectIfAuthError(cause, onAuthExpired);
    }
  });

  function syncRelationshipOptions(saved: ResourceItem) {
    if (resource !== 'authors' && resource !== 'points') return;
    queryClient.setQueryData<ResourceItem[]>(['admin-options', resource, token], (current) => {
      const list = current ?? (ENABLE_MOCKS ? fallbackFor(resource) : []);
      if (editing) return list.map((item) => (item.id === editing.id ? { ...item, ...saved, id: editing.id } : item));
      return [{ ...saved, id: saved.id ?? `local-${Date.now()}` }, ...list];
    });
  }

  function removeRelationshipOption(id: string) {
    if (resource !== 'authors' && resource !== 'points') return;
    queryClient.setQueryData<ResourceItem[]>(['admin-options', resource, token], (current) =>
      (current ?? (ENABLE_MOCKS ? fallbackFor(resource) : [])).filter((item) => item.id !== id)
    );
  }

  function invalidateRelatedQueries() {
    queryClient.invalidateQueries({ queryKey: ['admin-resource', resource, token] });
    if (resource === 'authors') {
      queryClient.invalidateQueries({ queryKey: ['admin-options', 'authors', token] });
      queryClient.invalidateQueries({ queryKey: ['admin-resource', 'texts', token] });
    }
    if (resource === 'points') {
      queryClient.invalidateQueries({ queryKey: ['admin-options', 'points', token] });
      queryClient.invalidateQueries({ queryKey: ['admin-resource', 'texts', token] });
      queryClient.invalidateQueries({ queryKey: ['admin-resource', 'routes', token] });
    }
  }

  function edit(item: ResourceItem) {
    setEditing(item);
    setDraft(draftFromItem(resource, item));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    saveMutation.mutate(undefined);
  }

  return (
    <section className="content-panel">
      <div className="panel-heading">
        <div>
          <span>{resourceLabels[resource]}</span>
          <h2>{metrics} registos</h2>
          {isLocal ? <p>Usando mocks locais por flag explícita de desenvolvimento.</p> : null}
        </div>
      </div>

      {query.isError && !isLocal ? (
        <div className="admin-state error-state">
          <p>Não foi possível carregar {resourceLabels[resource].toLowerCase()}.</p>
          <button type="button" onClick={() => query.refetch()}>Tentar novamente</button>
        </div>
      ) : null}

      {resource === 'texts' ? (
        <TextFilters
          languages={languages}
          language={textLanguage}
          audio={textAudio}
          gap={textGap}
          origin={textOrigin}
          search={textSearch}
          status={textStatus}
          onAudio={setTextAudio}
          onGap={setTextGap}
          onLanguage={setTextLanguage}
          onOrigin={setTextOrigin}
          onSearch={setTextSearch}
          onStatus={setTextStatus}
        />
      ) : null}

      <form className="editor" onSubmit={submit}>
        <h3>{editing ? 'Editar' : 'Criar'} {resourceLabels[resource].toLowerCase()}</h3>
        <ResourceFields resource={resource} draft={draft} context={fieldContext} onDraft={setDraft} />
        {resource === 'texts' ? (
          <TextVersionsEditor
            baseDraft={draft}
            languages={languages}
            text={editing as AdminText | null}
            token={token}
            translations={translations}
            audios={audios}
            voices={voices}
            audioLoading={audioQuery.isLoading}
            audioError={audioQuery.isError}
            onAuthExpired={onAuthExpired}
            onBaseDraft={setDraft}
            onTranslationsChanged={() => translationsQuery.refetch()}
            onAudiosChanged={() => audioQuery.refetch()}
          />
        ) : null}
        <div className="form-actions">
          <button type="submit">{editing ? 'Guardar' : 'Criar'}</button>
          <button
            type="button"
            className="secondary-action"
            onClick={() => {
              setEditing(null);
              setDraft(emptyDraft(resource));
            }}
          >
            Limpar
          </button>
        </div>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columnsFor(resource).map((column) => (
                <th key={column}>{column}</th>
              ))}
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item) => (
              <tr key={item.id}>
                {columnsFor(resource).map((column) => (
                  <td key={column}>{formatCell(item, column, { translations, audios, sourceLanguage })}</td>
                ))}
                <td>
                  <div className="row-actions">
                    <button type="button" onClick={() => edit(item)}>
                      Editar
                    </button>
                    <button type="button" className="danger" onClick={() => deleteMutation.mutate(item.id)}>
                      Apagar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}





createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <AdminApp />
  </QueryClientProvider>
);
