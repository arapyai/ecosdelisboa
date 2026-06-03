import type { ContentType, SupportedLanguage } from '@ecosdelisboa/shared';

export type Lang = SupportedLanguage;
export type { ContentType };

export interface Author {
  id: string;
  name: string;
  bio_pt?: string | null;
  bio_en?: string | null;
  birth_year?: number | null;
  death_year?: number | null;
  photo_url?: string | null;
  elevenlabs_voice_id?: string | null;
  points_count?: number;
}

export interface TextEntry {
  id: string;
  point_id: string;
  author_id?: string | null;
  author?: Author;
  content_pt: string;
  content_en?: string | null;
  source_work?: string | null;
  source_year?: number | null;
  content_type: ContentType;
}

export interface AudioTrack {
  id: string;
  lang: Lang;
  url: string;
  duration_sec?: number;
  transcript?: TranscriptCue[];
}

export interface TranscriptCue {
  start: number;
  end: number;
  text: string;
}

export interface Point {
  id: string;
  author_id?: string | null;
  authors?: Author[];
  title_pt: string;
  title_en?: string | null;
  address?: string | null;
  neighborhood?: string | null;
  lat: number;
  lng: number;
  distance_m?: number;
  author?: Author;
  texts?: TextEntry[];
  audios?: AudioTrack[];
}

export interface RoutePoint {
  id: string;
  route_id: string;
  point_id?: string | null;
  point?: Point;
  lat_override?: number | null;
  lng_override?: number | null;
  order_index: number;
  transition_text_pt?: string | null;
  transition_text_en?: string | null;
}

export interface Route {
  id: string;
  title_pt: string;
  title_en?: string | null;
  description_pt?: string | null;
  description_en?: string | null;
  distance_m?: number | null;
  duration_min?: number | null;
  cover_image_url?: string | null;
  published?: boolean;
  points?: RoutePoint[];
}

export interface DefaultVoice {
  voice_id: string;
  provider?: string;
  language?: Lang;
}
