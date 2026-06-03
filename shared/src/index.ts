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
  author_id?: string | null;
  authors?: Pick<PublicAuthorSummary, 'id' | 'name' | 'photo_url'>[];
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
  author_id?: string;
  author?: Pick<PublicAuthorSummary, 'id' | 'name' | 'photo_url'>;
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

export interface AdminUser {
  id: string;
  email: string;
  is_active: boolean;
}

export interface AdminLoginResponse {
  access_token: string;
  token_type: 'bearer';
}

export interface AdminAuthor {
  id: string;
  name: string;
  bio_pt?: string | null;
  birth_year?: number | null;
  death_year?: number | null;
  photo_url?: string | null;
  elevenlabs_voice_id?: string | null;
}

export interface AdminPoint {
  id: string;
  title_pt: string;
  address?: string | null;
  neighborhood?: string | null;
  lat: number;
  lng: number;
}

export interface AdminText {
  id: string;
  point_id: string;
  author_id: string;
  content_pt: string;
  source_work?: string | null;
  source_year?: number | null;
  content_type: ContentType;
}

export interface AdminRouteItem {
  id?: string;
  position: number;
  point_id?: string | null;
  waypoint_lat?: number | null;
  waypoint_lng?: number | null;
  transition_text_pt?: string | null;
}

export interface AdminRoute {
  id: string;
  title_pt: string;
  description_pt?: string | null;
  cover_image_url?: string | null;
  difficulty?: string | null;
  is_published?: boolean;
  estimated_distance_m?: number | null;
  estimated_duration_s?: number | null;
  items?: AdminRouteItem[];
}

type RequestBody = Record<string, unknown> | Array<unknown>;

export class ApiClient {
  constructor(private readonly baseUrl = '') {}

  async get<T>(path: string, token?: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' }, token);
  }

  async post<T>(path: string, body: RequestBody, token?: string): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) }, token);
  }

  async put<T>(path: string, body: RequestBody, token?: string): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: JSON.stringify(body) }, token);
  }

  async delete<T>(path: string, token?: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' }, token);
  }

  private async request<T>(path: string, init: RequestInit, token?: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
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
