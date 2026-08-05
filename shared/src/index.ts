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
  address?: string | null;
  neighborhood?: string | null;
  lat: number;
  lng: number;
}

export type RouteSegmentKind = 'text' | 'bridge' | 'legacy';
export type RouteRoutingStatus = 'pending' | 'ready' | 'stale' | 'failed';

export interface PublicRouteText extends PublicText {
  author: Pick<PublicAuthorSummary, 'id' | 'name' | 'photo_url'>;
  point: PublicRoutePoint;
  content: string;
}

export interface PublicRouteSegmentBase {
  id: string;
  position: number;
  transition_text_pt?: string | null;
  point?: PublicRoutePoint;
  waypoint?: RouteWaypoint;
}

export interface PublicTextRouteSegment extends PublicRouteSegmentBase {
  kind: 'text';
  text: PublicRouteText;
}

export interface PublicBridgeRouteSegment extends PublicRouteSegmentBase {
  kind: 'bridge';
  content: string;
  content_pt: string;
  audio_files: PublicAudioFile[];
}

export interface LegacyPublicRouteItem extends PublicRouteSegmentBase {
  kind?: 'legacy';
}

export type PublicRouteSegment =
  | PublicTextRouteSegment
  | PublicBridgeRouteSegment
  | LegacyPublicRouteItem;

/** @deprecated Use PublicRouteSegment and the `segments` response field. */
export type PublicRouteItem = PublicRouteSegment;

export interface RouteWaypoint {
  lat: number;
  lng: number;
}

export interface RouteLeg {
  id: string;
  position: number;
  from_segment_id: string;
  to_segment_id: string;
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  waypoints: RouteWaypoint[];
  distance_m: number;
  duration_s: number;
  provider: string;
}

export interface RouteApproachRequest {
  lat: number;
  lng: number;
}

export interface RouteApproach {
  geometry: RouteLeg['geometry'];
  distance_m: number;
  duration_s: number;
  provider: string;
  destination_segment_id: string;
}

export interface PublicRoute {
  id: string;
  slug?: string | null;
  title_pt: string;
  description_pt?: string | null;
  title: string;
  description?: string | null;
  cover_image_url?: string | null;
  difficulty?: string | null;
  is_published?: boolean;
  estimated_distance_m?: number | null;
  estimated_duration_s?: number | null;
  routing_status?: RouteRoutingStatus;
  text_count?: number;
  authors?: string[];
  segments?: PublicRouteSegment[];
  legs?: RouteLeg[];
  items_deprecated?: boolean;
  /** @deprecated Use `segments`. */
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
  recipe_hash?: string | null;
  content_hash?: string | null;
  generation_spec?: Record<string, unknown> | null;
}

export type AudioBundleImportAction =
  | 'create'
  | 'replace_automatic'
  | 'already_current'
  | 'preserve_manual'
  | 'unmatched'
  | 'invalid';

export interface AudioBundlePreviewRow {
  recipe_hash?: string;
  text_id?: string | null;
  text?: string | null;
  lang?: string | null;
  action?: AudioBundleImportAction;
  status?: 'exportable' | 'missing' | 'manual' | 'legacy' | 'invalid';
  reason: string;
}

export interface AudioBundlePreview {
  artifact_count: number;
  counts: Record<string, number>;
  rows: AudioBundlePreviewRow[];
}

export type GenerationPolicy = 'missing_only' | 'replace_automatic';
export type GenerationBatchStatus =
  | 'pending'
  | 'running'
  | 'awaiting_review'
  | 'completed'
  | 'partial_failure'
  | 'failed';

export interface GenerationProgress {
  total: number;
  processed: number;
  succeeded: number;
  skipped: number;
  failed: number;
}

export interface GenerationBatchReview {
  text_id: string;
  lang: SupportedLanguage;
  translation_id: string;
}

export interface GenerationBatchError {
  kind: 'translation' | 'audio';
  text_id: string;
  lang: SupportedLanguage;
  message?: string | null;
}

