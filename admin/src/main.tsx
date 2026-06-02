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
type FieldOption = { value: string; label: string };
type FieldConfig = {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'checkbox' | 'number' | 'url' | 'select';
  options?: FieldOption[];
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number | 'any';
};
type FieldContext = {
  authors: AdminAuthor[];
  points: AdminPoint[];
};

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
const client = new ApiClient(API_BASE);
const queryClient = new QueryClient();
const TOKEN_KEY = 'ecosdelisboa.admin.token';
const autoSyncQueryOptions = {
  refetchOnWindowFocus: true,
  refetchOnReconnect: true
};

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
      author_id: '',
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

  function onLogin(nextToken: string) {
    localStorage.setItem(TOKEN_KEY, nextToken);
    setToken(nextToken);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken('');
  }

  return token ? (
    <Dashboard token={token} onLogout={logout} />
  ) : (
    <Login onLogin={onLogin} />
  );
}

function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: () =>
      client.post<AdminLoginResponse>('/api/v1/admin/auth/login', {
        email,
        password
      }),
    onSuccess: (data) => onLogin(data.access_token),
    onError: () => setError('Login indisponivel. Verifique se o backend esta rodando e se as credenciais estao corretas.')
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
        </form>
      </section>
    </main>
  );
}

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [resource, setResource] = useState<Resource>('authors');
  const me = useQuery({
    queryKey: ['me', token],
    queryFn: () => client.get<AdminUser>('/api/v1/admin/auth/me', token),
    enabled: Boolean(token),
    retry: false
  });

  return (
    <main className="admin-shell">
      <aside className="sidebar">
        <span>Admin</span>
        <h1>Lisboa por Outros</h1>
        <p>{me.data?.email ?? 'Sessao autenticada'}</p>
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
      <ResourcePanel token={token} resource={resource} />
    </main>
  );
}

function ResourcePanel({ token, resource }: { token: string; resource: Resource }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ResourceItem | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft(resource));
  const [isLocal, setIsLocal] = useState(false);

  const query = useQuery({
    queryKey: ['admin-resource', resource, token],
    queryFn: async () => {
      try {
        setIsLocal(false);
        return await client.get<ResourceItem[]>(`/api/v1/admin/${resource}`, token);
      } catch {
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
      } catch {
        return mockAuthors;
      }
    },
    ...autoSyncQueryOptions
  });

  const pointsQuery = useQuery({
    queryKey: ['admin-options', 'points', token],
    queryFn: async () => {
      try {
        return await client.get<AdminPoint[]>('/api/v1/admin/points', token);
      } catch {
        return mockPoints;
      }
    },
    ...autoSyncQueryOptions
  });

  const items = query.data ?? fallbackFor(resource);
  const metrics = useMemo(() => items.length, [items.length]);
  const fieldContext = useMemo<FieldContext>(
    () => ({
      authors: authorsQuery.data ?? mockAuthors,
      points: pointsQuery.data ?? mockPoints
    }),
    [authorsQuery.data, pointsQuery.data]
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = serializeDraft(resource, draft);
      if (isLocal) return payload as ResourceItem;
      if (editing) {
        return client.put<ResourceItem>(`/api/v1/admin/${resource}/${editing.id}`, payload, token);
      }
      return client.post<ResourceItem>(`/api/v1/admin/${resource}`, payload, token);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<ResourceItem[]>(['admin-resource', resource, token], (current) => {
        const list = current ?? fallbackFor(resource);
        if (editing) return list.map((item) => (item.id === editing.id ? { ...item, ...saved, id: editing.id } : item));
        return [{ ...saved, id: `local-${Date.now()}` }, ...list];
      });
      syncRelationshipOptions(saved);
      invalidateRelatedQueries();
      setEditing(null);
      setDraft(emptyDraft(resource));
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!isLocal) await client.delete<{ deleted: boolean }>(`/api/v1/admin/${resource}/${id}`, token);
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData<ResourceItem[]>(['admin-resource', resource, token], (current) =>
        (current ?? fallbackFor(resource)).filter((item) => item.id !== id)
      );
      removeRelationshipOption(id);
      invalidateRelatedQueries();
    }
  });

  function syncRelationshipOptions(saved: ResourceItem) {
    if (resource !== 'authors' && resource !== 'points') return;
    queryClient.setQueryData<ResourceItem[]>(['admin-options', resource, token], (current) => {
      const list = current ?? fallbackFor(resource);
      if (editing) return list.map((item) => (item.id === editing.id ? { ...item, ...saved, id: editing.id } : item));
      return [{ ...saved, id: saved.id ?? `local-${Date.now()}` }, ...list];
    });
  }

  function removeRelationshipOption(id: string) {
    if (resource !== 'authors' && resource !== 'points') return;
    queryClient.setQueryData<ResourceItem[]>(['admin-options', resource, token], (current) =>
      (current ?? fallbackFor(resource)).filter((item) => item.id !== id)
    );
  }

  function invalidateRelatedQueries() {
    queryClient.invalidateQueries({ queryKey: ['admin-resource', resource, token] });
    if (resource === 'authors') {
      queryClient.invalidateQueries({ queryKey: ['admin-options', 'authors', token] });
      queryClient.invalidateQueries({ queryKey: ['admin-resource', 'points', token] });
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
          {isLocal ? <p>Usando mocks locais enquanto o endpoint admin nao responde.</p> : null}
        </div>
      </div>

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
  context,
  onDraft
}: {
  resource: Resource;
  draft: Draft;
  context: FieldContext;
  onDraft: (draft: Draft) => void;
}) {
  const fields = fieldsFor(resource, context);
  return (
    <div className="field-grid">
      {fields.map((field) => (
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
      ))}
    </div>
  );
}

