import {
  ApiClient,
  ApiError,
  isEnvelope,
  type AdminAudioFile,
  type AdminAuthor,
  type AdminLanguage,
  type AdminLoginResponse,
  type AdminPoint,
  type AdminRoute,
  type AdminRouteItem,
  type AdminText,
  type AdminTranslation,
  type AdminUser,
  type AdminVoice,
  type SupportedLanguage,
  type TranslationStatus
} from '@ecosdelisboa/shared';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import maplibregl from 'maplibre-gl';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';

type Resource = 'authors' | 'points' | 'texts' | 'routes';
type Section = Resource | 'audio' | 'csv' | 'translations';
type ResourceItem = AdminAuthor | AdminPoint | AdminText | AdminRoute;
type DraftValue = string | number | boolean | null | AdminRouteItem[];
type Draft = Record<string, DraftValue>;
type FieldOption = { value: string; label: string };
type ImportPreviewRow = {
  row_number: number;
  author_name: string;
  title: string;
  action: 'create' | 'update' | 'error';
  errors: string[];
};
type ImportResult = {
  created: number;
  updated: number;
  errors: ImportPreviewRow[];
};
type FieldConfig = {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'checkbox' | 'number' | 'url' | 'select' | 'route-items';
  options?: FieldOption[];
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number | 'any';
};
type FieldContext = {
  authors: AdminAuthor[];
  authorsReady: boolean;
  points: AdminPoint[];
  pointsReady: boolean;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
const ENABLE_MOCKS = import.meta.env.VITE_ENABLE_MOCKS === 'true' || import.meta.env.STORYBOOK === 'true';
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY ?? '';
const ADMIN_MAP_STYLE_URL = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`
  : 'https://demotiles.maplibre.org/style.json';
const client = new ApiClient(API_BASE);
const queryClient = new QueryClient();
const TOKEN_KEY = 'ecosdelisboa.admin.token';
const autoSyncQueryOptions = {
  refetchOnWindowFocus: true,
  refetchOnReconnect: true
};

function isAuthError(cause: unknown) {
  return cause instanceof ApiError && (cause.status === 401 || cause.status === 403);
}

function fallbackUnlessAuth<T>(cause: unknown, fallback: T, onAuthExpired: () => void): T {
  if (isAuthError(cause)) {
    onAuthExpired();
    throw cause;
  }
  if (!ENABLE_MOCKS) throw cause;
  return fallback;
}

function redirectIfAuthError(cause: unknown, onAuthExpired: () => void) {
  if (!isAuthError(cause)) return false;
  onAuthExpired();
  return true;
}

function toQuery(params: Record<string, string | number | undefined | null>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}

function toAssetUrl(url?: string | null) {
  if (!url) return '';
  if (/^https?:\/\//.test(url)) return url;
  return `${API_BASE}${url}`;
}

async function postCsv<T>(path: string, file: File, token: string): Promise<T> {
  const body = new FormData();
  body.append('file', file);

  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    },
    body
  });

  if (!response.ok) {
    throw new ApiError(`Falha ao enviar CSV: ${path}`, response.status, path);
  }

  const payload = (await response.json()) as T;
  return isEnvelope(payload) ? payload.data : payload;
}

async function fetchCsvTemplate(token: string) {
  const path = '/api/v1/admin/points/import/template';
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) {
    throw new ApiError('Não foi possível baixar o modelo CSV.', response.status, path);
  }

  return response.blob();
}

const mockAuthors: AdminAuthor[] = [
  { id: 'author-pessoa', name: 'Fernando Pessoa', bio_pt: 'Poeta', birth_year: 1888, death_year: 1935 },
  { id: 'author-saramago', name: 'Jose Saramago', bio_pt: 'Romancista', birth_year: 1922, death_year: 2010 }
];

const mockPoints: AdminPoint[] = [
  {
    id: 'point-chiado',
    title_pt: 'Chiado',
    address: 'Largo do Chiado',
    neighborhood: 'Chiado',
    lat: 38.7107,
    lng: -9.1439
  },
  {
    id: 'point-alfama',
    title_pt: 'Alfama',
    address: 'Miradouro de Santa Luzia',
    neighborhood: 'Alfama',
    lat: 38.7117,
    lng: -9.1304
  }
];

const mockTexts: AdminText[] = [
  {
    id: 'text-chiado',
    point_id: 'point-chiado',
    author_id: 'author-pessoa',
    content_pt: 'Aqui a cidade tem passos de escritório, café e fantasma.',
    source_work: 'Fragmento demonstrativo',
    source_year: 2026,
    content_type: 'prose',
    origin: 'manual'
  }
];

const mockTranslations: AdminTranslation[] = [
  {
    id: 'translation-chiado-en',
    text_id: 'text-chiado',
    lang: 'en',
    content: 'Here the city has footsteps of office, cafe and ghost.',
    phonetic_content: null,
    status: 'approved',
    auto_translated: false,
    origin: 'manual',
    reviewed_by: 'admin@example.com',
    reviewed_at: null
  }
];

const mockRoutes: AdminRoute[] = [
  {
    id: 'route-baixa',
    title_pt: 'Baixa Literaria',
    description_pt: 'Percurso pelo centro',
    is_published: true,
    estimated_distance_m: 1800,
    estimated_duration_s: 3300,
    items: [{ position: 1, point_id: 'point-chiado' }]
  }
];

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
  translations: 'Traduções',
  audio: 'Áudios',
};

const fallbackLanguages: AdminLanguage[] = [
  { code: 'pt', locale: 'pt-PT', country_code: 'PT', name: 'Portuguese', is_active: true, is_source: true },
  { code: 'en', locale: 'en-US', country_code: 'US', name: 'English', is_active: true, is_source: false },
  { code: 'es', locale: 'es-ES', country_code: 'ES', name: 'Spanish', is_active: true, is_source: false },
  { code: 'fr', locale: 'fr-FR', country_code: 'FR', name: 'French', is_active: true, is_source: false },
  { code: 'de', locale: 'de-DE', country_code: 'DE', name: 'German', is_active: true, is_source: false },
  { code: 'zh', locale: 'zh-CN', country_code: 'CN', name: 'Chinese', is_active: true, is_source: false }
];

function fallbackFor(resource: Resource): ResourceItem[] {
  if (resource === 'authors') return mockAuthors;
  if (resource === 'points') return mockPoints;
  if (resource === 'texts') return mockTexts;
  return mockRoutes;
}

function emptyDraft(resource: Resource): Draft {
  if (resource === 'authors') {
    return { name: '', bio_pt: '', birth_year: '', death_year: '', photo_url: '', elevenlabs_voice_id: '' };
  }
  if (resource === 'points') {
    return {
      title_pt: '',
      address: '',
      neighborhood: '',
      lat: 38.7223,
      lng: -9.1393
    };
  }
  if (resource === 'texts') {
    return {
      point_id: '',
      author_id: '',
      content_pt: '',
      source_work: '',
      source_year: '',
      content_type: 'prose'
    };
  }
  return {
    title_pt: '',
    description_pt: '',
    cover_image_url: '',
    difficulty: 'easy',
    is_published: false,
    estimated_distance_m: '',
    estimated_duration_s: '',
    items: []
  };
}

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
            <span>Login Admin</span>
            <h1>Lisbon Literary Map</h1>
          </div>
        </div>
        <form onSubmit={submit}>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
          </label>
          <label>
            Password
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
            <h1>Lisbon Literary Map</h1>
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
      {section === 'translations' ? <TranslationsPanel token={token} onAuthExpired={onLogout} /> : null}
      {section === 'audio' ? <AudioPanel token={token} onAuthExpired={onLogout} /> : null}
      {section === 'csv' ? <CsvPanel token={token} onAuthExpired={onLogout} /> : null}
      {section !== 'audio' && section !== 'csv' && section !== 'translations' ? (
        <ResourcePanel token={token} resource={section} onAuthExpired={onLogout} />
      ) : null}
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
  const [textOrigin, setTextOrigin] = useState('');

  useEffect(() => {
    setEditing(null);
    setDraft(emptyDraft(resource));
    setIsLocal(false);
    setTextSearch('');
    setTextOrigin('');
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

  const items = query.data ?? (ENABLE_MOCKS ? fallbackFor(resource) : []);
  const filteredItems = useMemo(
    () => filterResourceItems(resource, items, { textSearch, textOrigin }),
    [items, resource, textOrigin, textSearch]
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
      queryClient.setQueryData<ResourceItem[]>(['admin-resource', resource, token], (current) => {
        const list = current ?? (ENABLE_MOCKS ? fallbackFor(resource) : []);
        if (editing) return list.map((item) => (item.id === editing.id ? { ...item, ...saved, id: editing.id } : item));
        return [saved, ...list];
      });
      syncRelationshipOptions(saved);
      invalidateRelatedQueries();
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
    saveMutation.mutate();
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
          origin={textOrigin}
          search={textSearch}
          onOrigin={setTextOrigin}
          onSearch={setTextSearch}
        />
      ) : null}

      <form className="editor" onSubmit={submit}>
        <h3>{editing ? 'Editar' : 'Criar'} {resourceLabels[resource].toLowerCase()}</h3>
        <ResourceFields resource={resource} draft={draft} context={fieldContext} onDraft={setDraft} />
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
                  <td key={column}>{formatCell(item, column)}</td>
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

function TextFilters({
  search,
  origin,
  onSearch,
  onOrigin
}: {
  search: string;
  origin: string;
  onSearch: (value: string) => void;
  onOrigin: (value: string) => void;
}) {
  return (
    <section className="filter-panel">
      <label>
        Filtrar conteúdo
        <input value={search} onChange={(event) => onSearch(event.target.value)} type="search" />
      </label>
      <label>
        Alterado manualmente
        <select value={origin} onChange={(event) => onOrigin(event.target.value)}>
          <option value="">Todos</option>
          <option value="manual">Sim</option>
          <option value="not_manual">Não</option>
        </select>
      </label>
    </section>
  );
}

function CsvPanel({ token, onAuthExpired }: { token: string; onAuthExpired: () => void }) {
  const queryClient = useQueryClient();
  const [downloadError, setDownloadError] = useState('');

  function invalidateImportQueries() {
    queryClient.invalidateQueries({ queryKey: ['admin-resource', 'authors', token] });
    queryClient.invalidateQueries({ queryKey: ['admin-resource', 'points', token] });
    queryClient.invalidateQueries({ queryKey: ['admin-resource', 'texts', token] });
    queryClient.invalidateQueries({ queryKey: ['admin-options', 'authors', token] });
    queryClient.invalidateQueries({ queryKey: ['admin-options', 'points', token] });
  }

  async function downloadTemplate() {
    setDownloadError('');
    try {
      const blob = await fetchCsvTemplate(token);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'content_import_template.csv';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      if (isAuthError(cause)) {
        onAuthExpired();
        return;
      }
      setDownloadError('Não foi possível baixar o modelo CSV.');
    }
  }

  return (
    <section className="content-panel">
      <div className="panel-heading">
        <div>
          <span>CSV</span>
          <h2>Importação de conteúdo</h2>
          <p>Use esta área para validar e importar pontos, autores e textos em lote.</p>
        </div>
        <button type="button" className="secondary-action" onClick={() => void downloadTemplate()}>
          Baixar modelo CSV
        </button>
      </div>
      {downloadError ? <p className="import-error standalone-error">{downloadError}</p> : null}
      <CsvImportPanel token={token} onAuthExpired={onAuthExpired} onImported={invalidateImportQueries} />
    </section>
  );
}

function filterResourceItems(
  resource: Resource,
  items: ResourceItem[],
  filters: { textSearch: string; textOrigin: string }
) {
  if (resource !== 'texts') return items;
  const normalizedSearch = filters.textSearch.trim().toLowerCase();
  return items.filter((item) => {
    const text = item as AdminText;
    const matchesSearch = !normalizedSearch || text.content_pt.toLowerCase().includes(normalizedSearch);
    const origin = text.origin ?? 'manual';
    const matchesOrigin =
      !filters.textOrigin ||
      (filters.textOrigin === 'not_manual' ? origin !== 'manual' : origin === filters.textOrigin);
    return matchesSearch && matchesOrigin;
  });
}

function TranslationsPanel({ token, onAuthExpired }: { token: string; onAuthExpired: () => void }) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [langFilter, setLangFilter] = useState('');
  const [editing, setEditing] = useState<AdminTranslation | null>(null);
  const [textId, setTextId] = useState('');
  const [lang, setLang] = useState<SupportedLanguage>('en');
  const [content, setContent] = useState('');
  const [phoneticContent, setPhoneticContent] = useState('');
  const [status, setStatus] = useState<TranslationStatus>('pending');
  const [message, setMessage] = useState('');

  const translationsQuery = useQuery({
    queryKey: ['admin-translations', token, statusFilter, langFilter],
    queryFn: async () => {
      const query = toQuery({ status: statusFilter, lang: langFilter });
      return client
        .get<AdminTranslation[]>(`/api/v1/admin/translations${query}`, token)
        .catch((cause) => fallbackUnlessAuth(cause, mockTranslations, onAuthExpired));
    },
    ...autoSyncQueryOptions
  });
  const textsQuery = useQuery({
    queryKey: ['admin-resource', 'texts', token],
    queryFn: async () =>
      client
        .get<AdminText[]>('/api/v1/admin/texts', token)
        .catch((cause) => fallbackUnlessAuth(cause, mockTexts, onAuthExpired)),
    ...autoSyncQueryOptions
  });
  const pointsQuery = useQuery({
    queryKey: ['admin-options', 'points', token],
    queryFn: async () =>
      client
        .get<AdminPoint[]>('/api/v1/admin/points', token)
        .catch((cause) => fallbackUnlessAuth(cause, mockPoints, onAuthExpired)),
    ...autoSyncQueryOptions
  });
  const authorsQuery = useQuery({
    queryKey: ['admin-options', 'authors', token],
    queryFn: async () =>
      client
        .get<AdminAuthor[]>('/api/v1/admin/authors', token)
        .catch((cause) => fallbackUnlessAuth(cause, mockAuthors, onAuthExpired)),
    ...autoSyncQueryOptions
  });
  const languagesQuery = useQuery({
    queryKey: ['admin-languages', token],
    queryFn: async () =>
      client
        .get<AdminLanguage[]>('/api/v1/admin/languages?active=true', token)
        .catch((cause) => fallbackUnlessAuth(cause, fallbackLanguages, onAuthExpired)),
    ...autoSyncQueryOptions
  });

  const translations = translationsQuery.data ?? (ENABLE_MOCKS ? mockTranslations : []);
  const texts = textsQuery.data ?? (ENABLE_MOCKS ? mockTexts : []);
  const points = pointsQuery.data ?? (ENABLE_MOCKS ? mockPoints : []);
  const authors = authorsQuery.data ?? (ENABLE_MOCKS ? mockAuthors : []);
  const languages = languagesQuery.data ?? (ENABLE_MOCKS ? fallbackLanguages : []);
  const targetLanguages = languages.filter((language) => !language.is_source);
  const filteredTranslations = useMemo(
    () =>
      translations.filter((translation) => {
        const matchesLang = !langFilter || translation.lang === langFilter;
        const matchesStatus = !statusFilter || translation.status === statusFilter;
        return matchesLang && matchesStatus;
      }),
    [langFilter, statusFilter, translations]
  );

  useEffect(() => {
    if (!textId && texts.length > 0) setTextId(texts[0].id);
  }, [textId, texts]);

  useEffect(() => {
    if (targetLanguages.length === 0 || targetLanguages.some((language) => language.code === lang)) return;
    setLang(targetLanguages[0].code);
  }, [lang, targetLanguages]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!textId) throw new Error('Selecione um texto antes de guardar a tradução.');
      if (!lang) throw new Error('Selecione uma língua antes de guardar a tradução.');
      return client.put<AdminTranslation>(
        `/api/v1/admin/translations/${textId}/${lang}/manual`,
        {
          content,
          phonetic_content: phoneticContent || null,
          status
        },
        token
      );
    },
    onSuccess: () => {
      setMessage('Tradução guardada.');
      clearEditor();
      queryClient.invalidateQueries({ queryKey: ['admin-translations', token] });
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível guardar.');
    }
  });

  const generateMutation = useMutation({
    mutationFn: () => {
      if (!textId) throw new Error('Selecione um texto antes de gerar a tradução.');
      if (!lang) throw new Error('Selecione uma língua antes de gerar a tradução.');
      return client.post<AdminTranslation>(`/api/v1/admin/translations/${textId}/${lang}`, {}, token);
    },
    onSuccess: (translation) => {
      setEditing(translation);
      setContent(translation.content ?? '');
      setPhoneticContent(translation.phonetic_content ?? '');
      setStatus(translation.status);
      setMessage('Tradução gerada. Reveja antes de aprovar.');
      queryClient.invalidateQueries({ queryKey: ['admin-translations', token] });
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível gerar.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (translationId: string) =>
      client.delete<{ deleted: boolean }>(`/api/v1/admin/translations/${translationId}`, token),
    onSuccess: () => {
      setMessage('Tradução apagada.');
      clearEditor();
      queryClient.invalidateQueries({ queryKey: ['admin-translations', token] });
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível apagar.');
    }
  });

  function editTranslation(translation: AdminTranslation) {
    setEditing(translation);
    setTextId(translation.text_id);
    setLang(translation.lang);
    setContent(translation.content ?? '');
    setPhoneticContent(translation.phonetic_content ?? '');
    setStatus(translation.status);
    setMessage('');
  }

  function clearEditor() {
    setEditing(null);
    setContent('');
    setPhoneticContent('');
    setStatus('pending');
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    saveMutation.mutate();
  }

  return (
    <section className="content-panel">
      <div className="panel-heading">
        <div>
          <span>Traduções</span>
          <h2>{filteredTranslations.length} registos</h2>
          <p>Crie, gere e reveja traduções dos textos literários por língua.</p>
        </div>
      </div>

      <section className="filter-panel">
        <label>
          Língua
          <select value={langFilter} onChange={(event) => setLangFilter(event.target.value)}>
            <option value="">Todas</option>
            {languages.map((language) => (
              <option key={language.code} value={language.code}>
                {language.code.toUpperCase()} · {language.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Estado
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">Todos</option>
            {translationStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      {translationsQuery.isError ? (
        <div className="admin-state error-state">
          <p>Não foi possível carregar traduções.</p>
          <button type="button" onClick={() => translationsQuery.refetch()}>Tentar novamente</button>
        </div>
      ) : null}

      <form className="editor" onSubmit={submit}>
        <h3>{editing ? 'Editar tradução' : 'Criar tradução'}</h3>
        <div className="field-grid">
          <label className="textarea-field">
            Texto original
            <select value={textId} onChange={(event) => setTextId(event.target.value)}>
              {texts.map((text) => (
                <option key={text.id} value={text.id}>{audioTextLabel(text, points, authors)}</option>
              ))}
            </select>
          </label>
          <label>
            Língua
            <select value={lang} onChange={(event) => setLang(event.target.value)}>
              {targetLanguages.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.code.toUpperCase()} · {language.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Estado
            <select value={status} onChange={(event) => setStatus(event.target.value as TranslationStatus)}>
              {translationStatusOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="textarea-field">
            Conteúdo traduzido
            <textarea value={content} onChange={(event) => setContent(event.target.value)} />
          </label>
          <label className="textarea-field">
            Conteúdo fonético
            <textarea value={phoneticContent} onChange={(event) => setPhoneticContent(event.target.value)} />
          </label>
        </div>
        <div className="form-actions">
          <button type="submit" disabled={!textId || !lang || saveMutation.isPending}>
            {saveMutation.isPending ? 'A guardar...' : 'Guardar'}
          </button>
          <button
            type="button"
            className="secondary-action"
            disabled={!textId || !lang || generateMutation.isPending}
            onClick={() => generateMutation.mutate()}
          >
            {generateMutation.isPending ? 'A gerar...' : 'Gerar com IA'}
          </button>
          <button type="button" className="secondary-action" onClick={clearEditor}>
            Limpar
          </button>
        </div>
        {message ? <p className="audio-message">{message}</p> : null}
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Texto</th>
              <th>Língua</th>
              <th>Estado</th>
              <th>Origem</th>
              <th>Conteúdo</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filteredTranslations.length === 0 ? <tr><td colSpan={6}>Nenhuma tradução registada.</td></tr> : null}
            {filteredTranslations.map((translation) => (
              <tr key={translation.id}>
                <td>{audioTextLabel(texts.find((text) => text.id === translation.text_id), points, authors)}</td>
                <td>{translation.lang.toUpperCase()}</td>
                <td>{translationStatusLabel(translation.status)}</td>
                <td>{originLabel(translation.origin ?? 'manual')}</td>
                <td>{translation.content ? translation.content.slice(0, 100) : '-'}</td>
                <td>
                  <div className="row-actions">
                    <button type="button" onClick={() => editTranslation(translation)}>
                      Editar
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => deleteMutation.mutate(translation.id)}
                    >
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

function AudioPanel({ token, onAuthExpired }: { token: string; onAuthExpired: () => void }) {
  const queryClient = useQueryClient();
  const [textId, setTextId] = useState('');
  const [lang, setLang] = useState<SupportedLanguage>('pt');
  const [voiceId, setVoiceId] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [duration, setDuration] = useState('');
  const [message, setMessage] = useState('');

  const textsQuery = useQuery({
    queryKey: ['admin-resource', 'texts', token],
    queryFn: async () =>
      client
        .get<AdminText[]>('/api/v1/admin/texts', token)
        .catch((cause) => fallbackUnlessAuth(cause, mockTexts, onAuthExpired)),
    ...autoSyncQueryOptions
  });
  const pointsQuery = useQuery({
    queryKey: ['admin-options', 'points', token],
    queryFn: async () =>
      client
        .get<AdminPoint[]>('/api/v1/admin/points', token)
        .catch((cause) => fallbackUnlessAuth(cause, mockPoints, onAuthExpired)),
    ...autoSyncQueryOptions
  });
  const authorsQuery = useQuery({
    queryKey: ['admin-options', 'authors', token],
    queryFn: async () =>
      client
        .get<AdminAuthor[]>('/api/v1/admin/authors', token)
        .catch((cause) => fallbackUnlessAuth(cause, mockAuthors, onAuthExpired)),
    ...autoSyncQueryOptions
  });
  const languagesQuery = useQuery({
    queryKey: ['admin-languages', token],
    queryFn: async () =>
      client
        .get<AdminLanguage[]>('/api/v1/admin/languages?active=true', token)
        .catch((cause) => fallbackUnlessAuth(cause, fallbackLanguages, onAuthExpired)),
    ...autoSyncQueryOptions
  });
  const voicesQuery = useQuery({
    queryKey: ['admin-voices', token],
    queryFn: async () =>
      client
        .get<AdminVoice[]>('/api/v1/admin/voices', token)
        .catch((cause) => fallbackUnlessAuth(cause, [], onAuthExpired)),
    ...autoSyncQueryOptions
  });
  const audioQuery = useQuery({
    queryKey: ['admin-audio', token],
    queryFn: async () =>
      client
        .get<AdminAudioFile[]>('/api/v1/admin/audio', token)
        .catch((cause) => fallbackUnlessAuth(cause, [], onAuthExpired)),
    ...autoSyncQueryOptions
  });

  const texts = textsQuery.data ?? (ENABLE_MOCKS ? mockTexts : []);
  const points = pointsQuery.data ?? (ENABLE_MOCKS ? mockPoints : []);
  const authors = authorsQuery.data ?? (ENABLE_MOCKS ? mockAuthors : []);
  const languages = languagesQuery.data ?? (ENABLE_MOCKS ? fallbackLanguages : []);
  const voices = voicesQuery.data ?? [];
  const audios = audioQuery.data ?? [];

  useEffect(() => {
    if (!textId && texts.length > 0) setTextId(texts[0].id);
  }, [textId, texts]);

  useEffect(() => {
    if (languages.length === 0 || languages.some((language) => language.code === lang)) return;
    setLang(languages.find((language) => language.is_source)?.code ?? languages[0].code);
  }, [lang, languages]);

  const generateMutation = useMutation({
    mutationFn: () => {
      if (!textId) throw new Error('Selecione um texto antes de gerar áudio.');
      return client.post<{ status: string; error?: string | null }>(
        `/api/v1/admin/audio/${textId}/${lang}/generate${toQuery({ voice_id: voiceId })}`,
        {},
        token
      );
    },
    onSuccess: (result) => {
      setMessage(result.error ? `Geração concluída com erro: ${result.error}` : `Geração ${result.status}.`);
      queryClient.invalidateQueries({ queryKey: ['admin-audio', token] });
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível gerar o áudio.');
    }
  });

  const uploadMutation = useMutation({
    mutationFn: () => {
      if (!textId) throw new Error('Selecione um texto antes de guardar áudio.');
      if (!manualUrl) throw new Error('Informe a URL pública do áudio.');
      return client.put<AdminAudioFile>(
        `/api/v1/admin/audio/${textId}/${lang}/upload`,
        { public_url: manualUrl, duration_s: duration ? Number(duration) : null, voice_id: voiceId || null },
        token
      );
    },
    onSuccess: () => {
      setMessage('Áudio manual guardado.');
      setManualUrl('');
      setDuration('');
      queryClient.invalidateQueries({ queryKey: ['admin-audio', token] });
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível guardar o áudio.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (audio: AdminAudioFile) => client.delete<{ deleted: boolean }>(`/api/v1/admin/audio/${audio.text_id}/${audio.lang}`, token),
    onSuccess: () => {
      setMessage('Áudio apagado.');
      queryClient.invalidateQueries({ queryKey: ['admin-audio', token] });
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível apagar o áudio.');
    }
  });

  return (
    <section className="content-panel">
      <div className="panel-heading">
        <div>
          <span>Áudios</span>
          <h2>{audios.length} ficheiros</h2>
          <p>Gere com ElevenLabs ou associe uma URL pública manualmente por texto e língua.</p>
        </div>
      </div>

      <section className="editor audio-editor">
        <h3>Preparar áudio</h3>
        <div className="field-grid">
          <label className="textarea-field">
            Texto
            <select value={textId} onChange={(event) => setTextId(event.target.value)}>
              {texts.map((text) => (
                <option key={text.id} value={text.id}>{audioTextLabel(text, points, authors)}</option>
              ))}
            </select>
          </label>
          <label>
            Língua
            <select value={lang} onChange={(event) => setLang(event.target.value)}>
              {languages.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.code.toUpperCase()} · {language.name}{language.is_source ? ' · fonte' : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            Voz
            <select value={voiceId} onChange={(event) => setVoiceId(event.target.value)}>
              <option value="">Fallback automático</option>
              {voices.map((voice) => (
                <option key={voice.id} value={voice.elevenlabs_id}>
                  {voice.name} · {voice.elevenlabs_id}{voice.languages?.length ? ` · ${voice.languages.join(', ')}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="textarea-field">
            URL pública do áudio
            <input value={manualUrl} onChange={(event) => setManualUrl(event.target.value)} type="url" />
          </label>
          <label>
            Duração s
            <input min={0} step="any" value={duration} onChange={(event) => setDuration(event.target.value)} type="number" />
          </label>
        </div>
        <div className="form-actions">
          <button type="button" disabled={!textId || generateMutation.isPending} onClick={() => generateMutation.mutate()}>
            {generateMutation.isPending ? 'A gerar...' : 'Gerar com IA'}
          </button>
          <button type="button" className="secondary-action" disabled={!textId || !manualUrl || uploadMutation.isPending} onClick={() => uploadMutation.mutate()}>
            {uploadMutation.isPending ? 'A guardar...' : 'Guardar URL manual'}
          </button>
        </div>
        {message ? <p className="audio-message">{message}</p> : null}
      </section>

      {audioQuery.isError ? (
        <div className="admin-state error-state">
          <p>Não foi possível carregar os áudios.</p>
          <button type="button" onClick={() => audioQuery.refetch()}>Tentar novamente</button>
        </div>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Texto</th>
              <th>Língua</th>
              <th>Origem</th>
              <th>Áudio</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {audios.length === 0 ? <tr><td colSpan={5}>Nenhum áudio registado.</td></tr> : null}
            {audios.map((audio) => {
              const publicUrl = toAssetUrl(audio.public_url);
              return (
                <tr key={audio.id}>
                  <td>{audioTextLabel(texts.find((text) => text.id === audio.text_id), points, authors)}</td>
                  <td>{audio.lang.toUpperCase()}</td>
                  <td>{audio.manually_uploaded ? 'Manual' : 'Gerado'}</td>
                  <td>{publicUrl ? <audio className="admin-audio-player" controls src={publicUrl} /> : '-'}</td>
                  <td><button type="button" className="danger" onClick={() => deleteMutation.mutate(audio)}>Apagar</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function audioTextLabel(text: AdminText | undefined, points: AdminPoint[], authors: AdminAuthor[]) {
  if (!text) return 'Texto não encontrado';
  const point = points.find((item) => item.id === text.point_id);
  const author = authors.find((item) => item.id === text.author_id);
  const title = point?.title_pt ?? text.content_pt.slice(0, 64);
  return `${title}${author ? ` · ${author.name}` : ''}`;
}

function CsvImportPanel({
  token,
  onAuthExpired,
  onImported
}: {
  token: string;
  onAuthExpired: () => void;
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewRow[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Selecione um CSV antes de gerar o preview.');
      return postCsv<ImportPreviewRow[]>('/api/v1/admin/points/import/preview', file, token);
    },
    onSuccess: (rows) => {
      setPreview(rows);
      setResult(null);
      setError('');
    },
    onError: (cause) => {
      if (isAuthError(cause)) {
        onAuthExpired();
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Não foi possível gerar o preview.');
    }
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Selecione um CSV antes de confirmar.');
      return postCsv<ImportResult>('/api/v1/admin/points/import/confirm', file, token);
    },
    onSuccess: (nextResult) => {
      setResult(nextResult);
      setPreview((current) => (nextResult.errors.length > 0 ? nextResult.errors : current));
      setError('');
      onImported();
    },
    onError: (cause) => {
      if (isAuthError(cause)) {
        onAuthExpired();
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Não foi possível confirmar a importação.');
    }
  });

  const hasBlockingErrors = preview.some((row) => row.errors.length > 0);
  const canConfirm = Boolean(file && preview.length > 0 && !hasBlockingErrors && !confirmMutation.isPending);

  function updateFile(nextFile?: File) {
    setFile(nextFile ?? null);
    setPreview([]);
    setResult(null);
    setError('');
  }

  return (
    <section className="import-panel">
      <div className="import-heading">
        <div>
          <span>Importação CSV</span>
          <h3>Adicionar pontos em lote</h3>
        </div>
        <p>Colunas obrigatórias: point_name, address, neighborhood, city, country, lat_override, lng_override, author_name, content_pt, content_type, source_work, source_year.</p>
      </div>

      <div className="import-actions">
        <label>
          Arquivo CSV
          <input accept=".csv,text/csv" type="file" onChange={(event) => updateFile(event.target.files?.[0])} />
        </label>
        <button type="button" className="secondary-action" disabled={!file || previewMutation.isPending} onClick={() => previewMutation.mutate()}>
          {previewMutation.isPending ? 'A validar...' : 'Gerar preview'}
        </button>
        <button type="button" disabled={!canConfirm} onClick={() => confirmMutation.mutate()}>
          {confirmMutation.isPending ? 'A importar...' : 'Confirmar importação'}
        </button>
      </div>

      {error ? <p className="import-error">{error}</p> : null}
      {result ? (
        <p className="import-summary">
          Importação concluída: {result.created} criados, {result.updated} atualizados
          {result.errors.length > 0 ? `, ${result.errors.length} linhas ignoradas` : ''}.
        </p>
      ) : null}

      {preview.length > 0 ? <ImportPreviewTable rows={preview} /> : null}
    </section>
  );
}

function ImportPreviewTable({ rows }: { rows: ImportPreviewRow[] }) {
  return (
    <div className="table-wrap import-preview">
      <table>
        <thead>
          <tr>
            <th>Linha</th>
            <th>Autor</th>
            <th>Ponto</th>
            <th>Ação</th>
            <th>Erros</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.row_number}-${row.title}`}>
              <td>{row.row_number}</td>
              <td>{row.author_name || '-'}</td>
              <td>{row.title || '-'}</td>
              <td>
                <span className={`status-pill ${row.action}`}>{importActionLabel(row.action)}</span>
              </td>
              <td>{row.errors.length > 0 ? row.errors.join('; ') : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function importActionLabel(action: ImportPreviewRow['action']) {
  if (action === 'create') return 'Criar';
  if (action === 'update') return 'Atualizar';
  return 'Corrigir';
}

function ResourceFields({
  resource,
  draft,
  context,
  onDraft
}: {
  resource: Resource;
  draft: Draft;
  context: FieldContext;
  onDraft: (draft: Draft) => void;
}) {
  const fields = fieldsFor(resource, context);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);

  useEffect(() => {
    const nextDraft = { ...draft };
    let changed = false;

    fields.forEach((field) => {
      if (field.type !== 'select') return;
      if (field.name === 'author_id' && resource === 'texts' && !context.authorsReady) return;
      if (field.name === 'point_id' && !context.pointsReady) return;
      const currentValue = String(draft[field.name] ?? '');
      if (!currentValue) return;
      if (field.options?.some((option) => option.value === currentValue)) return;
      nextDraft[field.name] = '';
      changed = true;
    });

    const currentItems = routeItemsFromDraft(draft.items);
    if (context.pointsReady && currentItems.length > 0) {
      const pointIds = new Set(context.points.map((point) => point.id));
      const nextItems = currentItems.map((item) => {
        if (!item.point_id || pointIds.has(item.point_id)) return item;
        changed = true;
        return { ...item, point_id: null };
      });
      nextDraft.items = nextItems;
    }

    if (changed) onDraft(nextDraft);
  }, [context.authorsReady, context.points, context.pointsReady, draft, fields, onDraft]);

  return (
    <>
      <div className="field-grid">
        {fields.map((field) =>
          field.type === 'route-items' ? (
            <div key={field.name} className={fieldClassName(field)}>
              <span>{field.label}</span>
              <RouteItemsEditor
                items={routeItemsFromDraft(draft[field.name])}
                points={context.points}
                onChange={(items) => onDraft({ ...draft, [field.name]: items })}
              />
            </div>
          ) : (
            <label key={field.name} className={fieldClassName(field)}>
            {field.type === 'checkbox' ? (
              <>
                <input
                  checked={Boolean(draft[field.name])}
                  onChange={(event) => onDraft({ ...draft, [field.name]: event.target.checked })}
                  type="checkbox"
                />
                <span>{field.label}</span>
              </>
            ) : (
              <>
                <span>{field.label}</span>
                {field.type === 'textarea' ? (
                  <textarea
                    value={String(draft[field.name] ?? '')}
                    placeholder={field.placeholder}
                    onChange={(event) => onDraft({ ...draft, [field.name]: event.target.value })}
                  />
                ) : field.type === 'select' ? (
                  <select
                    value={String(draft[field.name] ?? '')}
                    onChange={(event) => onDraft({ ...draft, [field.name]: event.target.value })}
                  >
                    {selectOptions(field, draft).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={String(draft[field.name] ?? '')}
                    onChange={(event) => onDraft({ ...draft, [field.name]: event.target.value })}
                    type={field.type}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    placeholder={field.placeholder}
                  />
                )}
              </>
            )}
            </label>
          )
        )}
      </div>
      {resource === 'points' ? (
        <div className="location-actions">
          <button type="button" className="secondary-action" onClick={() => setLocationPickerOpen(true)}>
            Selecionar no mapa
          </button>
        </div>
      ) : null}
      {locationPickerOpen ? (
        <LocationPickerDialog
          lat={Number(draft.lat)}
          lng={Number(draft.lng)}
          onClose={() => setLocationPickerOpen(false)}
          onSelect={(lat, lng) => onDraft({ ...draft, lat, lng })}
        />
      ) : null}
    </>
  );
}

function fieldsFor(resource: Resource, context: FieldContext): FieldConfig[] {
  if (resource === 'authors') {
    return [
      { name: 'name', label: 'Nome', type: 'text' },
      { name: 'bio_pt', label: 'Bio PT', type: 'textarea', placeholder: 'Resumo biográfico em português' },
      { name: 'birth_year', label: 'Ano de nascimento', type: 'number', min: 0, max: 2100, step: 1 },
      { name: 'death_year', label: 'Ano de morte', type: 'number', min: 0, max: 2100, step: 1 },
      { name: 'photo_url', label: 'Foto URL', type: 'url' },
      { name: 'elevenlabs_voice_id', label: 'Voz ElevenLabs', type: 'text', placeholder: 'ID da voz no ElevenLabs' }
    ];
  }
  if (resource === 'points') {
    return [
      { name: 'title_pt', label: 'Título PT', type: 'text' },
      { name: 'address', label: 'Morada', type: 'text' },
      { name: 'neighborhood', label: 'Bairro', type: 'text' },
      { name: 'lat', label: 'Latitude', type: 'number', min: -90, max: 90, step: 'any' },
      { name: 'lng', label: 'Longitude', type: 'number', min: -180, max: 180, step: 'any' }
    ];
  }
  if (resource === 'texts') {
    return [
      { name: 'point_id', label: 'Ponto', type: 'select', options: relationOptions(context.points, 'Selecione um ponto') },
      { name: 'author_id', label: 'Autor', type: 'select', options: relationOptions(context.authors, 'Selecione um autor') },
      { name: 'content_pt', label: 'Conteúdo PT', type: 'textarea', placeholder: 'Texto original em português' },
      { name: 'source_work', label: 'Obra', type: 'text', placeholder: 'Nome da obra ou fonte' },
      { name: 'source_year', label: 'Ano da obra', type: 'number', min: 0, max: 2100, step: 1 },
      { name: 'content_type', label: 'Tipo', type: 'select', options: contentTypeOptions }
    ];
  }
  return [
    { name: 'title_pt', label: 'Título PT', type: 'text' },
    { name: 'description_pt', label: 'Descrição PT', type: 'textarea', placeholder: 'Resumo curto do percurso' },
    { name: 'cover_image_url', label: 'Imagem de capa URL', type: 'url' },
    { name: 'difficulty', label: 'Dificuldade', type: 'select', options: difficultyOptions },
    { name: 'is_published', label: 'Publicado', type: 'checkbox' },
    { name: 'estimated_distance_m', label: 'Distância m', type: 'number', min: 0, step: 1 },
    { name: 'estimated_duration_s', label: 'Duração s', type: 'number', min: 0, step: 1 },
    { name: 'items', label: 'Etapas do percurso', type: 'route-items' }
  ];
}

function fieldClassName(field: FieldConfig) {
  if (field.type === 'checkbox') return 'checkbox-field';
  if (field.type === 'textarea' || field.type === 'route-items') return 'textarea-field';
  return undefined;
}

function LocationPickerDialog({
  lat,
  lng,
  onClose,
  onSelect
}: {
  lat: number;
  lng: number;
  onClose: () => void;
  onSelect: (lat: number, lng: number) => void;
}) {
  const currentLat = Number.isFinite(lat) ? lat : 38.7223;
  const currentLng = Number.isFinite(lng) ? lng : -9.1393;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      attributionControl: false,
      center: [currentLng, currentLat],
      container: containerRef.current,
      style: ADMIN_MAP_STYLE_URL,
      zoom: 14
    });
    const marker = new maplibregl.Marker({ color: '#c45732', draggable: true })
      .setLngLat([currentLng, currentLat])
      .addTo(map);

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    marker.on('dragend', () => {
      const nextLocation = marker.getLngLat();
      onSelectRef.current(Number(nextLocation.lat.toFixed(6)), Number(nextLocation.lng.toFixed(6)));
    });
    map.on('click', (event) => {
      marker.setLngLat(event.lngLat);
      onSelectRef.current(Number(event.lngLat.lat.toFixed(6)), Number(event.lngLat.lng.toFixed(6)));
    });

    mapRef.current = map;
    markerRef.current = marker;

    return () => {
      marker.remove();
      map.remove();
      markerRef.current = null;
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    markerRef.current?.setLngLat([currentLng, currentLat]);
    mapRef.current?.easeTo({ center: [currentLng, currentLat], duration: 250 });
  }, [currentLat, currentLng]);

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="location-dialog" role="dialog" aria-modal="true" aria-label="Selecionar localização">
        <div className="dialog-heading">
          <div>
            <span>Localização</span>
            <h3>Selecionar coordenadas</h3>
          </div>
          <button type="button" className="secondary-action" onClick={onClose}>Fechar</button>
        </div>
        <div ref={containerRef} className="coordinate-map" />
        <p className="coordinate-readout">
          Clique no mapa ou arraste o marcador. Lat {currentLat.toFixed(6)} · Lng {currentLng.toFixed(6)}
        </p>
      </section>
    </div>
  );
}

function RouteItemsEditor({
  items,
  points,
  onChange
}: {
  items: AdminRouteItem[];
  points: AdminPoint[];
  onChange: (items: AdminRouteItem[]) => void;
}) {
  const pointOptions = relationOptions(points, 'Sem ponto cadastrado');

  function addItem() {
    onChange([
      ...items,
      {
        position: items.length + 1,
        point_id: '',
        waypoint_lat: null,
        waypoint_lng: null,
        transition_text_pt: ''
      }
    ]);
  }

  function updateItem(index: number, nextItem: AdminRouteItem) {
    onChange(items.map((item, currentIndex) => (currentIndex === index ? nextItem : item)));
  }

  function removeItem(index: number) {
    onChange(items.filter((_, currentIndex) => currentIndex !== index).map((item, currentIndex) => ({ ...item, position: currentIndex + 1 })));
  }

  return (
    <div className="route-items-editor">
      {items.length === 0 ? <p>Nenhuma etapa adicionada.</p> : null}
      {items.map((item, index) => (
        <div className="route-item-row" key={item.id ?? index}>
          <label>
            Ordem
            <input
              min={1}
              type="number"
              value={item.position}
              onChange={(event) => updateItem(index, { ...item, position: Number(event.target.value) })}
            />
          </label>
          <label>
            Ponto
            <select
              value={item.point_id ?? ''}
              onChange={(event) => updateItem(index, { ...item, point_id: event.target.value || null })}
            >
              {selectOptions(
                { name: 'point_id', label: 'Ponto', type: 'select', options: pointOptions },
                { point_id: item.point_id ?? '' }
              ).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Latitude manual
            <input
              max={90}
              min={-90}
              step="any"
              type="number"
              value={item.waypoint_lat ?? ''}
              onChange={(event) => updateItem(index, { ...item, waypoint_lat: nullableNumber(event.target.value) })}
            />
          </label>
          <label>
            Longitude manual
            <input
              max={180}
              min={-180}
              step="any"
              type="number"
              value={item.waypoint_lng ?? ''}
              onChange={(event) => updateItem(index, { ...item, waypoint_lng: nullableNumber(event.target.value) })}
            />
          </label>
          <label className="route-transition-field">
            Texto de transição PT
            <textarea
              placeholder="Narração entre esta etapa e a seguinte"
              value={item.transition_text_pt ?? ''}
              onChange={(event) => updateItem(index, { ...item, transition_text_pt: event.target.value })}
            />
          </label>
          <button className="danger" type="button" onClick={() => removeItem(index)}>
            Remover
          </button>
        </div>
      ))}
      <button className="secondary-action" type="button" onClick={addItem}>
        Adicionar etapa
      </button>
    </div>
  );
}

const contentTypeOptions: FieldOption[] = [
  { value: 'prose', label: 'Prosa' },
  { value: 'poetry', label: 'Poesia' },
  { value: 'lyrics', label: 'Letra de música' }
];

const difficultyOptions: FieldOption[] = [
  { value: '', label: 'Sem dificuldade definida' },
  { value: 'easy', label: 'Fácil' },
  { value: 'medium', label: 'Média' },
  { value: 'hard', label: 'Difícil' }
];

const translationStatusOptions: Array<{ value: TranslationStatus; label: string }> = [
  { value: 'pending', label: 'Pendente' },
  { value: 'approved', label: 'Aprovada' },
  { value: 'rejected', label: 'Rejeitada' }
];

function relationOptions(items: Array<{ id: string; name?: string; title_pt?: string }>, emptyLabel: string): FieldOption[] {
  return [
    { value: '', label: emptyLabel },
    ...items.map((item) => ({
      value: item.id,
      label: item.name ?? item.title_pt ?? item.id
    }))
  ];
}

function selectOptions(field: FieldConfig, draft: Draft): FieldOption[] {
  return field.options ?? [];
}

function columnsFor(resource: Resource) {
  if (resource === 'authors') return ['name', 'bio_pt', 'birth_year'];
  if (resource === 'points') return ['title_pt', 'neighborhood', 'lat', 'lng'];
  if (resource === 'texts') return ['content_pt', 'origin', 'author_id', 'source_work', 'content_type'];
  return ['title_pt', 'is_published', 'estimated_distance_m', 'estimated_duration_s'];
}

function formatCell(item: ResourceItem, column: string) {
  const value = (item as unknown as Record<string, unknown>)[column];
  if (column === 'origin') return originLabel(String(value || 'manual'));
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (value === null || value === undefined || value === '') return '-';
  return String(value).slice(0, 100);
}

function originLabel(origin: string) {
  if (origin === 'import') return 'CSV';
  if (origin === 'automatic') return 'Automático';
  return 'Manual';
}

function translationStatusLabel(status: TranslationStatus) {
  if (status === 'approved') return 'Aprovada';
  if (status === 'rejected') return 'Rejeitada';
  return 'Pendente';
}

function draftFromItem(resource: Resource, item: ResourceItem): Draft {
  const draft = emptyDraft(resource);
  Object.keys(draft).forEach((key) => {
    const value = (item as unknown as Record<string, unknown>)[key];
    if (value !== undefined) draft[key] = key === 'items' ? routeItemsFromDraft(value) : (value as DraftValue);
  });
  return draft;
}

function serializeDraft(resource: Resource, draft: Draft) {
  const clean = Object.fromEntries(
    Object.entries(draft).map(([key, value]) => {
      if (value === '') return [key, null];
      if (['birth_year', 'death_year', 'source_year', 'estimated_distance_m', 'estimated_duration_s', 'lat', 'lng'].includes(key)) {
        return [key, value === null ? null : Number(value)];
      }
      return [key, value];
    })
  );

  if (resource === 'routes') {
    return {
      ...clean,
      items: routeItemsFromDraft(draft.items)
        .map((item) => ({
          ...item,
          point_id: item.point_id || null,
          waypoint_lat: item.waypoint_lat ?? null,
          waypoint_lng: item.waypoint_lng ?? null,
          transition_text_pt: item.transition_text_pt || null
        }))
        .filter((item) => item.point_id || (item.waypoint_lat !== null && item.waypoint_lng !== null))
    };
  }

  return clean;
}

function routeItemsFromDraft(value: unknown): AdminRouteItem[] {
  return Array.isArray(value) ? (value as AdminRouteItem[]) : [];
}

function nullableNumber(value: string) {
  return value === '' ? null : Number(value);
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <AdminApp />
  </QueryClientProvider>
);
