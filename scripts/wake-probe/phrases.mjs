// The phrases the wake probe can train and measure, one table, each by its slug (story mw-deiheir.1): the spellings
// it is said with, its near words (the negatives made from them), where its model and its test fixture are committed,
// where its scratch files go and where its measuring numbers go. probe.mjs, train.py (through probe.mjs), make-tries.mjs
// and measure.mjs all read it, so a new phrase is one entry here. Plain data and path joins: no tools, no scratch folder.
//
// Hey Lampas keeps everything it had before the table, in the same places, so nothing already made is made again.
// What does not depend on the phrase (the LibriSpeech stream and its features, the hands-free stream, the speech pool
// behind the positives, the VCTK speaker sets, the road noise) is made once and shared by every phrase: scratchPaths().
import { join } from 'node:path';

export const DEFAULT_PHRASE = 'hey-lampas';

// Words and commands that sound like no phrase here, and what a driver says to the app: negatives for every phrase.
const EVERYDAY = [
  'Hey', 'Hey buddy', 'Hey Thomas', 'Play', 'Pause', 'Stop', 'Next chapter', 'Previous chapter', 'Back a verse',
  'Open John three', 'Hey Alexa', 'Hey Google', 'Hey Siri', 'Hey there', 'Hey you', 'Hello',
];

export const PHRASES = {
  'hey-lampas': {
    slug: 'hey-lampas',
    name: 'Hey Lampas',
    spellings: ['Hey Lampas', 'Hey, Lampas', 'Hey Lampas.', 'Hey Lampas!', 'hey lampas'],
    // Near words and everyday sentences' words: negatives. "Please read me the first chapter" (the test clip) is not
    // here, and nothing that sounds the same as the phrase ("Hey lamp us") is.
    near: [
      'Hey', 'Hey Lamp', 'Hey lamb', 'Hey campus', 'Hey Postern', 'Hey buddy', 'Hey Lucas', 'Hey Thomas', 'Hey lampshade',
      'Hey glasses', 'Lampas', 'Hey Las Vegas', 'Hey Lambert', 'Hey Atlas', 'Hey alarm', 'Okay, Lampas', 'Hello',
      'Play', 'Pause', 'Stop', 'Next chapter', 'Previous chapter', 'Back a verse', 'Open John three', 'Hey Linda',
      'Hey llama', 'Hey Lana', 'Hey Pampas', 'Hey Tampa', 'Hey canvas', 'Hey lemon', 'Hey, let us pass', 'Hey Alexa',
      'Hey Google', 'Hey Siri', 'Hey Lambo', 'Hey Lamar', 'Hey lamplight', 'Hey compass', 'Hey Douglas', 'Hey palace',
      'Hey Nicholas', 'Hey Marcus', 'A lamp post', 'The lamp is on', 'Hey, pass the lamp', 'Hey there', 'Hey you',
    ],
    model: 'examples/wake-spike/public/models/hey-lampas.json',
    fixture: 'scripts/wake-probe/fixtures/hey-lampas.wav',
    results: 'examples/wake-spike/results.json',
  },
  'hey-postern': {
    slug: 'hey-postern',
    name: 'Hey Postern',
    spellings: ['Hey Postern', 'Hey, Postern', 'Hey Postern.', 'Hey Postern!', 'hey postern'],
    near: [
      'Postern', 'pastor', 'Hey pastor', 'poster', 'Hey poster', 'posture', 'postman', 'post', 'Boston', 'Hey Boston',
      'Preston', 'possum', 'Hey Austin', 'Hey Lampas', 'Hello', 'Okay, Postern',
      'Hey Pasternak', 'Hey postman', 'Hey Preston', 'Hey possum', 'Hey, post it', 'Hey, stern', 'Hey Easton', 'Hey Poston',
      'A post on the door', 'The poster is on the wall', 'Hey, pass the post',
      ...EVERYDAY.filter((w) => w !== 'Hello'),
    ],
    model: 'examples/wake-spike/public/models/hey-postern.json',
    fixture: 'scripts/wake-probe/fixtures/hey-postern.wav',
    results: 'examples/wake-spike/results-hey-postern.json',
  },
};

/** The slugs, in the table's order. */
export const slugs = () => Object.keys(PHRASES);

/** The message of an unknown slug: names it and lists the slugs. */
export const unknownMessage = (slug) => `unknown phrase ${JSON.stringify(slug)}: the phrases are ${slugs().join(', ')}`;

/** A phrase's row by its slug (Hey Lampas when none is given); throws an error with `.usage` set for an unknown slug. */
export function phraseOf(slug = DEFAULT_PHRASE) {
  if (typeof slug !== 'string' || !Object.hasOwn(PHRASES, slug)) {
    const error = new Error(unknownMessage(slug));
    error.usage = true;
    throw error;
  }
  return PHRASES[slug];
}

/** The slug after --phrase (or --phrase=slug) in an argument list, or Hey Lampas's when there is none. */
export function phraseSlugFrom(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--phrase') return argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[i + 1];
    if (argv[i].startsWith('--phrase=')) return argv[i].slice('--phrase='.length);
  }
  return DEFAULT_PHRASE;
}

/**
 * Where the probe keeps its files for `slug` under the scratch root `root`. The phrase-free ones are in `shared` and
 * are the same for every phrase; the rest are in the phrase's own folder, which for Hey Lampas is `shared` itself (so
 * what was made before the table is where it was) and for another phrase is `shared/phrases/<slug>`.
 */
export function scratchPaths(slug, root) {
  phraseOf(slug);
  const shared = join(root, 'route-d');
  const own = slug === DEFAULT_PHRASE ? shared : join(shared, 'phrases', slug);
  return {
    shared,
    own,
    // phrase-free
    sets: join(shared, 'sets.json'),
    speechPool: join(shared, 'sayings', 'speech-pool'),
    streamFeatures: join(shared, 'feat', 'stream.f32'),
    streamInfo: join(shared, 'feat', 'stream.json'),
    hfStreamFeatures: join(shared, 'feat', 'hf-stream.f32'),
    hfStreamInfo: join(shared, 'feat', 'hf-stream.json'),
    // the phrase's
    sayings: join(own, 'sayings'),
    vits: join(own, 'vits'),
    feat: join(own, 'feat'),
    modelTrained: join(own, 'model-trained.json'),
  };
}

/** The folder of a phrase's tries (make-tries.mjs): Hey Lampas's is `tries` where it was, another's is `tries-<slug>`. */
export const triesFolder = (slug) => (phraseOf(slug).slug === DEFAULT_PHRASE ? 'tries' : `tries-${slug}`);
