import type { Net } from '../net';
import { store, type Settings, type ViewMode } from '../state';
import { askNotifyPermission, notifyPermission, type DesktopNotifier } from '../notify';
import type { ThemePick, WebhookKind } from '../../shared/protocol';
import { THEME_PICKS } from '../../shared/theme';
import { DOG_NAME_MAX, cleanDogName } from '../../shared/dog';
import { h, openModal, timeAgo } from './dom';
import { agentFields, choiceLabel, officeChoice } from './provider';
import { openPromptEditor, rewrittenPrompts } from './prompts';
import { LANGS, lang, setLang, t } from '../i18n';

const VIEWS: [ViewMode, string, string][] = [
  ['first', t('windows.settings.viewFirst'), t('windows.settings.viewFirstNote')],
  ['third', t('windows.settings.viewThird'), t('windows.settings.viewThirdNote')],
];

const THEME_LABEL: Record<ThemePick, string> = {
  auto: t('windows.settings.themeAuto'),
  halloween: t('windows.settings.themeHalloween'),
  christmas: t('windows.settings.themeChristmas'),
  off: t('windows.settings.themeOff'),
};

const WEBHOOK_NAME: Record<WebhookKind, string> = { slack: 'Slack', discord: 'Discord', other: t('windows.settings.webhookOther') };

/** "It’s the same for everyone in the building", and who set it, when someone did. */
const sameForAll = (by?: string, at?: string | number) => (by ? t('windows.settings.sameForAllBy', { by, when: at ? ` ${timeAgo(at)}` : '' }) : t('windows.settings.sameForAll'));

