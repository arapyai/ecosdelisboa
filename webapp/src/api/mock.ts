import type { Author, DefaultVoice, Point, Route } from '../types';

export const mockAuthors: Author[] = [
  {
    id: 'author-pessoa',
    name: 'Fernando Pessoa',
    bio_pt: 'Poeta e escritor associado a multiplas Lisboas interiores.',
    bio_en: 'Poet and writer associated with many inner Lisbons.',
    birth_year: 1888,
    death_year: 1935,
    photo_url: 'https://upload.wikimedia.org/wikipedia/commons/4/47/Fernando_Pessoa_%281935%29.jpg',
    points_count: 2
  },
  {
    id: 'author-saramago',
    name: 'Jose Saramago',
    bio_pt: 'Romancista portugues, Nobel da Literatura, leitor critico da cidade.',
    bio_en: 'Portuguese novelist, Nobel laureate, and critical reader of the city.',
    birth_year: 1922,
    death_year: 2010,
    photo_url: 'https://upload.wikimedia.org/wikipedia/commons/6/6e/Jose_Saramago_2008.jpg',
    points_count: 1
  }
];

export const mockPoints: Point[] = [
  {
    id: 'point-chiado',
    author_id: 'author-pessoa',
    title_pt: 'Chiado',
    title_en: 'Chiado',
    address: 'Largo do Chiado',
    neighborhood: 'Chiado',
    lat: 38.7107,
    lng: -9.1439,
    author: mockAuthors[0],
    texts: [
      {
        id: 'text-chiado',
        point_id: 'point-chiado',
        author_id: 'author-pessoa',
        author: mockAuthors[0],
        content_pt:
          'Aqui a cidade tem passos de escritorio, cafe e fantasma. A rua guarda a pressa e a hesitacao de quem escreve antes de chegar.',
        content_en:
          'Here the city walks with the rhythm of offices, cafes, and ghosts. The street keeps the hurry and hesitation of those who write before arriving.',
        source_work: 'Fragmento demonstrativo',
        source_year: 2026,
        content_type: 'prose'
      }
    ],
    audios: [
      {
        id: 'audio-chiado-pt',
        lang: 'pt',
        url: '',
        duration_sec: 42,
        transcript: [
          { start: 0, end: 5, text: 'Aqui a cidade tem passos de escritorio,' },
          { start: 5, end: 11, text: 'cafe e fantasma.' },
          { start: 11, end: 18, text: 'A rua guarda a pressa e a hesitacao.' }
        ]
      }
    ]
  },
  {
    id: 'point-alfama',
    author_id: 'author-saramago',
    title_pt: 'Alfama',
    title_en: 'Alfama',
    address: 'Miradouro de Santa Luzia',
    neighborhood: 'Alfama',
    lat: 38.7117,
    lng: -9.1304,
    author: mockAuthors[1],
    texts: [
      {
        id: 'text-alfama',
        point_id: 'point-alfama',
        author_id: 'author-saramago',
        author: mockAuthors[1],
        content_pt:
          'As colinas fazem da memoria uma subida. Cada pedra parece perguntar quem passa, e cada janela responde com outra pergunta.',
        content_en:
          'The hills turn memory into an ascent. Each stone seems to question whoever passes, and each window answers with another question.',
        source_work: 'Fragmento demonstrativo',
        source_year: 2026,
        content_type: 'prose'
      }
    ],
    audios: []
  },
  {
    id: 'point-praca-comercio',
    author_id: 'author-pessoa',
    title_pt: 'Terreiro do Paco',
    title_en: 'Commerce Square',
    address: 'Praca do Comercio',
    neighborhood: 'Baixa',
    lat: 38.7076,
    lng: -9.1365,
    author: mockAuthors[0],
    texts: [
      {
        id: 'text-praca',
        point_id: 'point-praca-comercio',
        author_id: 'author-pessoa',
        author: mockAuthors[0],
        content_pt:
          'O rio abre a cidade como uma pagina larga. Entre arcadas e barcos, Lisboa aprende a despedir-se sem sair do lugar.',
        content_en:
          'The river opens the city like a wide page. Between arcades and boats, Lisbon learns to say farewell without leaving.',
        source_work: 'Fragmento demonstrativo',
        source_year: 2026,
        content_type: 'prose'
      }
    ],
    audios: []
  }
];

export const mockRoutes: Route[] = [
  {
    id: 'route-baixa-chiado',
    title_pt: 'Baixa-Chiado literario',
    title_en: 'Literary Baixa-Chiado',
    description_pt: 'Um percurso curto entre pracas, cafes e miradouros.',
    description_en: 'A short route through squares, cafes, and viewpoints.',
    distance_m: 1800,
    duration_min: 55,
    cover_image_url:
      'https://images.unsplash.com/photo-1501927023255-9063be98970c?auto=format&fit=crop&w=1200&q=80',
    published: true,
    points: [
      { id: 'rp-1', route_id: 'route-baixa-chiado', point_id: 'point-praca-comercio', point: mockPoints[2], order_index: 1 },
      { id: 'rp-2', route_id: 'route-baixa-chiado', point_id: 'point-chiado', point: mockPoints[0], order_index: 2 }
    ]
  }
];

export const mockVoice: DefaultVoice = {
  voice_id: 'default-lisboa-voice',
  provider: 'elevenlabs',
  language: 'pt'
};
