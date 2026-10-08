import { strings } from '../table';

/**
 * The bunker's own texts (the room, the ladder, the stash shelf, its chips), keyed `common.<what>`
 * (so `t('bunker.common.name')`). Each feature keeps its texts in its own file next to this one.
 */
export default strings(
  {
    'common.name': 'Bunker',
    'common.meta': 'Under the casino · down the ladder in the secret room',
    'common.where': 'Somewhere under the casino',
    'common.help':
      "In the casino there's a secret room behind a stretch of the south wall that's really a door (walk into it and keep pushing). A ladder in its floor goes down to the bunker, a concrete room under the casino: E at the ladder climbs down, and E at the ladder in the bunker climbs back up. Down there are marked spots for the grow area, the lab bench, the packing table, the PC, the customers' door, the cartel's phone and the stash shelf: walk up to one and press E. Everything you buy down here is paid in casino chips and everything you sell pays them, the same chips as the casino's. The stash shelf shows what you have. It's a game: the products are made up.",
    'common.ladder': '🪜 Ladder',
    'common.ladderDown': 'Down to the bunker',
    'common.ladderUp': 'Up to the casino',
    'common.climbDown': 'Climb down',
    'common.climbUp': 'Climb up',
    'common.use': 'Use',
    'common.noPictures': "Bare concrete down here: take the ladder up and the elevator to a floor to hang pictures",
    'common.stash.title': '🗄️ Stash',
    'common.stash.mark': 'STASH',
    'common.stash.items': 'Supplies',
    'common.stash.products': 'Product',
    'common.stash.empty': 'The shelf is empty.',
    'common.stash.unit': '{grams} g · quality {quality} %',
    'common.whyBuy': 'Bunker: {item}',
    'common.whySale': 'Bunker: sale',
    'common.whyOther': 'Bunker',
  },
  {
    'common.name': 'Bunker',
    'common.meta': 'Unter dem Casino · die Leiter im Geheimraum runter',
    'common.where': 'Irgendwo unter dem Casino',
    'common.help':
      'Im Casino ist hinter einem Stück der Südwand ein Geheimraum: Die Wand ist eigentlich eine Tür (lauf hinein und drück weiter). Eine Leiter in seinem Boden führt runter in den Bunker, einen Betonraum unter dem Casino: E an der Leiter steigt hinunter, E an der Leiter im Bunker wieder hinauf. Unten sind Plätze markiert für die Anbaufläche, den Labortisch, den Packtisch, den PC, die Tür der Kundschaft, das Telefon des Kartells und das Vorratsregal: geh hin und drück E. Alles, was du hier unten kaufst, zahlst du mit Casino-Chips, und alles, was du verkaufst, bringt welche, dieselben Chips wie im Casino. Das Vorratsregal zeigt, was du hast. Es ist ein Spiel: Die Produkte sind erfunden.',
    'common.ladder': '🪜 Leiter',
    'common.ladderDown': 'Runter in den Bunker',
    'common.ladderUp': 'Hoch ins Casino',
    'common.climbDown': 'Hinuntersteigen',
    'common.climbUp': 'Hinaufsteigen',
    'common.use': 'Benutzen',
    'common.noPictures': 'Hier unten ist nur nackter Beton: Nimm die Leiter hoch und den Aufzug zu einer Etage, um Bilder aufzuhängen',
    'common.stash.title': '🗄️ Vorrat',
    'common.stash.mark': 'VORRAT',
    'common.stash.items': 'Material',
    'common.stash.products': 'Ware',
    'common.stash.empty': 'Das Regal ist leer.',
    'common.stash.unit': '{grams} g · Qualität {quality} %',
    'common.whyBuy': 'Bunker: {item}',
    'common.whySale': 'Bunker: Verkauf',
    'common.whyOther': 'Bunker',
  },
);
