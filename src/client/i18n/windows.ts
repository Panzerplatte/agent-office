import type { Table } from './table';
import common from './windows/common';
import settings from './windows/settings';
import limits from './windows/limits';
import upgrade from './windows/upgrade';
import usage from './windows/usage';
import accounts from './windows/accounts';
import character from './windows/character';
import prompts from './windows/prompts';
import provider from './windows/provider';
import team from './windows/team';
import terminal from './windows/terminal';
import services from './windows/services';
import meeting from './windows/meeting';
import prompt from './windows/prompt';
import bookshelf from './windows/bookshelf';
import jukebox from './windows/jukebox';
import search from './windows/search';
import elevator from './windows/elevator';
import decor from './windows/decor';
import cabinet from './windows/cabinet';
import arcade from './windows/arcade';
import minesweeper from './windows/minesweeper';
import blocks from './windows/blocks';
import whiteboard from './windows/whiteboard';

/**
 * The windows that open over the office: settings, terminals, the elevator, the bookshelf and the rest.
 * Each window keeps its texts in its own file under windows/, keyed `<window>.<what>` (so
 * `t('windows.settings.title')`), and each of those checks that its German has every key its English has.
 */
export default {
  en: {
    ...common.en,
    ...settings.en,
    ...limits.en,
    ...upgrade.en,
    ...usage.en,
    ...accounts.en,
    ...character.en,
    ...prompts.en,
    ...provider.en,
    ...team.en,
    ...terminal.en,
    ...services.en,
    ...meeting.en,
    ...prompt.en,
    ...bookshelf.en,
    ...jukebox.en,
    ...search.en,
    ...elevator.en,
    ...decor.en,
    ...cabinet.en,
    ...arcade.en,
    ...minesweeper.en,
    ...blocks.en,
    ...whiteboard.en,
  },
  de: {
    ...common.de,
    ...settings.de,
    ...limits.de,
    ...upgrade.de,
    ...usage.de,
    ...accounts.de,
    ...character.de,
    ...prompts.de,
    ...provider.de,
    ...team.de,
    ...terminal.de,
    ...services.de,
    ...meeting.de,
    ...prompt.de,
    ...bookshelf.de,
    ...jukebox.de,
    ...search.de,
    ...elevator.de,
    ...decor.de,
    ...cabinet.de,
    ...arcade.de,
    ...minesweeper.de,
    ...blocks.de,
    ...whiteboard.de,
  } as Table,
};
