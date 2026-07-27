export type SupportedLanguage = string;

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
  texts_count?: number;
}

export interface PublicAuthorSummary {
  id: string;
  name: string;
  bio_pt?: string | null;
  bio?: string | null;
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
  title: string;
  description?: string | null;
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
  gender?: string | null;
  languages?: SupportedLanguage[];
  lang?: SupportedLanguage | null;
  is_default?: boolean;
}

export interface AdminLanguage {
  code: SupportedLanguage;
  locale: string;
  country_code?: string | null;
  name: string;
  is_active: boolean;
  is_source: boolean;
}

export interface AdminVoice {
  id: string;
  elevenlabs_id: string;
  name: string;
  preview_url?: string | null;
  gender?: string | null;
  languages?: SupportedLanguage[];
  lang?: SupportedLanguage | null;
  is_default?: boolean;
}

export type PronunciationRule =
  | {
      type: 'alias';
      string_to_replace: string;
      alias: string;
    }
  | {
      type: 'phoneme';
      string_to_replace: string;
      alphabet: 'ipa';
      phoneme: string;
    };

export interface AdminPronunciationDictionary {
  id: string;
  language_code: SupportedLanguage;
  elevenlabs_id: string;
  version_id: string;
  name: string;
  last_published_at?: string | null;
  last_published_by?: string | null;
  rules?: PronunciationRule[];
}

export interface PronunciationPreviewAudio {
  content_type: 'audio/mpeg';
  audio_base64: string;
}

export interface PronunciationPreview {
  voice_id: string;
  text: string;
  without_dictionary: PronunciationPreviewAudio;
  with_dictionary: PronunciationPreviewAudio;
}

export interface AdminAudioFile {
  id: string;
  text_id: string;
  lang: SupportedLanguage;
  public_url?: string | null;
  duration_s?: number | null;
  voice_id?: string | null;
  generated_at?: string | null;
  manually_uploaded?: boolean;
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
  phonetic_content?: string | null;
  source_work?: string | null;
  source_year?: number | null;
  content_type: ContentType;
  origin?: TextOrigin;
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

export type TranslationStatus = 'pending' | 'approved' | 'rejected';
export type TextOrigin = 'manual' | 'automatic' | 'import';

export interface AdminTranslation {
  id: string;
  text_id: string;
  lang: SupportedLanguage;
  content?: string | null;
  phonetic_content?: string | null;
  status: TranslationStatus;
  auto_translated?: boolean;
  origin?: TextOrigin;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
}

export interface AdminEditorialTranslation {
  id: string;
  lang: SupportedLanguage;
  status: TranslationStatus;
  auto_translated: boolean;
  origin: TextOrigin;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
}

export interface AdminAuthorTranslation extends AdminEditorialTranslation {
  author_id: string;
  bio: string;
}

export interface AdminRouteTranslation extends AdminEditorialTranslation {
  route_id: string;
  title: string;
  description?: string | null;
}

type RequestBody = Record<string, unknown> | Array<unknown>;

export class ApiError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(message: string, status: number, path: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.path = path;
  }
}

export class ApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

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
      throw new ApiError(`API request failed: ${path}`, response.status, path);
    }

    const payload = (await response.json()) as T | ApiEnvelope<T>;
    return isEnvelope(payload) ? payload.data : payload;
  }
}

export function isEnvelope<T>(payload: T | ApiEnvelope<T>): payload is ApiEnvelope<T> {
  return typeof payload === 'object' && payload !== null && 'data' in payload && 'meta' in payload;
}
