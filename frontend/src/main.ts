import "./style.css";
import { registerSW } from "virtual:pwa-register";
import { setUnauthorizedHandler } from "./api";
import { fetchMe } from "./lib/auth";
import { setErrorState, toast } from "./lib/dom";
import { EVT_QUEUE, EVT_SYNCED } from "./lib/events";
import { currentRoute, navigate, setRerender } from "./lib/nav";
import { flushQueue, queueCount, type FlushResult } from "./lib/queue";
import type { ViewContext, ViewFn } from "./lib/view";
import { renderCatalog } from "./views/catalog";
import { renderDashboard } from "./views/dashboard";
import { renderLogin } from "./views/login";
import { renderNewFrame } from "./views/newFrame";
import { renderNewRoll } from "./views/newRoll";
import { renderRecent } from "./views/recent";
import { renderRollDetail } from "./views/rollDetail";
import { renderRolls } from "./views/rolls";
import { renderSearch } from "./views/search";
import { renderSettings } from "./views/settings";
import { renderStats } from "./views/stats";

const routes: Record<string, ViewFn> = {
  start: renderDashboard,
  "neuer-film": renderNewRoll,
  "neue-aufnahme": renderNewFrame,
  filme: renderRolls,
  film: renderRollDetail,
  zuletzt: renderRecent,
  suche: renderSearch,
  stats: renderStats,
  optionen: renderCatalog,
  einstellungen: renderSettings,
};

document.title = `Filmlog v${__APP_VERSION__}`;

const app = document.getElementById("app") as HTMLElement;
const backBtn = document.getElementById("backBtn") as HTMLButtonElement;
const queueBadge = document.getElementById("queueBadge") as HTMLButtonElement;
const netBadge = document.getElementById("netBadge") as HTMLElement;

let renderToken = 0;
let loginShown = false;
let loggedIn = false;

function renderRoute(): void {
  if (!loggedIn) return;
  const my = ++renderToken;
  const { name, params } = currentRoute();
  const fn = routes[name] ?? routes.start;
  backBtn.hidden = name === "start";
  const el = document.createElement("section");
  el.className = "view";
  app.replaceChildren(el);
  window.scrollTo(0, 0);
  const ctx: ViewContext = { el, params, alive: () => my === renderToken && el.isConnected };
  Promise.resolve()
    .then(() => fn(ctx))
    .catch((e: unknown) => {
      if (ctx.alive()) setErrorState(el, e);
    });
}

function showLogin(): void {
  if (loginShown) return;
  loginShown = true;
  loggedIn = false;
  backBtn.hidden = true;
  renderToken++;
  document.body.classList.add("logged-out");
  const el = document.createElement("section");
  el.className = "view";
  app.replaceChildren(el);
  renderLogin(el, () => {
    loginShown = false;
    enterApp();
  });
}

function enterApp(): void {
  loggedIn = true;
  loginShown = false;
  document.body.classList.remove("logged-out");
  renderRoute();
  void updateBadge();
  void syncQueue(false);
}

async function updateBadge(): Promise<void> {
  const n = await queueCount();
  queueBadge.hidden = n === 0;
  queueBadge.textContent = String(n);
  queueBadge.title = `${n} offline gespeichert`;
  queueBadge.setAttribute("aria-label", `${n} offline gespeichert`);
}

async function syncQueue(announce: boolean): Promise<void> {
  if (!loggedIn) return;
  const n = await queueCount();
  if (n === 0) {
    if (announce) toast("Nichts zu senden.");
    return;
  }
  const res = await flushQueue();
  if (announce && res.sent === 0 && res.dropped.length === 0) {
    toast(res.skipped ? "Offline – wird später gesendet." : "Senden nicht möglich, später erneut.", "error");
  }
}

function updateNet(): void {
  netBadge.hidden = navigator.onLine;
}

setRerender(renderRoute);
setUnauthorizedHandler(showLogin);
window.addEventListener("hashchange", renderRoute);

// Auf der Startseite ändert der Logo-Klick den Hash nicht – dann nach oben scrollen.
document.querySelector<HTMLAnchorElement>(".brand")?.addEventListener("click", () => {
  if (location.hash === "#start") window.scrollTo({ top: 0, behavior: "smooth" });
});

backBtn.addEventListener("click", () => {
  if (history.length > 1) history.back();
  else navigate("start");
});

window.addEventListener(EVT_QUEUE, () => void updateBadge());
window.addEventListener(EVT_SYNCED, (ev) => {
  const res = (ev as CustomEvent<FlushResult>).detail;
  if (res.sent > 0) {
    toast(`${res.sent} offline gespeicherte Eintragung${res.sent === 1 ? "" : "en"} gesendet.`, "ok");
  }
  for (const d of res.dropped) {
    toast(`Offline-Aufnahme „${d.item.label}“ abgelehnt: ${d.message}`, "error", 9000);
  }
  const route = currentRoute().name;
  if (route === "start" || route === "zuletzt") renderRoute();
});

queueBadge.addEventListener("click", () => void syncQueue(true));
window.addEventListener("online", () => {
  updateNet();
  void syncQueue(false);
});
window.addEventListener("offline", updateNet);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void syncQueue(false);
});
window.setInterval(() => void syncQueue(false), 60_000);
updateNet();

registerSW({ immediate: true });

async function boot(): Promise<void> {
  const me = await fetchMe();
  if (me === "unauthorized") {
    showLogin();
  } else {
    // "offline": App trotzdem starten, die Daten kommen dann aus dem lokalen Cache
    enterApp();
  }
}

void boot();
