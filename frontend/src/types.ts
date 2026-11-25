// Typen exakt nach docs/API.md

export type RollStatus = "offen" | "abgeschlossen" | "entwickelt" | "gescannt" | "archiviert";
export type FilmType = "sw" | "farbe" | "dia" | "anderes";
export type CameraFormat =
  | "35mm" | "halbformat" | "6x4.5" | "6x6" | "6x7" | "6x9" | "4x5" | "instant" | "anderes";
export type FilmFormat = "35mm" | "120" | "4x5" | "instant" | "anderes";

export interface Camera {
  id: number;
  name: string;
  format: CameraFormat;
  default_capacity: number | null;
  notes: string | null;
  archived: boolean;
  lens_ids: number[];
  usage_count: number;
  last_used_at: string | null;
}

export interface Lens {
  id: number;
  name: string;
  focal_length_mm: number | null;
  max_aperture: number | null;
  archived: boolean;
  usage_count: number;
  last_used_at: string | null;
}

export interface FilmStock {
  id: number;
  name: string;
  manufacturer: string | null;
  iso: number | null;
  type: FilmType;
  format: FilmFormat;
  default_capacity: number | null;
  archived: boolean;
  usage_count: number;
  last_used_at: string | null;
}

export interface ShutterSpeed {
  id: number;
  label: string;
  seconds: number | null;
}

export interface Aperture {
  id: number;
  label: string;
  f_number: number;
}

export interface Catalog {
  cameras: Camera[];
  lenses: Lens[];
  film_stocks: FilmStock[];
  shutter_speeds: ShutterSpeed[];
  apertures: Aperture[];
}

export interface Roll {
  number: number;
  film_stock: { id: number; name: string; type: FilmType; iso: number | null };
  camera: { id: number; name: string };
  expiry_year: number | null;
  capacity: number;
  iso: number | null;
  iso_override: number | null;
  notes: string | null;
  status: RollStatus;
  created_at: string;
  completed_at: string | null;
  developed_at: string | null;
  scanned_at: string | null;
  archived_at: string | null;
  frame_count: number;
  last_frame_at: string | null;
  is_full: boolean;
  expired_years: number;
}

export interface Frame {
  id: number;
  roll_number: number;
  position: number;
  date: string;
  time: string;
  location_text: string | null;
  lat: number | null;
  lon: number | null;
  lens_id: number | null;
  lens_name: string | null;
  shutter: string | null;
  shutter_seconds: number | null;
  aperture: string | null;
  f_number: number | null;
  focal_length: number | null;
  flash: boolean;
  motif: string | null;
  recorded_at: string;
  updated_at: string;
}

export interface FrameWithRoll extends Frame {
  roll: {
    number: number;
    camera_name: string;
    film_stock_name: string;
    type: FilmType;
    status: RollStatus;
  };
}

export interface RollDetail extends Roll {
  frames: Frame[];
}

export interface Hint {
  kind: "voll" | "lange_in_kamera" | "entwickeln" | "abgelaufen";
  roll_number: number;
  text: string;
}

export interface Dashboard {
  open_rolls: Roll[];
  last_frame: FrameWithRoll | null;
  to_develop: { total: number; sw: number; farbe: number; dia: number; anderes: number };
  hints: Hint[];
}

export interface FrameSuggestion {
  lens_id: number | null;
  shutter: string | null;
  aperture: string | null;
  motif: string | null;
  lens_ids: number[];
}

export interface RollSuggestion {
  capacity: number | null;
  expiry_year: number | null;
  type: FilmType | null;
  iso: number | null;
}

export interface PlaceSuggestion {
  location_text: string;
  distance_m: number;
}

export interface SearchResult {
  frames: FrameWithRoll[];
  rolls: Roll[];
}

export interface RecentFrames {
  items: FrameWithRoll[];
  next_cursor: string | null;
}

export interface StatsItem {
  name: string;
  count: number;
  key?: string;
  type?: FilmType;
}

export interface Stats {
  range: string;
  frames_total: number;
  rolls_total: number;
  by_type: StatsItem[];
  by_camera: StatsItem[];
  by_film_stock: StatsItem[];
  rolls_by_film_stock: StatsItem[];
  by_lens: StatsItem[];
  by_shutter: StatsItem[];
  by_aperture: StatsItem[];
  by_month: { month: string; frames: number; rolls: number }[];
  locations: {
    lat: number;
    lon: number;
    motif: string | null;
    roll_number: number;
    position: number;
    date: string;
  }[];
}

export interface TokenInfo {
  id: number;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

export interface NewToken extends TokenInfo {
  token: string;
}

export interface ImportReport {
  dry_run: boolean;
  rolls: number;
  frames: number;
  cameras: number;
  lenses: number;
  film_stocks: number;
  shutter_speeds: number;
  apertures: number;
  skipped_rolls: number;
  warnings: string[];
}

export interface CreateFramePayload {
  position?: number;
  count?: number;
  client_id?: string;
  recorded_at?: string;
  date: string;
  time: string;
  location_text?: string | null;
  lat?: number | null;
  lon?: number | null;
  lens_id?: number | null;
  shutter?: string | null;
  aperture?: string | null;
  flash?: boolean;
  motif?: string | null;
}

export interface DeleteResult {
  deleted: boolean;
  archived?: boolean;
}
