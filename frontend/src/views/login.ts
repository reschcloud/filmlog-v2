import { errMsg } from "../api";
import { login } from "../lib/auth";
import { qs, showError, withBusy } from "../lib/dom";

export function renderLogin(el: HTMLElement, onSuccess: () => void): void {
  el.innerHTML = `
    <h1 class="view-title">Anmelden</h1>
    <form id="loginForm" class="card" autocomplete="on">
      <label>Benutzername
        <input type="text" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" required>
      </label>
      <label>Passwort
        <input type="password" name="password" autocomplete="current-password" required>
      </label>
      <label class="check-label">
        <input type="checkbox" name="remember" checked>
        Angemeldet bleiben
      </label>
      <button type="submit" class="btn-primary">Anmelden</button>
    </form>`;
  const form = qs<HTMLFormElement>(el, "#loginForm");
  const submit = qs<HTMLButtonElement>(form, "button[type=submit]");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const username = String(fd.get("username") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    const remember = form.elements.namedItem("remember") as HTMLInputElement;
    await withBusy(submit, async () => {
      try {
        await login(username, password, remember.checked);
        onSuccess();
      } catch (err) {
        showError(form, errMsg(err));
      }
    });
  };
  qs<HTMLInputElement>(form, "input[name=username]").focus();
}
