import type { PublicAuthorSummary, PublicPointDetail, PublicPointSummary } from '@ecosdelisboa/shared';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  View
} from 'react-native';
import { styles } from './styles';

type Tab = 'points' | 'authors';

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

const mockAuthors: PublicAuthorSummary[] = [
  {
    id: 'author-pessoa',
    name: 'Fernando Pessoa',
    bio_pt: 'Poeta associado a multiplas Lisboas interiores.',
    point_count: 2
  },
  {
    id: 'author-saramago',
    name: 'Jose Saramago',
    bio_pt: 'Romancista portugues e leitor critico da cidade.',
    point_count: 1
  }
];

const mockPoints: PublicPointSummary[] = [
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

const mockPointDetails: Record<string, PublicPointDetail> = {
  'point-chiado': {
    ...mockPoints[0],
    author: { id: 'author-pessoa', name: 'Fernando Pessoa' },
    texts: [
      {
        id: 'text-chiado',
        author_id: 'author-pessoa',
        author: { id: 'author-pessoa', name: 'Fernando Pessoa' },
        content_pt:
          'Aqui a cidade tem passos de escritorio, cafe e fantasma. A rua guarda a pressa e a hesitacao de quem escreve antes de chegar.',
        source_work: 'Fragmento demonstrativo',
        source_year: 2026,
        content_type: 'prose'
      }
    ]
  },
  'point-alfama': {
    ...mockPoints[1],
    author: { id: 'author-saramago', name: 'Jose Saramago' },
    texts: [
      {
        id: 'text-alfama',
        author_id: 'author-saramago',
        author: { id: 'author-saramago', name: 'Jose Saramago' },
        content_pt:
          'As colinas fazem da memoria uma subida. Cada pedra parece perguntar quem passa, e cada janela responde com outra pergunta.',
        source_work: 'Fragmento demonstrativo',
        source_year: 2026,
        content_type: 'prose'
      }
    ]
  }
};

async function getPublicData<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${path}`);
  }

  const payload = await response.json();
  return 'data' in payload ? payload.data : payload;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('points');
  const [points, setPoints] = useState<PublicPointSummary[]>([]);
  const [authors, setAuthors] = useState<PublicAuthorSummary[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<PublicPointDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMock, setIsMock] = useState(false);

  useEffect(() => {
    let mounted = true;

    Promise.all([
      getPublicData<PublicPointSummary[]>('/api/v1/points?lat=38.7223&lng=-9.1393&radius=5000'),
      getPublicData<PublicAuthorSummary[]>('/api/v1/authors')
    ])
      .then(([nextPoints, nextAuthors]) => {
        if (!mounted) return;
        setPoints(nextPoints);
        setAuthors(nextAuthors);
        setIsMock(false);
      })
      .catch(() => {
        if (!mounted) return;
        setPoints(mockPoints);
        setAuthors(mockAuthors);
        setIsMock(true);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const authorsById = useMemo(
    () => new Map(authors.map((author) => [author.id, author])),
    [authors]
  );

  function authorNameForPoint(point: PublicPointSummary | PublicPointDetail) {
    return point.authors?.[0]?.name ?? (point.author_id ? authorsById.get(point.author_id)?.name : undefined) ?? 'Autor';
  }

  async function openPoint(point: PublicPointSummary) {
    setTab('points');
    setSelectedPoint(null);
    try {
      const detail = await getPublicData<PublicPointDetail>(`/api/v1/points/${point.id}?lang=pt`);
      setSelectedPoint(detail);
      setIsMock(false);
    } catch {
      setSelectedPoint(mockPointDetails[point.id] ?? { ...point, texts: [] });
      setIsMock(true);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.kicker}>Lisboa por Outros</Text>
        <Text style={styles.title}>Mapa literario</Text>
        {isMock ? <Text style={styles.notice}>Dados de exemplo enquanto a API nao responde.</Text> : null}
      </View>

      <View style={styles.tabs}>
        <Pressable style={[styles.tab, tab === 'points' && styles.activeTab]} onPress={() => setTab('points')}>
          <Text style={[styles.tabText, tab === 'points' && styles.activeTabText]}>Pontos</Text>
        </Pressable>
        <Pressable style={[styles.tab, tab === 'authors' && styles.activeTab]} onPress={() => setTab('authors')}>
          <Text style={[styles.tabText, tab === 'authors' && styles.activeTabText]}>Autores</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#163832" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {tab === 'points'
            ? points.map((point) => (
                <Pressable key={point.id} style={styles.card} onPress={() => openPoint(point)}>
                  <Text style={styles.cardTitle}>{point.title_pt}</Text>
                  <Text style={styles.cardMeta}>
                    {authorNameForPoint(point)} · {point.neighborhood ?? point.address ?? 'Lisboa'}
                  </Text>
                </Pressable>
              ))
            : authors.map((author) => (
                <View key={author.id} style={styles.card}>
                  <Text style={styles.cardTitle}>{author.name}</Text>
                  <Text style={styles.cardMeta}>
                    {author.birth_year ?? ''}
                    {author.death_year ? `-${author.death_year}` : ''} · {author.point_count ?? 0} pontos
                  </Text>
                  {author.bio_pt ? <Text style={styles.copy}>{author.bio_pt}</Text> : null}
                </View>
              ))}

          {selectedPoint ? (
            <View style={styles.detail}>
              <Text style={styles.detailKicker}>Detalhe de ponto</Text>
              <Text style={styles.detailTitle}>{selectedPoint.title_pt}</Text>
              <Text style={styles.cardMeta}>
                {selectedPoint.author?.name ?? authorNameForPoint(selectedPoint)}
              </Text>
              {selectedPoint.texts?.map((text) => (
                <View key={text.id} style={styles.textBlock}>
                  <Text style={styles.copy}>{text.content ?? text.content_pt}</Text>
                  <Text style={styles.source}>
                    {text.source_work}
                    {text.source_year ? `, ${text.source_year}` : ''}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