export interface GenerationBatchItem {
  kind: 'translation' | 'audio';
  text_id: string;
  lang: SupportedLanguage;
  status: string;
  skipped: boolean;
}

export interface ContentGenerationBatch {
  id: string;
  status: GenerationBatchStatus;
  current_stage:
    | 'generating_translations'
    | 'awaiting_review'
    | 'ready_for_translated_audio'
    | 'generating_audio'
    | 'completed';
  source: 'texts' | 'csv';
  voice_overrides: Record<string, string>;
  auto_approve_translations: boolean;
  generate_translated_audio: boolean;
  created_at: string;
  progress: GenerationProgress;
  pending_reviews: GenerationBatchReview[];
  errors: GenerationBatchError[];
  items?: GenerationBatchItem[];
}

export interface AdminUser {
  id: string;
  email: string;
  is_active: boolean;
}

export interface AdminManagedUser extends AdminUser {
  created_at: string;
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
  author?: AdminAuthor;
  point?: AdminPoint;
  translations?: Pick<AdminTranslation, 'lang' | 'content' | 'status'>[];
  audio_files?: Pick<AdminAudioFile, 'lang' | 'public_url' | 'duration_s' | 'manually_uploaded'>[];
}

export interface AdminRouteItem {
  id?: string;
  position: number;
  point_id?: string | null;
  waypoint_lat?: number | null;
  waypoint_lng?: number | null;
  transition_text_pt?: string | null;
}

export interface AdminRouteSegmentTranslation {
  id?: string;
  lang: SupportedLanguage;
  content: string;
  status: TranslationStatus;
}

export interface AdminRouteSegmentAudio {
  id?: string;
  lang: SupportedLanguage;
  public_url?: string | null;
  duration_s?: number | null;
  voice_id?: string | null;
  manually_uploaded?: boolean;
}

export interface AdminRouteSegment {
  id?: string;
  position: number;
  kind: Exclude<RouteSegmentKind, 'legacy'>;
  text_id?: string | null;
  bridge_content_pt?: string | null;
  text?: AdminText;
  translations?: AdminRouteSegmentTranslation[];
  audio_files?: AdminRouteSegmentAudio[];
}

export interface RouteReadinessIssue {
  code: string;
  path: string;
  message: string;
  segment_id?: string | null;
}

export interface RouteReadiness {
  lang: SupportedLanguage;
  ready: boolean;
  issues: RouteReadinessIssue[];
}

export interface RouteRecalculation {
  route_id: string;
  routing_status: RouteRoutingStatus;
  routing_hash: string;
  estimated_distance_m: number;
  estimated_duration_s: number;
  legs: RouteLeg[];
}

export interface AdminRoute {
  id: string;
  slug?: string | null;
  title_pt: string;
  description_pt?: string | null;
  cover_image_url?: string | null;
  difficulty?: string | null;
  is_published?: boolean;
  estimated_distance_m?: number | null;
  estimated_duration_s?: number | null;
  routing_status?: RouteRoutingStatus;
  migration_status?: 'ready' | 'needs_review';
  segments?: AdminRouteSegment[];
  legs?: RouteLeg[];
  items_deprecated?: boolean;
  /** @deprecated Use `segments`. */
  items?: AdminRouteItem[];
}

export type RouteSessionPhase =
  | 'preview'
  | 'going_to_first_text'
  | 'arrived'
  | 'listening'
  | 'walking'
  | 'completed';

export interface RouteSession {
  route_id: string;
  route_version: string;
  phase: RouteSessionPhase;
  active_text_index: number;
  active_leg_position?: number | null;
  approach_leg?: RouteApproach | null;
  consecutive_arrival_readings: number;
  updated_at: string;
}

export interface OfflineRouteManifest {
  route_id: string;
  route_version: string;
  lang: SupportedLanguage;
  asset_urls: string[];
  downloaded_at: string;
  estimated_bytes?: number | null;
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
  readonly detail?: unknown;

