import { t } from './i18n';
import { serverError } from './i18n/errors';

// One-time password reveal: /claim?t=<token>. The server forgets the plaintext as soon as it answers.
const $ = (id: string) => document.getElementById(id)!;
const token = new URLSearchParams(location.search).get('t') ?? '';
// Keep the single-use token out of the address bar and history.
history.replaceState(null, '', '/claim');

// The page's own words, in your language.
document.title = t('pages.claimTitle');
$('title').textContent = t('pages.claimReady');
$('sub').textContent = t('pages.claimUnlocking');
const strong = document.createElement('strong');
strong.textContent = t('pages.claimWriteDown');
$('reveal').querySelector('.warn')!.replaceChildren(strong, ' ', t('pages.claimWarn'));
$('copy').textContent = t('pages.claimCopy');
$('saved').nextSibling!.textContent = ` ${t('pages.claimSaved')}`;
$('enter').textContent = t('pages.claimEnter');
$('login').textContent = t('pages.toSignIn');

function fail(msg: string) {
  $('sub').textContent = '';
  $('error').textContent = msg;
  $('login').hidden = false;
}

async function claim() {
  if (!token) return fail(t('pages.claimNoToken'));
  try {
    const res = await fetch('/api/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return fail(serverError(body.error, 'pages.claimFailed'));
    $('sub').textContent = t('pages.claimLastThing');
    $('pw').textContent = body.password;
    $('reveal').hidden = false;
  } catch {
    fail(t('pages.unreachable'));
  }
}

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('pw').textContent ?? '');
    $('copy').textContent = t('pages.claimCopied');
  } catch {
    getSelection()?.selectAllChildren($('pw'));
  }
});
($('saved') as HTMLInputElement).addEventListener('change', (e) => {
  ($('enter') as HTMLButtonElement).disabled = !(e.target as HTMLInputElement).checked;
});
$('enter').addEventListener('click', () => location.replace('/'));
window.addEventListener('beforeunload', (e) => {
  if (!$('reveal').hidden && !($('saved') as HTMLInputElement).checked) e.preventDefault();
});
void claim();