function fieldsFor(resource: Resource, context: FieldContext): FieldConfig[] {
  if (resource === 'authors') {
    return [
      { name: 'name', label: 'Nome', type: 'text' },
      { name: 'bio_pt', label: 'Bio PT', type: 'textarea', placeholder: 'Resumo biografico em portugues' },
      { name: 'birth_year', label: 'Ano de nascimento', type: 'number', min: 0, max: 2100, step: 1 },
      { name: 'death_year', label: 'Ano de morte', type: 'number', min: 0, max: 2100, step: 1 },
      { name: 'photo_url', label: 'Foto URL', type: 'url' },
      { name: 'elevenlabs_voice_id', label: 'Voz ElevenLabs', type: 'text', placeholder: 'ID da voz no ElevenLabs' }
    ];
  }
  if (resource === 'points') {
    return [
      { name: 'author_id', label: 'Autor', type: 'select', options: relationOptions(context.authors, 'Selecione um autor') },
      { name: 'title_pt', label: 'Titulo PT', type: 'text' },
      { name: 'address', label: 'Morada', type: 'text' },
      { name: 'neighborhood', label: 'Bairro', type: 'text' },
      { name: 'lat', label: 'Latitude', type: 'number', min: -90, max: 90, step: 'any' },
      { name: 'lng', label: 'Longitude', type: 'number', min: -180, max: 180, step: 'any' }
    ];
  }
  if (resource === 'texts') {
    return [
      { name: 'point_id', label: 'Ponto', type: 'select', options: relationOptions(context.points, 'Selecione um ponto') },
      { name: 'content_pt', label: 'Conteudo PT', type: 'textarea', placeholder: 'Texto original em portugues' },
      { name: 'source_work', label: 'Obra', type: 'text', placeholder: 'Nome da obra ou fonte' },
      { name: 'source_year', label: 'Ano da obra', type: 'number', min: 0, max: 2100, step: 1 },
      { name: 'content_type', label: 'Tipo', type: 'select', options: contentTypeOptions }
    ];
  }
  return [
    { name: 'title_pt', label: 'Titulo PT', type: 'text' },
    { name: 'description_pt', label: 'Descricao PT', type: 'textarea', placeholder: 'Resumo curto do percurso' },
    { name: 'cover_image_url', label: 'Imagem de capa URL', type: 'url' },
    { name: 'difficulty', label: 'Dificuldade', type: 'select', options: difficultyOptions },
    { name: 'is_published', label: 'Publicado', type: 'checkbox' },
    { name: 'estimated_distance_m', label: 'Distancia m', type: 'number', min: 0, step: 1 },
    { name: 'estimated_duration_s', label: 'Duracao s', type: 'number', min: 0, step: 1 },
    { name: 'items', label: 'Items JSON', type: 'textarea', placeholder: 'Sequencia de pontos do percurso em JSON' }
  ];
}

function fieldClassName(field: FieldConfig) {
  if (field.type === 'checkbox') return 'checkbox-field';
  if (field.type === 'textarea') return 'textarea-field';
  return undefined;
}

const contentTypeOptions: FieldOption[] = [
  { value: 'prose', label: 'Prosa' },
  { value: 'poetry', label: 'Poesia' },
  { value: 'lyrics', label: 'Letra de musica' }
];

const difficultyOptions: FieldOption[] = [
  { value: '', label: 'Sem dificuldade definida' },
  { value: 'easy', label: 'Facil' },
  { value: 'medium', label: 'Media' },
  { value: 'hard', label: 'Dificil' }
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
  const options = field.options ?? [];
  const current = String(draft[field.name] ?? '');
  if (!current || options.some((option) => option.value === current)) return options;
  return [{ value: current, label: `Valor atual: ${current}` }, ...options];
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
