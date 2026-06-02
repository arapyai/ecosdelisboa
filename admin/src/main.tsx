import {
  ApiClient,
  type AdminAuthor,
  type AdminLoginResponse,
  type AdminPoint,
  type AdminRoute,
  type AdminText,
  type AdminUser
} from '@ecosdelisboa/shared';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Resource = 'authors' | 'points' | 'texts' | 'routes';
type ResourceItem = AdminAuthor | AdminPoint | AdminText | AdminRoute;
type Draft = Record<string, string | number | boolean | null>;

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
const client = new ApiClient(API_BASE);
const queryClient = new QueryClient();
const TOKEN_KEY = 'ecosdelisboa.admin.token';

const mockAuthors: AdminAuthor[] = [
  { id: 'author-pessoa', name: 'Fernando Pessoa', bio_pt: 'Poeta', birth_year: 1888, death_year: 1935 },
  { id: 'author-saramago', name: 'Jose Saramago', bio_pt: 'Romancista', birth_year: 1922, death_year: 2010 }
];

const mockPoints: AdminPoint[] = [
  {
    id: 'point-chiado',
    author_id: 'author-pessoa',
    title_pt: 'Chiado',
    address: 'Largo do Chiado',
    neighborhood: 'Chiado',
    lat: 38.7107,
    lng: -9.1439
  },
  {
    id: 'point-alfama',
    author_id: 'author-saramago',
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
    content_pt: 'Aqui a cidade tem passos de escritorio, cafe e fantasma.',
    source_work: 'Fragmento demonstrativo',
    source_year: 2026,
    content_type: 'prose'
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
      author_id: mockAuthors[0]?.id ?? '',
      title_pt: '',
      address: '',
      neighborhood: '',
      lat: 38.7223,
      lng: -9.1393
    };
  }
  if (resource === 'texts') {
    return {
      point_id: mockPoints[0]?.id ?? '',
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
    items: '[]'
  };
}

function AdminApp() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '');
  const [mockMode, setMockMode] = useState(token === 'demo-token');

  function onLogin(nextToken: string, isMock: boolean) {
    localStorage.setItem(TOKEN_KEY, nextToken);
    setToken(nextToken);
    setMockMode(isMock);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken('');
    setMockMode(false);
  }

  return token ? (
    <Dashboard token={token} mockMode={mockMode} onLogout={logout} />
  ) : (
    <Login onLogin={onLogin} />
  );
}

function Login({ onLogin }: { onLogin: (token: string, isMock: boolean) => void }) {
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: () =>
      client.post<AdminLoginResponse>('/api/v1/admin/auth/login', {
        email,
        password
      }),
    onSuccess: (data) => onLogin(data.access_token, false),
    onError: () => setError('Login indisponivel. Pode entrar em modo demo para rever as telas.')
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    mutation.mutate();
  }

  return (
    <main className="login-screen">
      <section className="login-panel">
        <span>Login Admin</span>
        <h1>Lisboa por Outros</h1>
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
          <button type="button" className="secondary-action" onClick={() => onLogin('demo-token', true)}>
            Modo demo
          </button>
        </form>
      </section>
    </main>
  );
}

function Dashboard({ token, mockMode, onLogout }: { token: string; mockMode: boolean; onLogout: () => void }) {
  const [resource, setResource] = useState<Resource>('authors');
  const me = useQuery({
    queryKey: ['me', token],
    queryFn: () => client.get<AdminUser>('/api/v1/admin/auth/me', token),
    enabled: Boolean(token) && !mockMode,
    retry: false
  });

  return (
    <main className="admin-shell">
      <aside className="sidebar">
        <span>Admin</span>
        <h1>Lisboa por Outros</h1>
        <p>{mockMode ? 'Modo demo com mocks locais' : me.data?.email ?? 'Sessao autenticada'}</p>
        <nav>
          {(Object.keys(resourceLabels) as Resource[]).map((key) => (
            <button key={key} className={resource === key ? 'active' : ''} type="button" onClick={() => setResource(key)}>
              {resourceLabels[key]}
            </button>
          ))}
        </nav>
        <button type="button" className="secondary-action" onClick={onLogout}>
          Sair
        </button>
      </aside>
      <ResourcePanel token={token} resource={resource} mockMode={mockMode} />
    </main>
  );
}

