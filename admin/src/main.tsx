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
  type TextOrigin,
  type TranslationStatus
} from '@ecosdelisboa/shared';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import maplibregl from 'maplibre-gl';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import { mergeTranslationDrafts, translationToDraft, type TextVersionDraft } from './textVersionDrafts';
import './styles.css';

type Resource = 'authors' | 'points' | 'texts' | 'routes';
type Section = Resource | 'csv';
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

type GeocodingFeature = {
  id: string;
  text?: string;
  place_name?: string;
  center?: [number, number];
  context?: Array<{ id?: string; text?: string }>;
  place_type?: string[];
};

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
const ENABLE_MOCKS = import.meta.env.VITE_ENABLE_MOCKS === 'true' || import.meta.env.STORYBOOK === 'true';
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY ?? '';
const ADMIN_MAP_STYLE_URL = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`
  : 'https://demotiles.maplibre.org/style.json';
const ADMIN_DEFAULT_LAT = Number(import.meta.env.VITE_CITY_DEFAULT_LAT ?? import.meta.env.VITE_MAP_CENTER_LAT ?? 38.7223);
const ADMIN_DEFAULT_LNG = Number(import.meta.env.VITE_CITY_DEFAULT_LNG ?? import.meta.env.VITE_MAP_CENTER_LNG ?? -9.1393);
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


async function putMp3<T>(path: string, file: File, token: string): Promise<T> {
  const body = new FormData();
  body.append('file', file);

  const response = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    },
    body
  });

  if (!response.ok) {
    throw new ApiError(`Falha ao enviar MP3: ${path}`, response.status, path);
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


const mockAudioFiles: AdminAudioFile[] = [];

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
      lat: ADMIN_DEFAULT_LAT,
      lng: ADMIN_DEFAULT_LNG
    };
  }
  if (resource === 'texts') {
    return {
      point_id: '',
      author_id: '',
      content_pt: '',
      phonetic_content: '',
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
      {section === 'csv' ? <CsvPanel token={token} onAuthExpired={onLogout} /> : null}
      {section !== 'csv' ? (
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

function TextFilters({
  search,
  language,
  status,
  origin,
  audio,
  gap,
  languages,
  onSearch,
  onLanguage,
  onStatus,
  onOrigin,
  onAudio,
  onGap
}: {
  search: string;
  language: string;
  status: string;
  origin: string;
  audio: string;
  gap: string;
  languages: AdminLanguage[];
  onSearch: (value: string) => void;
  onLanguage: (value: string) => void;
  onStatus: (value: string) => void;
  onOrigin: (value: string) => void;
  onAudio: (value: string) => void;
  onGap: (value: string) => void;
}) {
  return (
    <section className="filter-panel">
      <label>
        Filtrar conteúdo
        <input value={search} onChange={(event) => onSearch(event.target.value)} type="search" />
      </label>
      <label>
        Idioma
        <select value={language} onChange={(event) => onLanguage(event.target.value)}>
          <option value="">Todos</option>
          {languages.map((item) => (
            <option key={item.code} value={item.code}>{languageLabel(item)}</option>
          ))}
        </select>
      </label>
      <label>
        Estado
        <select value={status} onChange={(event) => onStatus(event.target.value)}>
          <option value="">Todos</option>
          {translationStatusOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <label>
        Origem
        <select value={origin} onChange={(event) => onOrigin(event.target.value)}>
          <option value="">Todas</option>
          {originOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>

      <label>
        Áudio
        <select value={audio} onChange={(event) => onAudio(event.target.value)}>
          <option value="">Todos</option>
          <option value="missing">Sem áudio</option>
          <option value="automatic">Gerado automaticamente</option>
          <option value="manual">Enviado manualmente</option>
        </select>
      </label>
      <label>
        Lacunas PT/EN
        <select value={gap} onChange={(event) => onGap(event.target.value)}>
          <option value="">Todas</option>
          <option value="missing-text-pt">Sem texto PT</option>
          <option value="missing-audio-pt">Sem áudio PT</option>
          <option value="missing-text-en">Sem tradução EN</option>
          <option value="missing-audio-en">Sem áudio EN</option>
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
  filters: {
    textSearch: string;
    textLanguage: string;
    textStatus: string;
    textOrigin: string;
    textAudio: string;
    textGap: string;
    translations: AdminTranslation[];
    audios: AdminAudioFile[];
    sourceLanguage: string;
  }
) {
  if (resource !== 'texts') return items;
  const normalizedSearch = filters.textSearch.trim().toLowerCase();
  return items.filter((item) => {
    const text = item as AdminText;
    const textTranslations = filters.translations.filter((translation) => translation.text_id === text.id);
    const textAudios = filters.audios.filter((audio) => audio.text_id === text.id);
    const sourceOrigin = text.origin ?? 'manual';
    const matchesSearch = !normalizedSearch || text.content_pt.toLowerCase().includes(normalizedSearch);
    const matchesLanguage = matchesTextLanguage(text, textTranslations, filters.textLanguage, filters.sourceLanguage);
    const matchesStatus = !filters.textStatus || textTranslations.some((translation) => translation.status === filters.textStatus);
    const matchesOrigin =
      !filters.textOrigin ||
      sourceOrigin === filters.textOrigin ||
      textTranslations.some((translation) => translation.origin === filters.textOrigin);
    const matchesAudio = matchesAudioFilter(textAudios, filters.textLanguage, filters.textAudio);
    const matchesGap = matchesGapFilter(text, textTranslations, textAudios, filters.textGap, filters.sourceLanguage);
    return matchesSearch && matchesLanguage && matchesStatus && matchesOrigin && matchesAudio && matchesGap;
  });
}

function matchesTextLanguage(
  text: AdminText,
  translations: AdminTranslation[],
  language: string,
  sourceLanguage: string
) {
  if (!language) return true;
  if (language === sourceLanguage) return Boolean(text.content_pt.trim());
  return translations.some((translation) => translation.lang === language);
}

function matchesAudioFilter(audios: AdminAudioFile[], language: string, audioFilter: string) {
  if (!audioFilter) return true;
  const scopedAudios = language ? audios.filter((audio) => audio.lang === language) : audios;
  if (audioFilter === 'missing') return scopedAudios.length === 0;
  if (audioFilter === 'manual') return scopedAudios.some((audio) => audio.manually_uploaded);
  if (audioFilter === 'automatic') return scopedAudios.some((audio) => !audio.manually_uploaded);
  return true;
}

function matchesGapFilter(
  text: AdminText,
  translations: AdminTranslation[],
  audios: AdminAudioFile[],
  gap: string,
  sourceLanguage: string
) {
  if (!gap) return true;
  if (gap === 'missing-text-pt') return !text.content_pt.trim();
  if (gap === 'missing-audio-pt') return !audios.some((audio) => audio.lang === 'pt');
  if (gap === 'missing-text-en') {
    return sourceLanguage === 'en'
      ? !text.content_pt.trim()
      : !translations.some((translation) => translation.lang === 'en');
  }
  if (gap === 'missing-audio-en') return !audios.some((audio) => audio.lang === 'en');
  return true;
}


function TextVersionsEditor({
  baseDraft,
  languages,
  text,
  token,
  translations,
  audios,
  voices,
  audioLoading,
  audioError,
  onAuthExpired,
  onBaseDraft,
  onTranslationsChanged,
  onAudiosChanged
}: {
  baseDraft: Draft;
  languages: AdminLanguage[];
  text: AdminText | null;
  token: string;
  translations: AdminTranslation[];
  audios: AdminAudioFile[];
  voices: AdminVoice[];
  audioLoading: boolean;
  audioError: boolean;
  onAuthExpired: () => void;
  onBaseDraft: (draft: Draft) => void;
  onTranslationsChanged: () => void;
  onAudiosChanged: () => void;
}) {
  const sourceLanguage = languages.find((language) => language.is_source)?.code ?? 'pt';
  const editableLanguages = languages.length > 0 ? languages : fallbackLanguages;
  const [activeLang, setActiveLang] = useState(sourceLanguage);
  const [versionDrafts, setVersionDrafts] = useState<Record<string, TextVersionDraft>>({});
  const [message, setMessage] = useState('');

  const textTranslations = useMemo(
    () => (text ? translations.filter((translation) => translation.text_id === text.id) : []),
    [text, translations]
  );
  const textAudios = useMemo(
    () => (text ? audios.filter((audio) => audio.text_id === text.id) : []),
    [audios, text]
  );
  const activeTranslation = textTranslations.find((translation) => translation.lang === activeLang);
  const activeAudio = textAudios.find((audio) => audio.lang === activeLang);
  const activeDraft = versionDrafts[activeLang] ?? translationToDraft(activeTranslation);
  const activeLanguage = editableLanguages.find((language) => language.code === activeLang);
  const isSource = activeLang === sourceLanguage;
  const sourceOrigin = text?.origin ?? 'manual';

  useEffect(() => {
    if (editableLanguages.some((language) => language.code === activeLang)) return;
    setActiveLang(sourceLanguage);
  }, [activeLang, editableLanguages, sourceLanguage]);

  useEffect(() => {
    setVersionDrafts((current) => mergeTranslationDrafts(current, textTranslations));
  }, [textTranslations]);

  const saveMutation = useMutation({
    mutationFn: (nextStatus?: TranslationStatus) => {
      if (!text) throw new Error('Guarde o texto em português antes de editar traduções.');
      return client.put<AdminTranslation>(
        `/api/v1/admin/translations/${text.id}/${activeLang}/manual`,
        {
          content: activeDraft.content,
          phonetic_content: activeDraft.phoneticContent || null,
          status: nextStatus ?? activeDraft.status
        },
        token
      );
    },
    onSuccess: (translation) => {
      setMessage('Versão guardada.');
      setVersionDrafts((current) => ({ ...current, [translation.lang]: translationToDraft(translation) }));
      onTranslationsChanged();
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível guardar a versão.');
    }
  });

  const generateMutation = useMutation({
    mutationFn: () => {
      if (!text) throw new Error('Guarde o texto em português antes de gerar tradução.');
      return client.post<AdminTranslation>(`/api/v1/admin/translations/${text.id}/${activeLang}`, {}, token);
    },
    onSuccess: (translation) => {
      setMessage('Tradução gerada como pendente.');
      setVersionDrafts((current) => ({ ...current, [translation.lang]: translationToDraft(translation) }));
      onTranslationsChanged();
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível gerar a tradução.');
    }
  });

  const reviewMutation = useMutation({
    mutationFn: (nextStatus: TranslationStatus) => {
      if (!activeTranslation) return saveMutation.mutateAsync(nextStatus);
      return client.put<AdminTranslation>(
        `/api/v1/admin/translations/${activeTranslation.id}/review`,
        {
          content: activeDraft.content,
          phonetic_content: activeDraft.phoneticContent || null,
          status: nextStatus
        },
        token
      );
    },
    onSuccess: (_translation, nextStatus) => {
      setMessage('Revisão guardada.');
      setVersionDrafts((current) => ({
        ...current,
        [activeLang]: { ...activeDraft, status: nextStatus, dirty: false }
      }));
      onTranslationsChanged();
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível rever a tradução.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!activeTranslation) throw new Error('Esta tradução ainda não existe.');
      if (!window.confirm(`Remover a tradução ${activeLang.toUpperCase()} deste texto?`)) {
        throw new Error('Ação cancelada.');
      }
      return client.delete<{ deleted: boolean }>(`/api/v1/admin/translations/${activeTranslation.id}`, token);
    },
    onSuccess: () => {
      setMessage('Tradução removida.');
      setVersionDrafts((current) => ({ ...current, [activeLang]: translationToDraft(undefined) }));
      onTranslationsChanged();
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível remover a tradução.');
    }
  });

  function updateTranslationDraft(nextDraft: Partial<TextVersionDraft>) {
    setVersionDrafts((current) => ({
      ...current,
      [activeLang]: { ...activeDraft, ...nextDraft, dirty: true }
    }));
  }

  return (
    <section className="text-versions-editor">
      <div className="text-version-heading">
        <div>
          <span>Versões multilíngues</span>
          <h4>{activeLanguage ? languageLabel(activeLanguage) : activeLang.toUpperCase()}</h4>
        </div>
        <div className="version-state-group">
          <span className={`version-state ${versionState(activeTranslation, isSource, sourceOrigin)}`}>
            {versionStateLabel(activeTranslation, isSource, sourceOrigin)}
          </span>
          <span className={`version-state ${audioState(activeAudio)}`}>{audioStateLabel(activeAudio)}</span>
        </div>
      </div>

      <div className="language-tabs">
        {editableLanguages.map((language) => {
          const translation = textTranslations.find((item) => item.lang === language.code);
          const audio = textAudios.find((item) => item.lang === language.code);
          return (
            <button
              key={language.code}
              type="button"
              className={language.code === activeLang ? 'active' : ''}
              onClick={() => setActiveLang(language.code)}
            >
              {language.code.toUpperCase()}
              <small>{versionStateLabel(translation, language.code === sourceLanguage, sourceOrigin)}</small>
              <small>{audioStateLabel(audio)}</small>
            </button>
          );
        })}
      </div>

      {isSource ? (
        <div className="field-grid text-version-fields">
          <label className="textarea-field">
            Conteúdo {activeLang.toUpperCase()}
            <textarea
              value={String(baseDraft.content_pt ?? '')}
              onChange={(event) => onBaseDraft({ ...baseDraft, content_pt: event.target.value })}
            />
          </label>
          <label className="textarea-field">
            Conteúdo fonético {activeLang.toUpperCase()}
            <textarea
              value={String(baseDraft.phonetic_content ?? '')}
              onChange={(event) => onBaseDraft({ ...baseDraft, phonetic_content: event.target.value })}
            />
          </label>
        </div>
      ) : (
        <>
          <div className="version-meta">
            <span>Origem: {originLabel(activeTranslation?.origin ?? 'manual')}</span>
            <span>Estado: {translationStatusLabel(activeDraft.status)}</span>
            <span>Revisão: {reviewLabel(activeTranslation)}</span>
          </div>
          <div className="field-grid text-version-fields">
            <label className="textarea-field">
              Conteúdo {activeLang.toUpperCase()}
              <textarea
                value={activeDraft.content}
                onChange={(event) => updateTranslationDraft({ content: event.target.value })}
              />
            </label>
            <label className="textarea-field">
              Conteúdo fonético {activeLang.toUpperCase()}
              <textarea
                value={activeDraft.phoneticContent}
                onChange={(event) => updateTranslationDraft({ phoneticContent: event.target.value })}
              />
            </label>
            <label>
              Estado
              <select
                value={activeDraft.status}
                onChange={(event) => updateTranslationDraft({ status: event.target.value as TranslationStatus })}
              >
                {translationStatusOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-actions text-version-actions">
            <button type="button" disabled={!text || saveMutation.isPending} onClick={() => saveMutation.mutate(undefined)}>
              {saveMutation.isPending ? 'A guardar...' : 'Guardar versão manual'}
            </button>
            <button
              type="button"
              className="secondary-action"
              disabled={!text || generateMutation.isPending}
              onClick={() => generateMutation.mutate()}
            >
              {generateMutation.isPending ? 'A gerar...' : 'Gerar tradução IA'}
            </button>
            <button type="button" className="secondary-action" disabled={!text} onClick={() => reviewMutation.mutate('approved')}>
              Aprovar
            </button>
            <button type="button" className="secondary-action" disabled={!text} onClick={() => reviewMutation.mutate('rejected')}>
              Rejeitar
            </button>
            <button
              type="button"
              className="danger"
              disabled={!activeTranslation || deleteMutation.isPending}
              onClick={() => deleteMutation.mutate(undefined)}
            >
              Remover tradução
            </button>
          </div>
        </>
      )}

      <AudioVersionEditor
        audio={activeAudio}
        audioError={audioError}
        audioLoading={audioLoading}
        lang={activeLang}
        text={text}
        token={token}
        voices={voices}
        onAuthExpired={onAuthExpired}
        onAudiosChanged={onAudiosChanged}
      />
      {message ? <p className="audio-message">{message}</p> : null}
    </section>
  );
}

function AudioVersionEditor({
  audio,
  audioError,
  audioLoading,
  lang,
  text,
  token,
  voices,
  onAuthExpired,
  onAudiosChanged
}: {
  audio?: AdminAudioFile;
  audioError: boolean;
  audioLoading: boolean;
  lang: string;
  text: AdminText | null;
  token: string;
  voices: AdminVoice[];
  onAuthExpired: () => void;
  onAudiosChanged: () => void;
}) {
  const [voiceId, setVoiceId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const publicUrl = toAssetUrl(audio?.public_url);

  useEffect(() => {
    setFile(null);
    setMessage('');
  }, [lang, text?.id]);

  const generateAudioMutation = useMutation({
    mutationFn: () => {
      if (!text) throw new Error('Guarde o texto antes de gerar áudio.');
      if (audio?.manually_uploaded) throw new Error('Áudio manual não é sobrescrito por geração automática.');
      return client.post<{ status: string; error?: string | null; audio?: AdminAudioFile | null }>(
        `/api/v1/admin/audio/${text.id}/${lang}/generate${toQuery({ voice_id: voiceId })}`,
        {},
        token
      );
    },
    onSuccess: (result) => {
      setMessage(result.error ? `Geração concluída com erro: ${result.error}` : `Geração ${audioJobStatusLabel(result.status)}.`);
      onAudiosChanged();
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível gerar o áudio.');
    }
  });

  const uploadAudioMutation = useMutation({
    mutationFn: () => {
      if (!text) throw new Error('Guarde o texto antes de enviar áudio.');
      if (!file) throw new Error('Selecione um MP3 para enviar.');
      if (audio && !window.confirm(`Substituir o áudio ${lang.toUpperCase()} atual por este MP3?`)) {
        throw new Error('Ação cancelada.');
      }
      return putMp3<AdminAudioFile>(`/api/v1/admin/audio/${text.id}/${lang}/upload`, file, token);
    },
    onSuccess: () => {
      setMessage('Áudio manual enviado.');
      setFile(null);
      onAudiosChanged();
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível enviar o áudio.');
    }
  });

  const deleteAudioMutation = useMutation({
    mutationFn: () => {
      if (!text || !audio) throw new Error('Este idioma ainda não tem áudio.');
      if (!window.confirm(`Apagar o áudio ${lang.toUpperCase()} deste texto?`)) {
        throw new Error('Ação cancelada.');
      }
      return client.delete<{ deleted: boolean }>(`/api/v1/admin/audio/${text.id}/${lang}`, token);
    },
    onSuccess: () => {
      setMessage('Áudio apagado.');
      onAudiosChanged();
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível apagar o áudio.');
    }
  });

  return (
    <section className="audio-version-panel">
      <div className="audio-version-heading">
        <div>
          <span>Áudio {lang.toUpperCase()}</span>
          <h4>{audioStateLabel(audio)}</h4>
        </div>
        <span className={`version-state ${audioState(audio)}`}>{audioOriginLabel(audio)}</span>
      </div>

      <div className="version-meta">
        <span>{audioLoading ? 'A carregar áudio...' : `Estado: ${audioStateLabel(audio)}`}</span>
        {audioError ? <span>Erro ao carregar áudios. Use tentar novamente na listagem ou recarregue a sessão.</span> : null}
        {audio?.generated_at ? <span>Gerado em: {new Date(audio.generated_at).toLocaleString('pt-PT')}</span> : null}
        {audio?.voice_id ? <span>Voz: {audio.voice_id}</span> : null}
      </div>

      <div className="audio-player-row">
        {publicUrl ? <audio className="admin-audio-player" controls src={publicUrl} /> : <audio className="admin-audio-player" controls />}
      </div>

      <div className="field-grid audio-version-fields">
        <label>
          Voz para geração
          <select value={voiceId} onChange={(event) => setVoiceId(event.target.value)}>
            <option value="">Fallback automático</option>
            {voices.map((voice) => (
              <option key={voice.id} value={voice.elevenlabs_id}>
                {voice.name} · {voice.elevenlabs_id}{voice.languages?.length ? ` · ${voice.languages.join(', ')}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          MP3 manual
          <input accept="audio/mpeg,.mp3" type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
      </div>

      <div className="form-actions text-version-actions">
        <button
          type="button"
          disabled={!text || generateAudioMutation.isPending || Boolean(audio?.manually_uploaded)}
          onClick={() => generateAudioMutation.mutate()}
        >
          {generateAudioMutation.isPending ? 'A gerar áudio...' : 'Gerar áudio IA'}
        </button>
        <button
          type="button"
          className="secondary-action"
          disabled={!text || !file || uploadAudioMutation.isPending}
          onClick={() => uploadAudioMutation.mutate()}
        >
          {uploadAudioMutation.isPending ? 'A enviar...' : audio ? 'Substituir por MP3' : 'Enviar MP3'}
        </button>
        <button
          type="button"
          className="danger"
          disabled={!audio || deleteAudioMutation.isPending}
          onClick={() => deleteAudioMutation.mutate()}
        >
          Apagar áudio
        </button>
      </div>
      {audio?.manually_uploaded ? (
        <p className="audio-message">Geração automática bloqueada para preservar o upload manual.</p>
      ) : null}
      {message ? <p className="audio-message">{message}</p> : null}
    </section>
  );
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
      {resource === 'points' ? <PointLocationEditor draft={draft} onDraft={onDraft} /> : null}
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

