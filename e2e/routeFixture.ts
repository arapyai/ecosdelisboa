export const publicRoute = {
  id: 'route-e2e', slug: 'do-tejo-ao-chiado', title_pt: 'Do Tejo ao Chiado', title: 'Do Tejo ao Chiado',
  description_pt: 'Uma narrativa pela cidade.', description: 'Uma narrativa pela cidade.',
  is_published: true, routing_status: 'ready', estimated_distance_m: 180, estimated_duration_s: 150,
  text_count: 2, authors: ['Almeida Garrett', 'Fernando Pessoa / Bernardo Soares'],
  segments: [
    { id: 'text-1-segment', position: 1, kind: 'text', text: {
      id: 'text-1', content: 'Primeiro texto junto ao rio.', content_pt: 'Primeiro texto junto ao rio.', content_type: 'prose', source_work: 'Viagens na Minha Terra',
      author: { id: 'author-1', name: 'Almeida Garrett' }, point: { id: 'point-1', title_pt: 'Terreiro do Paço', neighborhood: 'Baixa', lat: 38.70775, lng: -9.13645 },
      audio_files: [{ id: 'audio-1', lang: 'pt', public_url: '/audio/one.mp3', duration_s: 12 }]
    } },
    { id: 'bridge', position: 2, kind: 'bridge', content: 'Entre na malha da Baixa.', content_pt: 'Entre na malha da Baixa.', audio_files: [{ id: 'audio-bridge', lang: 'pt', public_url: '/audio/bridge.mp3', duration_s: 8 }] },
    { id: 'text-2-segment', position: 3, kind: 'text', text: {
      id: 'text-2', content: 'A rua contém o sentido de Lisboa.', content_pt: 'A rua contém o sentido de Lisboa.', content_type: 'prose', source_work: 'Livro do Desassossego',
      author: { id: 'author-2', name: 'Fernando Pessoa / Bernardo Soares' }, point: { id: 'point-2', title_pt: 'Rua dos Douradores', neighborhood: 'Baixa', lat: 38.709, lng: -9.137 },
      audio_files: [{ id: 'audio-2', lang: 'pt', public_url: '/audio/two.mp3', duration_s: 15 }]
    } }
  ],
  legs: [{ id: 'leg-1', position: 0, from_segment_id: 'text-1-segment', to_segment_id: 'text-2-segment', geometry: { type: 'LineString', coordinates: [[-9.13645, 38.70775], [-9.137, 38.709]] }, waypoints: [], distance_m: 180, duration_s: 150, provider: 'openrouteservice' }]
};

export const adminTexts = publicRoute.segments.filter((segment) => segment.kind === 'text').map((segment) => ({
  id: segment.text!.id, point_id: segment.text!.point.id, author_id: segment.text!.author.id,
  content_pt: segment.text!.content_pt, source_work: segment.text!.source_work, content_type: 'prose',
  author: segment.text!.author, point: segment.text!.point,
  translations: [{ lang: 'en', content: 'Translated', status: 'approved' }],
  audio_files: [{ lang: 'pt', public_url: '/audio/test.mp3', duration_s: 10 }, { lang: 'en', public_url: '/audio/test-en.mp3', duration_s: 10 }]
}));

export const mapStyle = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e9ece7' } }] };