function ResourcePanel({ token, resource, mockMode }: { token: string; resource: Resource; mockMode: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ResourceItem | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft(resource));
  const [isLocal, setIsLocal] = useState(mockMode);

  const query = useQuery({
    queryKey: ['admin-resource', resource, token, mockMode],
    queryFn: async () => {
      if (mockMode) return fallbackFor(resource);
      try {
        setIsLocal(false);
        return await client.get<ResourceItem[]>(`/api/v1/admin/${resource}`, token);
      } catch {
        setIsLocal(true);
        return fallbackFor(resource);
      }
    }
  });

  const items = query.data ?? fallbackFor(resource);
  const metrics = useMemo(() => items.length, [items.length]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = serializeDraft(resource, draft);
      if (isLocal || mockMode) return payload as ResourceItem;
      if (editing) {
        return client.put<ResourceItem>(`/api/v1/admin/${resource}/${editing.id}`, payload, token);
      }
      return client.post<ResourceItem>(`/api/v1/admin/${resource}`, payload, token);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<ResourceItem[]>(['admin-resource', resource, token, mockMode], (current) => {
        const list = current ?? fallbackFor(resource);
        if (editing) return list.map((item) => (item.id === editing.id ? { ...item, ...saved, id: editing.id } : item));
        return [{ ...saved, id: `local-${Date.now()}` }, ...list];
      });
      setEditing(null);
      setDraft(emptyDraft(resource));
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!isLocal && !mockMode) await client.delete<{ deleted: boolean }>(`/api/v1/admin/${resource}/${id}`, token);
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData<ResourceItem[]>(['admin-resource', resource, token, mockMode], (current) =>
        (current ?? fallbackFor(resource)).filter((item) => item.id !== id)
      );
    }
  });

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
          {isLocal ? <p>Usando mocks locais enquanto o endpoint admin nao responde.</p> : null}
        </div>
        <button type="button" onClick={() => query.refetch()}>
          Atualizar
        </button>
      </div>

      <form className="editor" onSubmit={submit}>
        <h3>{editing ? 'Editar' : 'Criar'} {resourceLabels[resource].toLowerCase()}</h3>
        <ResourceFields resource={resource} draft={draft} onDraft={setDraft} />
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
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
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

function ResourceFields({
  resource,
  draft,
  onDraft
}: {
  resource: Resource;
  draft: Draft;
  onDraft: (draft: Draft) => void;
}) {
  const fields = fieldsFor(resource);
  return (
    <div className="field-grid">
      {fields.map((field) => (
        <label key={field.name}>
          {field.label}
          {field.type === 'textarea' ? (
            <textarea value={String(draft[field.name] ?? '')} onChange={(event) => onDraft({ ...draft, [field.name]: event.target.value })} />
          ) : field.type === 'checkbox' ? (
            <input
              checked={Boolean(draft[field.name])}
              onChange={(event) => onDraft({ ...draft, [field.name]: event.target.checked })}
              type="checkbox"
            />
          ) : (
            <input
              value={String(draft[field.name] ?? '')}
              onChange={(event) => onDraft({ ...draft, [field.name]: event.target.value })}
              type={field.type}
            />
          )}
        </label>
      ))}
    </div>
  );
}

function fieldsFor(resource: Resource) {
  if (resource === 'authors') {
    return [
      { name: 'name', label: 'Nome', type: 'text' },
      { name: 'bio_pt', label: 'Bio PT', type: 'textarea' },
      { name: 'birth_year', label: 'Nascimento', type: 'number' },
      { name: 'death_year', label: 'Morte', type: 'number' },
      { name: 'photo_url', label: 'Foto URL', type: 'url' },
      { name: 'elevenlabs_voice_id', label: 'Voz ElevenLabs', type: 'text' }
    ];
  }
  if (resource === 'points') {
    return [
      { name: 'author_id', label: 'Autor ID', type: 'text' },
      { name: 'title_pt', label: 'Titulo PT', type: 'text' },
      { name: 'address', label: 'Morada', type: 'text' },
      { name: 'neighborhood', label: 'Bairro', type: 'text' },
      { name: 'lat', label: 'Latitude', type: 'number' },
      { name: 'lng', label: 'Longitude', type: 'number' }
    ];
  }
  if (resource === 'texts') {
    return [
      { name: 'point_id', label: 'Ponto ID', type: 'text' },
      { name: 'content_pt', label: 'Conteudo PT', type: 'textarea' },
      { name: 'source_work', label: 'Obra', type: 'text' },
      { name: 'source_year', label: 'Ano', type: 'number' },
      { name: 'content_type', label: 'Tipo', type: 'text' }
    ];
  }
  return [
    { name: 'title_pt', label: 'Titulo PT', type: 'text' },
    { name: 'description_pt', label: 'Descricao PT', type: 'textarea' },
    { name: 'difficulty', label: 'Dificuldade', type: 'text' },
    { name: 'is_published', label: 'Publicado', type: 'checkbox' },
    { name: 'estimated_distance_m', label: 'Distancia m', type: 'number' },
    { name: 'estimated_duration_s', label: 'Duracao s', type: 'number' },
    { name: 'items', label: 'Items JSON', type: 'textarea' }
  ];
}

function columnsFor(resource: Resource) {
  if (resource === 'authors') return ['name', 'bio_pt', 'birth_year'];
  if (resource === 'points') return ['title_pt', 'neighborhood', 'lat', 'lng'];
  if (resource === 'texts') return ['content_pt', 'source_work', 'content_type'];
  return ['title_pt', 'is_published', 'estimated_distance_m', 'estimated_duration_s'];
}

function formatCell(item: ResourceItem, column: string) {
  const value = (item as unknown as Record<string, unknown>)[column];
  if (typeof value === 'boolean') return value ? 'Sim' : 'Nao';
  if (value === null || value === undefined || value === '') return '-';
  return String(value).slice(0, 100);
}

function draftFromItem(resource: Resource, item: ResourceItem): Draft {
  const draft = emptyDraft(resource);
  Object.keys(draft).forEach((key) => {
    const value = (item as unknown as Record<string, unknown>)[key];
    if (value !== undefined) draft[key] = key === 'items' ? JSON.stringify(value, null, 2) : (value as string | number | boolean | null);
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
      items: typeof draft.items === 'string' && draft.items ? JSON.parse(draft.items) : []
    };
  }

  return clean;
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <AdminApp />
  </QueryClientProvider>
);
