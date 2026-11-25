let rerender: () => void = () => {};

export function setRerender(fn: () => void): void {
  rerender = fn;
}

/** Hash-Navigation, z. B. navigate("film/42/5"). Gleiche Adresse -> Ansicht neu laden. */
export function navigate(path: string): void {
  if (location.hash.slice(1) === path) {
    rerender();
  } else {
    location.hash = path;
  }
}

export function currentRoute(): { name: string; params: string[] } {
  const [name, ...params] = location.hash.slice(1).split("/");
  return { name: name || "start", params };
}