function PointLocationEditor({ draft, onDraft }: { draft: Draft; onDraft: (draft: Draft) => void }) {
  const lat = coordinateNumber(draft.lat);
  const lng = coordinateNumber(draft.lng);
  const hasValidLocation = isValidCoordinate(lat, lng);
  const currentLat = hasValidLocation ? lat : ADMIN_DEFAULT_LAT;
  const currentLng = hasValidLocation ? lng : ADMIN_DEFAULT_LNG;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const draftRef = useRef(draft);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodingFeature[]>([]);
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'empty' | 'error'>('idle');
  const [coordinateMessage, setCoordinateMessage] = useState('');

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      attributionControl: false,
      center: [currentLng, currentLat],
      container: containerRef.current,
      style: ADMIN_MAP_STYLE_URL,
      zoom: hasValidLocation ? 15 : 12
    });
    const marker = new maplibregl.Marker({ color: '#c45732', draggable: true })
      .setLngLat([currentLng, currentLat])
      .addTo(map);

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    marker.on('dragend', () => {
      const nextLocation = marker.getLngLat();
      updateLocation(Number(nextLocation.lat.toFixed(6)), Number(nextLocation.lng.toFixed(6)), true);
    });
    map.on('click', (event) => {
      marker.setLngLat(event.lngLat);
      updateLocation(Number(event.lngLat.lat.toFixed(6)), Number(event.lngLat.lng.toFixed(6)), true);
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
    if (!hasValidLocation) {
      setCoordinateMessage('Coordenadas inválidas. Corrija latitude e longitude ou selecione no mapa.');
      return;
    }
    setCoordinateMessage('');
    markerRef.current?.setLngLat([currentLng, currentLat]);
    mapRef.current?.easeTo({ center: [currentLng, currentLat], duration: 250, zoom: Math.max(mapRef.current.getZoom(), 14) });
  }, [currentLat, currentLng, hasValidLocation]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSearchState('idle');
      return;
    }
    if (trimmed.length < 3) {
      setResults([]);
      setSearchState('idle');
      return;
    }
    if (!MAPTILER_KEY) {
      setResults([]);
      setSearchState('error');
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearchState('loading');
      try {
        const url = new URL(`https://api.maptiler.com/geocoding/${encodeURIComponent(trimmed)}.json`);
        url.searchParams.set('key', MAPTILER_KEY);
        url.searchParams.set('limit', '6');
        url.searchParams.set('language', 'pt');
        url.searchParams.set('proximity', `${currentLng},${currentLat}`);
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('Geocoding failed');
        const payload = (await response.json()) as { features?: GeocodingFeature[] };
        const nextResults = payload.features?.filter((feature) => Array.isArray(feature.center)) ?? [];
        setResults(nextResults);
        setSearchState(nextResults.length > 0 ? 'idle' : 'empty');
      } catch (cause) {
        if ((cause as DOMException).name === 'AbortError') return;
        setResults([]);
        setSearchState('error');
      }
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [currentLat, currentLng, query]);

  function updateLocation(nextLat: number, nextLng: number, keepAddress = false) {
    if (!isValidCoordinate(nextLat, nextLng)) {
      setCoordinateMessage('Coordenadas inválidas. Latitude deve estar entre -90 e 90; longitude entre -180 e 180.');
      return;
    }
    onDraft({ ...draftRef.current, lat: nextLat, lng: nextLng });
    if (keepAddress) setCoordinateMessage('Coordenadas atualizadas pelo mapa.');
  }

  function selectResult(feature: GeocodingFeature) {
    if (!feature.center) {
      setCoordinateMessage('Resultado sem coordenadas válidas.');
      return;
    }
    const nextLng = feature.center[0];
    const nextLat = feature.center[1];
    if (!isValidCoordinate(nextLat, nextLng)) {
      setCoordinateMessage('Resultado sem coordenadas válidas.');
      return;
    }
    const nextDraft = {
      ...draftRef.current,
      lat: Number(nextLat.toFixed(6)),
      lng: Number(nextLng.toFixed(6)),
      address: feature.place_name || feature.text || draftRef.current.address || '',
      neighborhood: geocodingNeighborhood(feature) || draftRef.current.neighborhood || ''
    };
    onDraft(nextDraft);
    setQuery(feature.place_name || feature.text || '');
    setResults([]);
    setSearchState('idle');
    setCoordinateMessage('Endereço selecionado e coordenadas atualizadas.');
    mapRef.current?.flyTo({ center: [nextLng, nextLat], zoom: 16, duration: 500 });
  }

  return (
    <section className="point-location-editor">
      <div className="point-location-heading">
        <div>
          <span>Localização visual</span>
          <h4>Mapa do ponto</h4>
        </div>
        <span className={`version-state ${hasValidLocation ? 'manual' : 'missing'}`}>
          {hasValidLocation ? 'Coordenadas válidas' : 'Coordenadas inválidas'}
        </span>
      </div>

      <label className="geocoding-field">
        Buscar endereço
        <input
          aria-describedby="geocoding-feedback"
          autoComplete="off"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setResults([]);
          }}
        />
      </label>
      <div id="geocoding-feedback" className="geocoding-feedback" aria-live="polite">
        {searchState === 'loading' ? 'A buscar endereços...' : null}
        {searchState === 'empty' ? 'Nenhum resultado encontrado.' : null}
        {searchState === 'error'
          ? MAPTILER_KEY
            ? 'Não foi possível buscar endereços agora.'
            : 'Configure VITE_MAPTILER_KEY para ativar a busca por endereço.'
          : null}
      </div>
      {results.length > 0 ? (
        <div className="geocoding-results" role="listbox" aria-label="Resultados de endereço">
          {results.map((feature) => (
            <button key={feature.id} type="button" role="option" onClick={() => selectResult(feature)}>
              <strong>{feature.text || 'Endereço'}</strong>
              <small>{feature.place_name || '-'}</small>
            </button>
          ))}
        </div>
      ) : null}

      <div ref={containerRef} className="coordinate-map embedded-coordinate-map" />
      <p className={`coordinate-readout ${coordinateMessage ? 'has-message' : ''}`}>
        Clique no mapa ou arraste o marcador. Lat {Number.isFinite(lat) ? lat.toFixed(6) : '-'} · Lng{' '}
        {Number.isFinite(lng) ? lng.toFixed(6) : '-'}
      </p>
      {coordinateMessage ? <p className="coordinate-feedback">{coordinateMessage}</p> : null}
    </section>
  );
}

