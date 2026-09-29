import { HAIR_COLOR_NAMES, HAIR_STYLES } from '../../../shared/avatar';
import { strings } from '../table';

const DE_HAIR_STYLES = ['Kurz', 'Lang', 'Dutt', 'Stachelig', 'Lockig', 'Pferdeschwanz', 'Glatze'];
const DE_HAIR_COLORS = ['Schwarz', 'Dunkelbraun', 'Braun', 'Blond', 'Rotblond', 'Silber', 'Rot', 'Pink', 'Lila', 'Türkis'];

/** ui/character.ts */
export default strings(
  {
    'character.preview': 'Your character, drag to spin',
    'character.namePlaceholder': 'e.g. Ada',
    'character.name': 'Your name',
    'character.accountName': 'Your account name',
    'character.signedInAs': '🔑 Signed in as {name}, so that’s your name here.',
    'character.skin': 'Skin tone',
    'character.skinN': 'Skin tone {n} of {of}',
    'character.hair': 'Hair',
    'character.hairStyle': 'Hair style',
    'character.hairStyleName': (v) => HAIR_STYLES[Number(v.i)] ?? '',
    'character.hairColor': 'Hair color',
    'character.hairColorName': (v) => HAIR_COLOR_NAMES[Number(v.i)] ?? '',
    'character.shirt': 'Shirt',
    'character.shirtColor': 'Shirt color',
    'character.shirtN': 'Shirt {color}',
    'character.randomTitle': 'Random look',
    'character.random': '🎲 Surprise me',
    'character.enter': 'Enter the office 🚪',
    'character.save': 'Save',
    'character.pickTitle': 'Pick your character',
    'character.pickHeading': '👋 Pick your character',
    'character.heading': '🧍 Your character',
    'character.dragTip': 'Drag to spin',
  },
  {
    'character.preview': 'Deine Figur, zum Drehen ziehen',
    'character.namePlaceholder': 'z. B. Ada',
    'character.name': 'Dein Name',
    'character.accountName': 'Der Name deines Accounts',
    'character.signedInAs': '🔑 Angemeldet als {name}, also heißt du hier so.',
    'character.skin': 'Hautton',
    'character.skinN': 'Hautton {n} von {of}',
    'character.hair': 'Frisur',
    'character.hairStyle': 'Frisur',
    'character.hairStyleName': (v) => DE_HAIR_STYLES[Number(v.i)] ?? HAIR_STYLES[Number(v.i)] ?? '',
    'character.hairColor': 'Haarfarbe',
    'character.hairColorName': (v) => DE_HAIR_COLORS[Number(v.i)] ?? HAIR_COLOR_NAMES[Number(v.i)] ?? '',
    'character.shirt': 'Shirt',
    'character.shirtColor': 'Shirtfarbe',
    'character.shirtN': 'Shirt {color}',
    'character.randomTitle': 'Zufälliger Look',
    'character.random': '🎲 Überrasch mich',
    'character.enter': 'Ab ins Büro 🚪',
    'character.save': 'Speichern',
    'character.pickTitle': 'Wähl deine Figur',
    'character.pickHeading': '👋 Wähl deine Figur',
    'character.heading': '🧍 Deine Figur',
    'character.dragTip': 'Zum Drehen ziehen',
  },
);