  constructor(message: string, status: number, path: string, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.path = path;
    this.detail = detail;
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

  async listRoutes(lang?: SupportedLanguage): Promise<PublicRoute[]> {
    return this.get<PublicRoute[]>(withQuery('/api/v1/routes', { lang }));
  }

  async getRoute(routeId: string, lang?: SupportedLanguage): Promise<PublicRoute> {
    return this.get<PublicRoute>(withQuery(`/api/v1/routes/${routeId}`, { lang }));
  }

  async calculateRouteApproach(
    routeId: string,
    location: RouteApproachRequest
  ): Promise<RouteApproach> {
    return this.post<RouteApproach>(
      `/api/v1/routes/${routeId}/approach`,
      location as unknown as RequestBody
    );
  }

  async listAdminRoutes(token: string): Promise<AdminRoute[]> {
    return this.get<AdminRoute[]>('/api/v1/admin/routes', token);
  }

  async saveAdminRoute(
    route: Omit<AdminRoute, 'id' | 'items' | 'legs'>,
    token: string,
    routeId?: string
  ): Promise<AdminRoute> {
    const path = routeId ? `/api/v1/admin/routes/${routeId}` : '/api/v1/admin/routes';
    return routeId
      ? this.put<AdminRoute>(path, route as unknown as RequestBody, token)
      : this.post<AdminRoute>(path, route as unknown as RequestBody, token);
  }

  async recalculateRoute(
    routeId: string,
    legs: { position: number; waypoints: RouteWaypoint[] }[],
    token: string
  ): Promise<RouteRecalculation> {
    return this.post<RouteRecalculation>(
      `/api/v1/admin/routes/${routeId}/recalculate`,
      { legs },
      token
    );
  }

  async getRouteReadiness(
    routeId: string,
    lang: SupportedLanguage,
    token: string
  ): Promise<RouteReadiness> {
    return this.get<RouteReadiness>(
      withQuery(`/api/v1/admin/routes/${routeId}/readiness`, { lang }),
      token
    );
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
      let detail: unknown;
      try {
        const errorPayload = (await response.json()) as { detail?: unknown };
        detail = errorPayload.detail;
      } catch {
        detail = undefined;
      }
      throw new ApiError(`API request failed: ${path}`, response.status, path, detail);
    }

    const payload = (await response.json()) as T | ApiEnvelope<T>;
    return isEnvelope(payload) ? payload.data : payload;
  }
}

export function routeSegments(route: Pick<PublicRoute, 'segments' | 'items'>): PublicRouteSegment[] {
  return route.segments ?? route.items ?? [];
}

export function routeVersion(route: Pick<PublicRoute, 'id' | 'routing_status' | 'legs'>): string {
  const legSignature = (route.legs ?? [])
    .map((leg) => `${leg.id}:${leg.distance_m}:${leg.duration_s}`)
    .join('|');
  return `${route.id}:${route.routing_status ?? 'pending'}:${legSignature}`;
}

export function routeAssetUrls(route: PublicRoute): string[] {
  const urls = new Set<string>();
  if (route.cover_image_url) urls.add(route.cover_image_url);
  for (const segment of routeSegments(route)) {
    if (segment.kind === 'text' && segment.text.author.photo_url) {
      urls.add(segment.text.author.photo_url);
    }
    if (segment.kind === 'text') {
      for (const audio of segment.text.audio_files ?? []) {
        if (audio.public_url) urls.add(audio.public_url);
      }
    }
    if (segment.kind === 'bridge') {
      for (const audio of segment.audio_files) {
        if (audio.public_url) urls.add(audio.public_url);
      }
    }
  }
  return [...urls];
}

function withQuery(path: string, values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function isEnvelope<T>(payload: T | ApiEnvelope<T>): payload is ApiEnvelope<T> {
  return typeof payload === 'object' && payload !== null && 'data' in payload && 'meta' in payload;
}