function coordinateNumber(value: DraftValue | undefined) {
  if (value === '' || value === null || value === undefined) return Number.NaN;
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.NaN;
}

function isValidCoordinate(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function geocodingNeighborhood(feature: GeocodingFeature) {
  if (feature.place_type?.some((type) => ['neighbourhood', 'neighborhood', 'suburb', 'locality'].includes(type))) {
    return feature.text ?? '';
  }
  const contextMatch = feature.context?.find((item) => {
    const id = item.id ?? '';
    return ['neighbourhood', 'neighborhood', 'suburb', 'locality', 'district'].some((type) => id.includes(type));
  });
  return contextMatch?.text ?? '';
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

const originOptions: Array<{ value: TextOrigin; label: string }> = [
  { value: 'manual', label: 'Manual' },
  { value: 'automatic', label: 'Automático' },
  { value: 'import', label: 'CSV/importação' }
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
  if (resource === 'texts') return ['content_pt', 'origin', 'author_id', 'source_work', 'content_type', 'pt', 'en'];
  return ['title_pt', 'is_published', 'estimated_distance_m', 'estimated_duration_s'];
}

function formatCell(
  item: ResourceItem,
  column: string,
  context?: { translations: AdminTranslation[]; audios: AdminAudioFile[]; sourceLanguage: string }
) {
  if ((column === 'pt' || column === 'en') && context) {
    return textLanguageSummary(item as AdminText, column, context);
  }
  const value = (item as unknown as Record<string, unknown>)[column];
  if (column === 'origin') return originLabel(String(value || 'manual'));
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (value === null || value === undefined || value === '') return '-';
  return String(value).slice(0, 100);
}

function textLanguageSummary(
  text: AdminText,
  lang: string,
  context: { translations: AdminTranslation[]; audios: AdminAudioFile[]; sourceLanguage: string }
) {
  const hasText =
    lang === context.sourceLanguage
      ? Boolean(text.content_pt.trim())
      : context.translations.some((translation) => translation.text_id === text.id && translation.lang === lang);
  const audio = context.audios.find((item) => item.text_id === text.id && item.lang === lang);
  const textLabel = hasText ? 'texto ok' : 'sem texto';
  const audioLabel = audio ? (audio.manually_uploaded ? 'áudio manual' : 'áudio IA') : 'sem áudio';
  return `${textLabel} · ${audioLabel}`;
}

function originLabel(origin: string) {
  if (origin === 'import') return 'CSV';
  if (origin === 'automatic') return 'Automático';
  return 'Manual';
}

function languageLabel(language: AdminLanguage) {
  return `${language.code.toUpperCase()} · ${language.name}${language.is_source ? ' · fonte' : ''}`;
}

function audioState(audio?: AdminAudioFile) {
  if (!audio) return 'missing';
  return audio.manually_uploaded ? 'manual' : 'automatic';
}

function audioStateLabel(audio?: AdminAudioFile) {
  if (!audio) return 'Áudio ausente';
  return audio.manually_uploaded ? 'Áudio manual' : 'Áudio automático';
}

function audioOriginLabel(audio?: AdminAudioFile) {
  if (!audio) return 'Ausente';
  return audio.manually_uploaded ? 'Upload manual' : 'Gerado automaticamente';
}

function audioJobStatusLabel(status: string) {
  if (status === 'completed') return 'concluída';
  if (status === 'failed') return 'com falha';
  if (status === 'running') return 'em curso';
  return status;
}

function versionState(translation: AdminTranslation | undefined, isSource: boolean, sourceOrigin: string) {
  if (isSource) return sourceOrigin;
  if (!translation) return 'missing';
  if (translation.status === 'rejected') return 'rejected';
  if (translation.origin === 'import') return 'import';
  if (translation.origin === 'automatic') return 'automatic';
  return 'manual';
}

function versionStateLabel(
  translation: AdminTranslation | undefined,
  isSource: boolean,
  sourceOrigin: string
) {
  if (isSource) return originLabel(sourceOrigin);
  if (!translation) return 'Ausente';
  if (translation.status === 'rejected') return 'Rejeitada';
  if (translation.origin === 'automatic') return 'Automática/pendente';
  if (translation.origin === 'import') return 'CSV/importação';
  if (translation.reviewed_by) return 'Revisada manualmente';
  return translationStatusLabel(translation.status);
}

function reviewLabel(translation?: AdminTranslation) {
  if (!translation?.reviewed_by) return 'sem revisão manual';
  const date = translation.reviewed_at ? new Date(translation.reviewed_at).toLocaleString('pt-PT') : 'data não registrada';
  return `${translation.reviewed_by} · ${date}`;
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
