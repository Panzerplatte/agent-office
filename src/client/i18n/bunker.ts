import common from './bunker/common';
import grow from './bunker/grow';
import lab from './bunker/lab';
import pack from './bunker/pack';
import pc from './bunker/pc';
import customers from './bunker/customers';
import cartel from './bunker/cartel';

/**
 * The bunker under the casino (see shared/bunker/index.ts): its own texts in bunker/common.ts, and
 * each feature's in its own file there, keyed `<feature>.<what>` (so `t('bunker.grow.title')`). Each
 * checks that its German has every key its English has.
 */
export default {
  en: { ...common.en, ...grow.en, ...lab.en, ...pack.en, ...pc.en, ...customers.en, ...cartel.en },
  de: { ...common.de, ...grow.de, ...lab.de, ...pack.de, ...pc.de, ...customers.de, ...cartel.de },
};
