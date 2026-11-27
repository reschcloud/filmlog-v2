import type { ViewContext } from "../lib/view";

export function renderMore(ctx: ViewContext): void {
  ctx.el.innerHTML = `
    <h1 class="view-title">Mehr</h1>
    <div class="more-list">
      <a class="more-item" href="#neuer-film">Neuer Film</a>
      <a class="more-item" href="#zuletzt">Zuletzt eingetragen</a>
      <a class="more-item" href="#stats">Stats</a>
      <a class="more-item" href="#optionen">Auswahllisten</a>
      <a class="more-item" href="#einstellungen">Einstellungen</a>
    </div>`;
}