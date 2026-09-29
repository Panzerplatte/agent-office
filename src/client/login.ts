import { t } from './i18n';
import { serverError } from './i18n/errors';

const form = document.getElementById('form') as HTMLFormElement;
const nameRow = document.getElementById('name-row') as HTMLLabelElement;
const nameInput = document.getElementById('name') as HTMLInputElement;
const nameNote = document.getElementById('name-note') as HTMLParagraphElement;
const sub = document.getElementById('sub') as HTMLParagraphElement;
const input = document.getElementById('password') as HTMLInputElement;
const error = document.getElementById('error') as HTMLParagraphElement;
const submit = document.getElementById('submit') as HTMLButtonElement;

// The page's own words, in your language.
document.title = t('pages.loginTitle');
sub.textContent = t('pages.loginPassword');
nameRow.firstChild!.textContent = t('pages.yourName');
(input.parentElement as HTMLLabelElement).firstChild!.textContent = t('pages.password');
nameNote.textContent = t('pages.loginNameNote');
submit.textContent = t('pages.loginSubmit');

const NAME_KEY = 'agent-office.login-name';

// A sign-in link from the office's terminal (/login#key=…): it works once, so take it out of the
// address bar and trade it for a session. The key is after the #, so it never reaches a server log.
const linkKey = new URLSearchParams(location.hash.slice(1)).get('key');
if (linkKey) {
  history.replaceState(null, '', location.pathname);
  void fetch('/api/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: linkKey }) })
    .then(async (res) => {
      if (res.ok) return location.replace('/');
      error.textContent = serverError(((await res.json().catch(() => ({}))) as { error?: string }).error, 'pages.loginFailed');
    })
    .catch(() => void (error.textContent = t('pages.unreachable')));
}

// Ask for a name once people have accounts; it's optional while the shared password still works.
void fetch('/api/login', { cache: 'no-store' })
  .then((r) => r.json())
  .then(({ accounts, shared }: { accounts: boolean; shared: boolean }) => {
    if (!accounts && shared) return;
    nameRow.hidden = false;
    nameInput.required = !shared;
    nameNote.hidden = !shared;
    sub.textContent = t(shared ? 'pages.loginWho' : 'pages.loginWhoOwn');
    try {
      nameInput.value = localStorage.getItem(NAME_KEY) ?? '';
    } catch {
      // storage blocked
    }
    (nameInput.value ? input : nameInput).focus();
  })
  .catch(() => {});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.textContent = '';
  submit.disabled = true;
  const name = nameRow.hidden ? '' : nameInput.value.trim();
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, password: input.value }),
    });
    if (res.ok) {
      try {
        localStorage.setItem(NAME_KEY, name);
      } catch {
        // storage blocked
      }
      location.href = '/';
      return;
    }
    const body = await res.json().catch(() => ({}));
    error.textContent = serverError(body.error, 'pages.loginFailed');
    input.select();
  } catch {
    error.textContent = t('pages.unreachable');
  } finally {
    submit.disabled = false;
  }
});