/** `outside` describes the sky over the office (see describeSky), once the server has said. */
export function openSettings(net: Net, settings: Settings, onChange: (s: Settings) => void, onCharacter: () => void, previewSound: () => void, notifier: DesktopNotifier, onSignOut: () => void, outside?: { now: string; live: boolean }) {
  const seg = h('div.seg', { role: 'radiogroup', 'aria-label': t('windows.settings.cameraView') });
  const note = h('p.setting-note');
  const paint = () => {
    seg.replaceChildren(
      ...VIEWS.map(([view, label]) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(settings.view === view),
            class: settings.view === view ? 'on' : '',
            onclick: () => {
              if (settings.view === view) return;
              settings = { ...settings, view };
              onChange(settings);
              paint();
            },
          },
          label,
        ),
      ),
    );
    note.textContent = VIEWS.find(([v]) => v === settings.view)![2];
  };
  paint();

  /** A volume slider with its mute button. Dragging it turns the sound back on; letting go plays `preview`. */
  const volumeRow = (label: string, level: 'volume' | 'music', muted: 'muted' | 'musicMuted', preview?: () => void) => {
    const slider = h('input', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': label });
    const pct = h('span.vol-pct');
    const mute = h('button.btn', { type: 'button' });
    const row = h('div.volume', {}, mute, slider, pct);
    const paint = () => {
      const v = Math.round(settings[level] * 100);
      slider.value = String(v);
      slider.style.setProperty('--fill', `${v}%`);
      pct.textContent = settings[muted] ? t('windows.settings.muted') : `${v}%`;
      mute.textContent = settings[muted] ? t('windows.settings.unmute') : t('windows.settings.mute');
      mute.setAttribute('aria-pressed', String(settings[muted]));
      mute.classList.toggle('danger', settings[muted]);
      row.classList.toggle('muted', settings[muted]);
    };
    paint();
    slider.addEventListener('input', () => {
      settings = { ...settings, [level]: Number(slider.value) / 100, [muted]: false };
      onChange(settings);
      paint();
    });
    if (preview) slider.addEventListener('change', preview);
    mute.addEventListener('click', () => {
      settings = { ...settings, [muted]: !settings[muted] };
      onChange(settings);
      paint();
      if (!settings[muted]) preview?.();
    });
    return row;
  };
  const soundRow = volumeRow(t('windows.settings.officeSoundsVolume'), 'volume', 'muted', previewSound);

  // Your language, for you alone: the page reloads in it, since everything on screen is built with its text.
  const langRow = h(
    'div.seg',
    { role: 'radiogroup', 'aria-label': t('core.language') },
    ...LANGS.map(({ id, name }) =>
      h(
        'button.btn',
        {
          type: 'button',
          role: 'radio',
          lang: id,
          'aria-checked': String(lang() === id),
          class: lang() === id ? 'on' : '',
          onclick: () => {
            if (lang() === id) return;
            setLang(id);
            location.reload();
          },
        },
        name,
      ),
    ),
  );

  // Voice chat: an open mic, or muted until you hold V.
  const talkRow = h('div.seg', { role: 'radiogroup', 'aria-label': t('windows.settings.voiceChat') });
  const paintTalk = () => {
    talkRow.replaceChildren(
      ...(
        [
          [false, t('windows.settings.openMic')],
          [true, t('windows.settings.pushToTalk')],
        ] as const
      ).map(([ptt, label]) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(settings.pushToTalk === ptt),
            class: settings.pushToTalk === ptt ? 'on' : '',
            onclick: () => {
              if (settings.pushToTalk === ptt) return;
              settings = { ...settings, pushToTalk: ptt };
              onChange(settings);
              paintTalk();
            },
          },
          label,
        ),
      ),
    );
  };
  paintTalk();
  const musicRow = volumeRow(t('windows.settings.jukeboxVolume'), 'music', 'musicMuted');

  // The building's holiday theme, for everyone.
  const themeRow = h('div.seg', { role: 'radiogroup', 'aria-label': t('windows.settings.holidayTheme') });
  const themeNote = h('p.setting-note');
  const paintTheme = () => {
    const { pick, active, by, at } = store.theme;
    themeRow.replaceChildren(
      ...THEME_PICKS.map((p) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(pick === p),
            class: pick === p ? 'on' : '',
            onclick: () => {
              if (store.theme.pick !== p) net.send({ t: 'theme.set', pick: p });
            },
          },
          THEME_LABEL[p],
        ),
      ),
    );
    const now =
      active === 'halloween'
        ? t('windows.settings.themeHalloweenNow')
        : active === 'christmas'
          ? t('windows.settings.themeChristmasNow')
          : t('windows.settings.themeNoneNow');
    const how = pick === 'auto' ? ` ${t('windows.settings.themeByCalendar')}` : '';
    themeNote.textContent = `${now}${how} ${sameForAll(by, at)}`;
  };
  paintTheme();

  // Desktop notifications: this browser's permission, then your own on/off.
  const notifyRow = h('div.seg');
  const notifyNote = h('p.setting-note');
  const paintNotify = () => {
    const perm = notifyPermission();
    const on = perm === 'granted' && settings.notify;
    notifyRow.replaceChildren();
    if (perm === 'default') {
      notifyRow.append(
        h(
          'button.btn.primary',
          {
            type: 'button',
            onclick: async () => {
              if ((await askNotifyPermission()) === 'granted') {
                settings = { ...settings, notify: true };
                onChange(settings);
                notifier.sample();
              }
              paintNotify();
            },
          },
          t('windows.settings.notifyTurnOn'),
        ),
      );
    } else if (perm === 'granted') {
      for (const [value, label] of [
        [true, t('windows.settings.notifyOn')],
        [false, t('windows.settings.notifyOff')],
      ] as const) {
        notifyRow.append(
          h(
            'button.btn',
            {
              type: 'button',
              role: 'radio',
              'aria-checked': String(on === value),
              class: on === value ? 'on' : '',
              onclick: () => {
                settings = { ...settings, notify: value };
                onChange(settings);
                paintNotify();
              },
            },
            label,
          ),
        );
      }
      if (on) notifyRow.append(h('button.btn', { type: 'button', onclick: () => notifier.sample() }, t('windows.settings.notifySample')));
    }
    notifyNote.textContent =
      perm === 'unsupported'
        ? t('windows.settings.notifyUnsupported')
        : perm === 'denied'
          ? t('windows.settings.notifyDenied')
          : t('windows.settings.notifyNote');
  };
  paintNotify();

  // The office's Slack / Discord webhook, shared by everyone.
  const hookStatus = h('p.setting-note');
  const hookInput = h('input', { type: 'text', placeholder: 'https://hooks.slack.com/services/…', 'aria-label': t('windows.settings.webhookUrl'), spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const hookSave = h('button.btn.primary', { type: 'button' }, t('windows.settings.save'));
  const hookTest = h('button.btn', { type: 'button' }, t('windows.settings.sendTest'));
  const hookRemove = h('button.btn.danger', { type: 'button' }, t('windows.settings.remove'));
  const hookActions = h('div.seg', { style: 'margin-top:8px' }, hookTest, hookRemove);
  const paintHook = () => {
    const { webhook, error, lastSentAt } = store.notify;
    hookActions.classList.toggle('hidden', !webhook);
    hookSave.textContent = webhook ? t('windows.settings.replace') : t('windows.settings.save');
    hookStatus.classList.toggle('bad', !!error);
    hookStatus.textContent = !webhook
      ? t('windows.settings.webhookNone')
      : error
        ? t('windows.settings.webhookFailed', { where: WEBHOOK_NAME[webhook.kind], hint: webhook.hint, error })
        : t('windows.settings.webhookPosting', {
            where: WEBHOOK_NAME[webhook.kind],
            hint: webhook.hint,
            by: webhook.by,
            when: timeAgo(webhook.at),
            last: lastSentAt ? t('windows.settings.webhookLast', { when: timeAgo(lastSentAt) }) : '',
          });
  };
  paintHook();
  const saveHook = () => {
    const url = hookInput.value.trim();
    if (!url) return hookInput.focus();
    net.send({ t: 'notify.webhook', url });
    hookInput.value = '';
  };
  hookSave.addEventListener('click', saveHook);
  hookInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveHook();
  });
  hookTest.addEventListener('click', () => net.send({ t: 'notify.test' }));
  hookRemove.addEventListener('click', () => net.send({ t: 'notify.webhook', url: '' }));

  // The worker everyone starts on, unless whoever starts one picks another. Admins pick it.
  const agent = agentFields(store.project, 'office-agent', officeChoice(store.project));
  let agentTouched = false;
  agent.element.addEventListener('change', () => (agentTouched = true));
  agent.element.addEventListener('input', () => (agentTouched = true));
  const agentSave = h('button.btn.primary', { type: 'button' }, t('windows.settings.save'));
  const agentBack = h('button.btn', { type: 'button' });
  const agentActions = h('div.seg', { style: 'margin-top:8px' }, agentSave, agentBack);
  const agentNow = h('p.outside-now');
  const agentNote = h('p.setting-note');
  const paintAgent = () => {
    const admin = store.me.admin;
    const picked = store.prompts.agent;
    const now = officeChoice(store.project);
    agent.element.classList.toggle('hidden', !admin);
    agentActions.classList.toggle('hidden', !admin);
    agentNow.classList.toggle('hidden', admin);
    agentNow.textContent = choiceLabel(now);
    agentBack.classList.toggle('hidden', !picked);
    const started = store.project?.agentCmd.split(' ')[0].split(/[\\/]/).pop();
    agentBack.textContent = started === undefined ? t('windows.settings.agentBackDefault') : t('windows.settings.agentBack', { agent: started });
    if (!agentTouched) agent.set(now);
    agentNote.textContent =
      t('windows.settings.agentNote') +
      ` ${picked ? t('windows.settings.setBy', { by: picked.by, when: timeAgo(picked.at) }) : t('windows.settings.agentDefault')}` +
      (admin ? '' : ` ${t('windows.settings.adminsCanChange')}`);
  };
  paintAgent();
  agentSave.addEventListener('click', () => {
    if (!agent.valid()) return;
    agentTouched = false;
    net.send({ t: 'prompts.agent', choice: agent.choice() });
  });
  agentBack.addEventListener('click', () => {
    agentTouched = false;
    net.send({ t: 'prompts.agent', choice: null });
  });

  // The prompts the office writes for workers by itself, for the whole office. Admins rewrite them.
  const promptsOpen = h('button.btn', { type: 'button', onclick: () => openPromptEditor(net) });
  const promptsNote = h('p.setting-note');
  const paintPrompts = () => {
    const n = rewrittenPrompts();
    promptsOpen.textContent = store.me.admin ? t('windows.settings.promptsEdit') : t('windows.settings.promptsRead');
    promptsNote.textContent =
      `${t('windows.settings.promptsNote')} ` +
      (n ? t('windows.settings.promptsRewritten', { n }) : t('windows.settings.promptsOriginal')) +
      (store.me.admin ? '' : ` ${t('windows.settings.adminsCanRewrite')}`);
  };
  paintPrompts();

  // The most workers the office runs at once, across every floor. Admins set it.
  const limitInput = h('input', { type: 'text', inputmode: 'numeric', 'aria-label': t('windows.settings.limitInput'), spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const limitSave = h('button.btn.primary', { type: 'button' }, t('windows.settings.limitSet'));
  const limitClear = h('button.btn', { type: 'button' });
  const limitRow = h('div.webhook', {}, limitInput, limitSave, limitClear);
  const limitNote = h('p.setting-note');
  const paintLimit = () => {
    const m = store.machine;
    const admin = store.me.admin;
    limitRow.classList.toggle('hidden', !admin);
    limitInput.placeholder = m.ceiling ? t('windows.settings.limitRange', { n: m.ceiling }) : t('windows.settings.limitExample');
    limitClear.textContent = m.ceiling ? t('windows.settings.limitBack', { n: m.ceiling }) : t('windows.settings.limitNone');
    limitClear.classList.toggle('hidden', !m.set);
    const now =
      m.limit === undefined
        ? t('windows.settings.limitNoneNote', { n: m.workers })
        : t('windows.settings.limitAtNote', { limit: m.limit, n: m.workers });
    const from = m.set ? ` ${t('windows.settings.setBy', { by: m.set.by, when: timeAgo(m.set.at) })}` : '';
    const cap = m.ceiling ? ` ${t('windows.settings.limitCeiling', { n: m.ceiling })}` : '';
    limitNote.textContent = now + from + cap + (admin ? '' : ` ${t('windows.settings.adminsCanChange')}`);
  };
  paintLimit();
  const saveLimit = () => {
    const n = Number(limitInput.value.trim());
    if (!limitInput.value.trim() || !Number.isInteger(n) || n < 1) return limitInput.focus();
    net.send({ t: 'machine.limit', limit: n });
    limitInput.value = '';
  };
  limitSave.addEventListener('click', saveLimit);
  limitInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveLimit();
  });
  limitClear.addEventListener('click', () => net.send({ t: 'machine.limit', limit: null }));

  // Whether a worker whose pull request merged goes home by itself, for everyone.
  const leaveRow = h('div.seg', { role: 'radiogroup', 'aria-label': t('windows.settings.leaveGroup') });
  const leaveNote = h('p.setting-note');
  const paintLeave = () => {
    const { on, by, at } = store.leaveOnMerge;
    leaveRow.replaceChildren(
      ...([
        [true, t('windows.settings.leaveGo')],
        [false, t('windows.settings.leaveStay')],
      ] as const).map(([value, label]) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(on === value),
            class: on === value ? 'on' : '',
            onclick: () => {
              if (store.leaveOnMerge.on !== value) net.send({ t: 'leaveOnMerge.set', on: value });
            },
          },
          label,
        ),
      ),
    );
    const now = on
      ? t('windows.settings.leaveGoNote')
      : t('windows.settings.leaveStayNote');
    leaveNote.textContent = `${now} ${sameForAll(by, at)}`;
  };
  paintLeave();

  // Where the elevator clones new projects on the office's machine. Admins move it.
  const dirInput = h('input', { type: 'text', placeholder: '~/Workspace', 'aria-label': t('windows.settings.workspaceInput'), spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const dirSave = h('button.btn.primary', { type: 'button' }, t('windows.settings.save'));
  const dirDefault = h('button.btn', { type: 'button' }, t('windows.settings.useDefault'));
  const dirRow = h('div.webhook', {}, dirInput, dirSave);
  const dirActions = h('div.seg', { style: 'margin-top:8px' }, dirDefault);
  const dirNote = h('p.setting-note');
  const paintDir = () => {
    const { dir, custom, by, at } = store.projectsDir;
    const admin = store.me.admin;
    dirInput.value = dir;
    dirRow.classList.toggle('hidden', !admin);
    dirActions.classList.toggle('hidden', !admin || !custom);
    dirNote.textContent =
      t('windows.settings.workspaceNote', { path: `${dir}/<owner>/<repo>` }) +
      (custom && by && at ? ` ${t('windows.settings.setBy', { by, when: timeAgo(at) })}` : '') +
      ` ${admin ? t('windows.settings.workspaceAdminNote') : t('windows.settings.workspaceAnAdmin')}`;
  };
  paintDir();
  const saveDir = () => {
    const dir = dirInput.value.trim();
    if (!dir) return dirInput.focus();
    if (dir !== store.projectsDir.dir) net.send({ t: 'floor.projectsDir', dir });
  };
  dirSave.addEventListener('click', saveDir);
  dirInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveDir();
  });
  dirDefault.addEventListener('click', () => net.send({ t: 'floor.projectsDir', dir: '' }));

  // The dog on this floor, named for everyone here.
  const dogInput = h('input', { type: 'text', maxlength: DOG_NAME_MAX, 'aria-label': t('windows.settings.dogName'), spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const dogSave = h('button.btn.primary', { type: 'button' }, t('windows.settings.rename'));
  const dogNote = h('p.setting-note');
  const dogSection = h('div', {}, h('label', { style: 'margin-top:18px' }, t('windows.settings.officeDog')), h('div.webhook', {}, dogInput, dogSave), dogNote);
  const paintDog = () => {
    const dog = store.dog;
    dogSection.classList.toggle('hidden', !dog);
    if (!dog) return;
    dogInput.placeholder = dog.name;
    dogNote.textContent = t('windows.settings.dogNote', { name: dog.name });
  };
  paintDog();
  const renameDog = () => {
    const name = cleanDogName(dogInput.value);
    if (!name) return dogInput.focus();
    net.send({ t: 'dog.name', name });
    dogInput.value = '';
  };
  dogSave.addEventListener('click', renameDog);
  dogInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') renameDog();
  });

  const account = store.me.account;
  const signOut = h('button.btn', { type: 'button' }, t('windows.settings.signOut'));
  signOut.addEventListener('click', onSignOut);
  const character = h('button.btn', { type: 'button' }, account ? t('windows.settings.changeLook') : t('windows.settings.changeLookName'));
  const close = h('button.btn.close', { 'aria-label': t('windows.common.close') }, '✕');
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': t('windows.settings.dialog') },
    h('header', {}, h('h2', {}, t('windows.settings.title')), close),
    h(
      'div.body',
      {},
      h('label', {}, t('core.language')),
      langRow,
      h('p.setting-note', {}, t('core.languageNote')),
      h('label', { style: 'margin-top:18px' }, t('windows.settings.cameraView')),
      seg,
      note,
      h('label', { style: 'margin-top:18px' }, t('windows.settings.officeSounds')),
      soundRow,
      h('p.setting-note', {}, t('windows.settings.officeSoundsNote')),
      h('label', { style: 'margin-top:18px' }, t('windows.settings.voiceChat')),
      talkRow,
      h('p.setting-note', {}, t('windows.settings.voiceChatNote')),
      h('label', { style: 'margin-top:18px' }, t('windows.settings.jukebox')),
      musicRow,
      h('p.setting-note', {}, t('windows.settings.jukeboxNote')),
      ...(outside
        ? [
            h('label', { style: 'margin-top:18px' }, t('windows.settings.outside')),
            h('p.outside-now', {}, outside.now),
            h('p.setting-note', {}, outside.live ? t('windows.settings.skyLive') : t('windows.settings.skyMade')),
          ]
        : []),
      h('label', { style: 'margin-top:18px' }, t('windows.settings.holidayTheme')),
      themeRow,
      themeNote,
      h('label', { style: 'margin-top:18px' }, t('windows.settings.desktopNotifications')),
      notifyRow,
      notifyNote,
      h('label', { style: 'margin-top:18px' }, t('windows.settings.teamNotifications')),
      h('div.webhook', {}, hookInput, hookSave),
      hookActions,
      hookStatus,
      h('label', { style: 'margin-top:18px' }, t('windows.settings.defaultWorker')),
      agentNow,
      agent.element,
      agentActions,
      agentNote,
      h('label', { style: 'margin-top:18px' }, t('windows.settings.prompts')),
      promptsOpen,
      promptsNote,
      h('label', { style: 'margin-top:18px' }, t('windows.settings.workerLimit')),
      limitRow,
      limitNote,
      h('label', { style: 'margin-top:18px' }, t('windows.settings.leave')),
      leaveRow,
      leaveNote,
      h('label', { style: 'margin-top:18px' }, t('windows.settings.workspace')),
      dirRow,
      dirActions,
      dirNote,
      dogSection,
      h('label', { style: 'margin-top:18px' }, t('windows.settings.yourCharacter')),
      character,
      h('label', { style: 'margin-top:18px' }, t('windows.settings.signedIn')),
      h('div.volume', {}, signOut),
      h('p.setting-note', {}, account ? t('windows.settings.signedInAs', { name: account.name, role: account.role }) : t('windows.settings.sharedPassword')),
    ),
  );
  const offNotify = store.on('notify', paintHook);
  const offDog = store.on('dog', paintDog);
  const offTheme = store.on('theme', paintTheme);
  const offLeave = store.on('leaveOnMerge', paintLeave);
  const offLimit = [store.on('machine', paintLimit), store.on('me', paintLimit)];
  const offDir = [store.on('projectsDir', paintDir), store.on('me', paintDir)];
  const offPrompts = [store.on('prompts', paintAgent), store.on('prompts', paintPrompts), store.on('me', paintAgent), store.on('me', paintPrompts)];
  const modal = openModal(el, {
    doing: '⚙️ in settings',
    onClose: () => {
      offNotify();
      offDog();
      offTheme();
      offLeave();
      offLimit.forEach((off) => off());
      offDir.forEach((off) => off());
      offPrompts.forEach((off) => off());
    },
  });
  close.addEventListener('click', () => modal.close());
  character.addEventListener('click', () => {
    modal.close();
    onCharacter();
  });
}
