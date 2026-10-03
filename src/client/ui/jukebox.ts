import { CASINO } from '../../shared/casino';
import { JUKEBOX_TUNES, RADIO_NOW_PLAYING, RADIO_STATIONS, STREAM, checkStreamUrl, stationById, trackTitle, tuneById } from '../../shared/jukebox';
import { noticeText, t } from '../i18n';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, toast } from './dom';

/** What each I Love Radio channel plays now (“ARTIST – TITLE”), by channel number; kept between visits to the jukebox. */
const nowPlaying = new Map<number, string>();
let nowPlayingAt = 0;

/** Asks ilovemusic.de what's on each channel, at most every 20 s; `then` runs when it knows more. Fine if it can't. */
async function fetchNowPlaying(then: () => void) {
  if (Date.now() - nowPlayingAt < 20_000) return;
  nowPlayingAt = Date.now();
  try {
    const res = await fetch(RADIO_NOW_PLAYING, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    const all = (await res.json()) as Record<string, { channel_id?: unknown; artist?: unknown; title?: unknown }>;
    for (const c of Object.values(all)) {
      const artist = typeof c.artist === 'string' ? c.artist.trim() : '';
      const title = typeof c.title === 'string' ? c.title.trim() : '';
      if (artist || title) nowPlaying.set(Number(c.channel_id), [artist, title].filter(Boolean).join(' – '));
    }
    then();
  } catch {
    // No song titles, then: the stations still play.
  }
}

/** The jukebox: what's on, the I Love Radio channels and the tunes to pick from, skip and stop, and a box for a stream. */
export function openJukebox(net: Net, openVolume: () => void) {
  const close = h('button.btn.close', { 'aria-label': t('windows.common.close') }, '✕');
  const now = h('div.jb-now');
  const list = h('ul.svc-list');
  const stations = h('ul.svc-list.jb-stations');
  // I Love Radio first, unless a tune is on.
  let tab: 'radio' | 'tunes' = tuneById(store.jukebox.track) ? 'tunes' : 'radio';
  const radioTab = h('button.btn.jb-tab', { type: 'button', role: 'tab' }, t('windows.jukebox.tabRadio'));
  const tunesTab = h('button.btn.jb-tab', { type: 'button', role: 'tab' }, t('windows.jukebox.tabTunes'));
  const radioPane = h('div', { role: 'tabpanel' }, h('p.setting-note', {}, t('windows.jukebox.radioNote')), stations);
  const tunesPane = h('div', { role: 'tabpanel' }, list);
  const url = h('input', { type: 'text', placeholder: t('windows.jukebox.urlPlaceholder'), 'aria-label': t('windows.jukebox.urlLabel'), spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const playUrl = h('button.btn.primary', { type: 'button' }, t('windows.jukebox.playStream'));
  const volume = h('button.btn', { type: 'button' }, t('windows.jukebox.volume'));
  // Down in the casino, it's the casino's jukebox, for everyone down there.
  const casino = store.floor === CASINO;
  const el = h(
    'div.modal.jukebox',
    { role: 'dialog', 'aria-label': t('windows.jukebox.title') },
    h('header', {}, h('h2', {}, t('windows.jukebox.heading')), close),
    h(
      'div.body',
      {},
      now,
      h('div.jb-tabs', { role: 'tablist', 'aria-label': t('windows.jukebox.pickTune') }, radioTab, tunesTab),
      radioPane,
      tunesPane,
      h('label', { style: 'margin-top:16px' }, t('windows.jukebox.orStream')),
      h('div.webhook', {}, url, playUrl),
      h('p.setting-note', {}, t(casino ? 'windows.jukebox.casinoStreamNote' : 'windows.jukebox.streamNote')),
    ),
    h('footer', {}, h('span.grow', {}, t(casino ? 'windows.jukebox.casinoFooter' : 'windows.jukebox.footer')), volume),
  );

  const button = (label: string, title: string, send: () => void, primary = false) => h(primary ? 'button.btn.primary' : 'button.btn', { type: 'button', title, onclick: send }, label);

  /** A station's little logo: a heart in its colour. */
  const logo = (color: string) => h('span.jb-logo', { style: `background:${color}`, 'aria-hidden': 'true' }, '♥');

  /** A card to click (or Enter) that puts `id` on, unless it's on already. */
  const card = (id: string, title: string, playing: boolean, icon: Node | string, main: Node) => {
    const li = h('li', { class: playing ? 'on' : '', tabindex: 0, role: 'button', 'aria-pressed': String(playing), title: playing ? t('windows.jukebox.playingNow') : t('windows.jukebox.putOn', { title }) }, icon, main);
    const pick = () => {
      if (!playing) net.send({ t: 'jukebox.play', track: id });
    };
    li.addEventListener('click', pick);
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pick();
      }
    });
    return li;
  };

  const render = () => {
    const j = store.jukebox;
    const stream = j.track === STREAM;
    const station = stationById(j.track);
    radioTab.setAttribute('aria-selected', String(tab === 'radio'));
    tunesTab.setAttribute('aria-selected', String(tab === 'tunes'));
    radioTab.classList.toggle('primary', tab === 'radio');
    tunesTab.classList.toggle('primary', tab === 'tunes');
    radioPane.hidden = tab !== 'radio';
    tunesPane.hidden = tab !== 'tunes';
    now.replaceChildren(
      station ? h('span.jb-disc', {}, logo(station.color)) : h('span.jb-disc', { class: j.on ? 'spin' : '' }, stream ? '📻' : '💿'),
      h(
        'div.svc-main',
        {},
        h('div.svc-title', {}, j.on ? trackTitle(j) : t('windows.jukebox.off')),
        h(
          'div.svc-meta',
          {},
          j.on
            ? [stream ? t('windows.jukebox.aStream') : station ? (nowPlaying.get(station.channel) ?? station.genre) : tuneById(j.track)?.mood, j.by && t('windows.jukebox.putOnBy', { name: j.by })].filter(Boolean).join(' · ')
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
    stations.replaceChildren(
      ...RADIO_STATIONS.map((r) => {
        const playing = j.on && j.track === r.id;
        const song = nowPlaying.get(r.channel);
        return card(
          r.id,
          r.name,
          playing,
          logo(r.color),
          h('div.svc-main', {}, h('div.svc-title', {}, playing ? `🔊 ${r.name}` : r.name), h('div.svc-meta', { title: r.genre }, song ? `♪ ${song}` : r.genre)),
        );
      }),
    );
    list.replaceChildren(
      ...JUKEBOX_TUNES.map((tune) => {
        const playing = j.on && j.track === tune.id;
        return card(tune.id, tune.title, playing, h('span.jb-icon', {}, playing ? '🔊' : '🎵'), h('div.svc-main', {}, h('div.svc-title', {}, tune.title), h('div.svc-meta', {}, tune.mood)));
      }),
    );
  };
  const show = (to: typeof tab) => {
    tab = to;
    render();
  };
  radioTab.addEventListener('click', () => show('radio'));
  tunesTab.addEventListener('click', () => show('tunes'));

  const play = () => {
    const u = checkStreamUrl(url.value);
    if ('error' in u) {
      toast(noticeText(u.error), 'warn');
      return url.focus();
    }
    net.send({ t: 'jukebox.play', url: u.url });
    url.value = '';
  };
  playUrl.addEventListener('click', play);
  url.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') play();
  });

  // What the channels play now, while the jukebox is open.
  const songs = window.setInterval(() => void fetchNowPlaying(render), 30_000);
  void fetchNowPlaying(render);
  const off = store.on('jukebox', render);
  const modal = openModal(el, {
    doing: '🎵 at the jukebox',
    onClose: () => {
      off();
      clearInterval(songs);
    },
  });
  close.addEventListener('click', () => modal.close());
  volume.addEventListener('click', () => {
    modal.close();
    openVolume();
  });
  render();
}
