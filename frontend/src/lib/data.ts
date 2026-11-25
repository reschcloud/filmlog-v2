import { fetchCached, cacheSet, type Cached } from "./cache";
import { api } from "../api";
import type { Catalog, Dashboard, FrameSuggestion } from "../types";

const CATALOG_KEY = "catalog";
const DASHBOARD_KEY = "dashboard";

export function getCatalog(): Promise<Cached<Catalog>> {
  return fetchCached<Catalog>(CATALOG_KEY, "/api/v2/catalog");
}

export function getDashboard(): Promise<Cached<Dashboard>> {
  return fetchCached<Dashboard>(DASHBOARD_KEY, "/api/v2/dashboard");
}

export function getFrameSuggestion(roll: number): Promise<Cached<FrameSuggestion>> {
  return fetchCached<FrameSuggestion>(`frame-suggestion.${roll}`, `/api/v2/suggestions/frame?roll=${roll}`);
}

/** Katalog nach Änderungen frisch laden und im Cache ablegen. */
export async function reloadCatalog(): Promise<Catalog> {
  const data = await api.get<Catalog>("/api/v2/catalog");
  cacheSet(CATALOG_KEY, data);
  return data;
}
