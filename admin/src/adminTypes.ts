import type {
  AdminAuthor,
  AdminPoint,
  AdminRoute,
  AdminRouteItem,
  AdminText
} from '@ecosdelisboa/shared';

export type Resource = 'authors' | 'points' | 'texts' | 'routes';
export type Section = Resource | 'csv' | 'pronunciation';
export type ResourceItem = AdminAuthor | AdminPoint | AdminText | AdminRoute;
export type DraftValue = string | number | boolean | null | AdminRouteItem[];
export type Draft = Record<string, DraftValue>;
export type FieldOption = { value: string; label: string };
export type ImportPreviewRow = {
  row_number: number;
  author_name: string;
  title: string;
  action: 'create' | 'update' | 'error';
  errors: string[];
};
export type ImportResult = {
  created: number;
  updated: number;
  errors: ImportPreviewRow[];
};
export type FieldConfig = {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'checkbox' | 'number' | 'url' | 'select' | 'route-items';
  options?: FieldOption[];
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number | 'any';
};
export type FieldContext = {
  authors: AdminAuthor[];
  authorsReady: boolean;
  points: AdminPoint[];
  pointsReady: boolean;
};
export type GeocodingFeature = {
  id: string;
  text?: string;
  place_name?: string;
  center?: [number, number];
  context?: Array<{ id?: string; text?: string }>;
  place_type?: string[];
};
