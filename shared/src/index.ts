export type SupportedLanguage = 'pt' | 'en' | 'es' | 'fr' | 'de' | 'zh';

export interface EnvelopeMeta {
  page?: number | null;
  per_page?: number | null;
  total?: number | null;
  extra?: Record<string, unknown>;
}

export interface ApiEnvelope<T> {
  data: T;
  meta: EnvelopeMeta;
}

export interface PublicPointSummary {
  id: string;
  author_id: string;
  title_pt: string;
  address?: string | null;
  neighborhood?: string | null;
  lat: number;
  lng: number;
}

export interface PublicAuthorSummary {
  id: string;
  name: string;
  bio_pt?: string | null;
  birth_year?: number | null;
  death_year?: number | null;
  photo_url?: string | null;
  elevenlabs_voice_id?: string | null;
  point_count?: number;
}

export type ContentType = 'prose' | 'poetry' | 'lyrics';

export interface PublicAudioFile {
  id: string;
  lang: SupportedLanguage;
  public_url?: string | null;
  duration_s?: number | null;
  voice_id?: string | null;
  generated_at?: string | null;
  manually_uploaded?: boolean;
}

export interface PublicText {
  id: string;
  content?: string;
  content_pt: string;
  source_work?: string | null;
  source_year?: number | null;
  content_type: ContentType;
  audio_files?: PublicAudioFile[];
}

export interface PublicPointDetail extends PublicPointSummary {
  author?: Pick<PublicAuthorSummary, 'id' | 'name' | 'photo_url'>;
  texts?: PublicText[];
}

export interface PublicRoutePoint {
  id: string;
  title_pt: string;
  lat: number;
  lng: number;
}

export interface PublicRouteItem {
  id: string;
  position: number;
  transition_text_pt?: string | null;
  point?: PublicRoutePoint;
  waypoint?: {
    lat: number;
    lng: number;
  };
}

export interface PublicRoute {
  id: string;
  title_pt: string;
  description_pt?: string | null;
  cover_image_url?: string | null;
  difficulty?: string | null;
  is_published?: boolean;
  estimated_distance_m?: number | null;
  estimated_duration_s?: number | null;
  items?: PublicRouteItem[];
}

export interface PublicDefaultVoice {
  id: string;
  elevenlabs_id: string;
  name?: string;
  preview_url?: string | null;
}

export class ApiClient {
  constructor(private readonly baseUrl = '') {}

  async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${path}`);
    }

    const payload = (await response.json()) as T | ApiEnvelope<T>;
    return isEnvelope(payload) ? payload.data : payload;
  }
}

export function isEnvelope<T>(payload: T | ApiEnvelope<T>): payload is ApiEnvelope<T> {
  return typeof payload === 'object' && payload !== null && 'data' in payload && 'meta' in payload;
}
