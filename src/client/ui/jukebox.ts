import { JUKEBOX_TUNES, STREAM, checkStreamUrl, trackTitle, tuneById } from '../../shared/jukebox';
import { t } from '../i18n';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, toast } from './dom';

/** The jukebox: what's on, the tunes to pick from, skip and stop, and a box for a stream. */
export function openJukebox(net: Net, openVolume: () => void) {
  const close = h('button.btn.close', { 'aria-label': t('windows.common.close') }, '✕');
  const now = h('div.jb-now');
  const list = h('ul.svc-list');
  const url = h('input', { type: 'text', placeholder: t('windows.jukebox.urlPlaceholder'), 'aria-label': t('windows.jukebox.urlLabel'), spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const playUrl = h('button.btn.primary', { type: 'button' }, t('windows.jukebox.playStream'));
  const volume = h('button.btn', { type: 'button' }, t('windows.jukebox.volume'));
  const el = h(
    'div.modal.jukebox',
    { role: 'dialog', 'aria-label': t('windows.jukebox.title') },
    h('header', {}, h('h2', {}, t('windows.jukebox.heading')), close),
    h(
      'div.body',
      {},
      now,
      h('label', { style: 'margin-top:16px' }, t('windows.jukebox.pickTune')),
      list,
      h('label', { style: 'margin-top:16px' }, t('windows.jukebox.orStream')),
      h('div.webhook', {}, url, playUrl),
      h('p.setting-note', {}, t('windows.jukebox.streamNote')),
    ),
    h('footer', {}, h('span.grow', {}, t('windows.jukebox.footer')), volume),
  );

  const button = (label: string, title: string, send: () => void, primary = false) => h(primary ? 'button.btn.primary' : 'button.btn', { type: 'button', title, onclick: send }, label);

  const render = () => {
    const j = store.jukebox;
    const stream = j.track === STREAM;
    now.replaceChildren(
      h('span.jb-disc', { class: j.on ? 'spin' : '' }, stream ? '📻' : '💿'),
      h(
        'div.svc-main',
        {},
        h('div.svc-title', {}, j.on ? trackTitle(j) : t('windows.jukebox.off')),
        h(
          'div.svc-meta',
          {},
          j.on
            ? [stream ? t('windows.jukebox.aStream') : tuneById(j.track)?.mood, j.by && t('windows.jukebox.putOnBy', { name: j.by })].filter(Boolean).join(' · ')
            : j.by
              ? t('windows.jukebox.turnedOff', { name: j.by })
              : t('windows.jukebox.pickToStart'),
        ),
      ),
      j.on
        ? button(t('windows.jukebox.skip'), t('windows.jukebox.skipTitle'), () => net.send({ t: 'jukebox.skip' }))
        : button(t('windows.jukebox.play'), t('windows.jukebox.playTitle', { title: trackTitle(j) }), () => net.send({ t: 'jukebox.play' }), true),
      j.on ? button(t('windows.jukebox.stop'), t('windows.jukebox.stopTitle'), () => net.send({ t: 'jukebox.stop' })) : '',
    );
    list.replaceChildren(
      ...JUKEBOX_TUNES.map((tune) => {
        const playing = j.on && j.track === tune.id;
        const li = h(
          'li',
          { class: playing ? 'on' : '', tabindex: 0, role: 'button', 'aria-pressed': String(playing), title: playing ? t('windows.jukebox.playingNow') : t('windows.jukebox.putOn', { title: tune.title }) },
          h('span.jb-icon', {}, playing ? '🔊' : '🎵'),
          h('div.svc-main', {}, h('div.svc-title', {}, tune.title), h('div.svc-meta', {}, tune.mood)),
        );
        const pick = () => {
          if (!playing) net.send({ t: 'jukebox.play', track: tune.id });
        };
        li.addEventListener('click', pick);
        li.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            pick();
          }
        });
        return li;
      }),
    );
  };

  const play = () => {
    const u = checkStreamUrl(url.value);
    if ('error' in u) {
      toast(u.error, 'warn');
      return url.focus();
    }
    net.send({ t: 'jukebox.play', url: u.url });
    url.value = '';
  };
  playUrl.addEventListener('click', play);
  url.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') play();
  });

  const modal = openModal(el, { doing: '🎵 at the jukebox', onClose: store.on('jukebox', render) });
  close.addEventListener('click', () => modal.close());
  volume.addEventListener('click', () => {
    modal.close();
    openVolume();
  });
  render();
}
