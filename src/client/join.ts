import { t } from './i18n';
import { serverError } from './i18n/errors';

// An invite link, /join#<token>: make your own account, then walk in. The token rides in the
// fragment, so it never reaches a server log or a Referer header.
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const token = location.hash.slice(1);
const form = $<HTMLFormElement>('form');
const name = $<HTMLInputElement>('name');
const password = $<HTMLInputElement>('password');
const again = $<HTMLInputElement>('again');
const submit = $<HTMLButtonElement>('submit');
const error = $('error');

// The page's own words, in your language.
document.title = t('pages.joinTitle');
$('title').textContent = t('pages.joinInvited');
$('sub').textContent = t('pages.joinChecking');
const labels = form.querySelectorAll('label');
labels[0].firstChild!.textContent = t('pages.yourName');
labels[1].firstChild!.textContent = t('pages.joinPickPassword');
labels[2].firstChild!.textContent = t('pages.joinAgain');
form.querySelector('.note')!.textContent = t('pages.joinNote');
submit.textContent = t('pages.joinSubmit');
$('login').textContent = t('pages.toSignIn');

function fail(msg: string) {
  $('sub').textContent = '';
  form.hidden = true;
  error.textContent = msg;
  $('login').hidden = false;
}

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; body: any }> {
  const res = await fetch('/api/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, ...body }) });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

async function peek() {
  if (!token) return fail(t('pages.joinNoCode'));
  try {
    const r = await post({ peek: true });
    if (!r.ok) return fail(serverError(r.body.error, 'pages.joinBroken'));
    const { name: invited, role, by, project } = r.body as { name?: string; role: string; by: string; project: string };
    $('title').textContent = t('pages.joinOffice', { project });
    const sub = $('sub');
    if (role === 'admin') {
      // The role sits in the sentence as a pill, wherever the language puts it.
      const [before, after] = t('pages.joinByAs', { by }).split('{role}');
      const pill = document.createElement('span');
      pill.className = 'role';
      pill.textContent = t('pages.joinAdmin');
      sub.replaceChildren(before, pill, after);
    } else {
      sub.replaceChildren(t('pages.joinBy', { by }));
    }
    sub.append(' ', t('pages.joinMakeAccount'));
    if (invited) {
      name.value = invited;
      name.readOnly = true;
      name.title = t('pages.joinInvitedName');
    }
    form.hidden = false;
    (invited ? password : name).focus();
  } catch {
    fail(t('pages.unreachable'));
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.textContent = '';
  if (password.value !== again.value) {
    error.textContent = t('pages.joinMismatch');
    again.select();
    return;
  }
  submit.disabled = true;
  try {
    const r = await post({ name: name.value.trim(), password: password.value });
    if (!r.ok) {
      error.textContent = serverError(r.body.error, 'pages.joinFailed');
      return;
    }
    try {
      localStorage.setItem('agent-office.login-name', r.body.name);
    } catch {
      // storage blocked
    }
    location.replace('/');
  } catch {
    error.textContent = t('pages.unreachable');
  } finally {
    submit.disabled = false;
  }
});

void peek();
