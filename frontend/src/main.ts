import "./style.css";
import { registerSW } from "virtual:pwa-register";
import { setUnauthorizedHandler } from "./api";
import { fetchMe } from "./lib/auth";
import { setErrorState, toast } from "./lib/dom";
import { EVT_QUEUE, EVT_SYNCED } from "./lib/events";
import { currentRoute, navigate, setRerender } from "./lib/nav";
import { failedFrameCount, flushQueue, queueCount, queuedFrameCount, type FlushResult } from "./lib/queue";
import type { ViewContext, ViewFn } from "./lib/view";
import { renderCatalog } from "./views/catalog";
import { renderDashboard } from "./views/dashboard";
import { renderLogin } from "./views/login";
import { renderMore } from "./views/more";
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
  mehr: renderMore,
};

document.title = `Filmlog v${__APP_VERSION__}`;

const app = document.getElementById("app") as HTMLElement;
const backBtn = document.getElementById("backBtn") as HTMLButtonElement;
const bottomNav = document.getElementById("bottomNav") as HTMLElement;
const failedBadge = document.getElementById("failedBadge") as HTMLElement;

const NAV_KEY: Record<string, string> = {
  start: "start",
  "neuer-film": "start",
  filme: "filme",
  film: "filme",
  suche: "suche",
  "neue-aufnahme": "aufnahme",
  mehr: "mehr",
  zuletzt: "mehr",
  stats: "mehr",
  optionen: "mehr",
  einstellungen: "mehr",
};
const queueBadge = document.getElementById("queueBadge") as HTMLButtonElement;
const netBadge = document.getElementById("netBadge") as HTMLElement;

let renderToken = 0;
let loginShown = false;
let loggedIn = false;

function renderRoute(): void {
  if (!loggedIn) return;
  const my = ++renderToken;
  const { name, params } = currentRoute();
  const routeName = routes[name] ? name : "start";
  const fn = routes[routeName] ?? routes.start;
  const capture = routeName === "neue-aufnahme";
  backBtn.hidden = routeName === "start";
  bottomNav.hidden = capture;
  document.body.classList.toggle("capture-mode", capture);
  document.body.classList.toggle("nav-visible", !capture);
  const navKey = NAV_KEY[routeName] ?? "mehr";
  bottomNav.querySelectorAll<HTMLAnchorElement>("a").forEach((a) => {
    const active = a.dataset.nav === navKey;
    a.classList.toggle("aktiv", active);
    if (active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
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
  bottomNav.hidden = true;
  document.body.classList.remove("nav-visible", "capture-mode");
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
  const n = await queuedFrameCount();
  const failed = await failedFrameCount();
  queueBadge.hidden = n === 0;
  queueBadge.textContent = String(n);
  queueBadge.title = `${n} Aufnahme(n) offline gespeichert`;
  queueBadge.setAttribute("aria-label", `${n} Aufnahme(n) offline gespeichert`);
  failedBadge.hidden = failed === 0;
  failedBadge.textContent = String(failed);
  failedBadge.title = `${failed} Aufnahme(n) nicht gesendet – siehe Mehr`;
  failedBadge.setAttribute("aria-label", `${failed} Aufnahme(n) nicht gesendet`);
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
  if (res.dropped.length > 0) {
    toast(
      `${res.dropped.length} Aufnahme(n) nicht gesendet: ${res.dropped[0]!.message} – siehe „Mehr“.`,
      "error",
      9000,
    );
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
