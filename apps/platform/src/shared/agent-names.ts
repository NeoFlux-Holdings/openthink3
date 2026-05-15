// Agent name generator — two-hyphenated words from curated lists. Lean playful.
// Used by the onboarding screen and the suggest-name endpoint. Side-effect free.

const ADJECTIVES = [
  'drift', 'copper', 'soft', 'blue', 'fuzzy', 'slow', 'neon', 'paper',
  'velvet', 'amber', 'quiet', 'gentle', 'silver', 'kind', 'patient', 'tidy',
  'lucid', 'humble', 'curious', 'eager', 'tame', 'sleek', 'cosmic', 'sturdy',
  'olive', 'rosy', 'plum', 'sandy', 'crisp', 'misty', 'glassy', 'icy',
  'sunny', 'shady', 'dusty', 'rusty', 'silken', 'woolly', 'flannel', 'denim',
  'silky', 'cottony', 'mossy', 'flinty', 'pebble', 'feather', 'cloudy', 'snowy',
  'spruce', 'cedar', 'birch', 'oak', 'maple', 'pine', 'fern', 'reed',
  'tidewater', 'inkwell', 'lantern', 'sundial', 'compass', 'kite', 'paperback', 'meadow',
  'grove', 'cove', 'harbor', 'beacon', 'hearth', 'wander', 'roam', 'sprig',
  'twilight', 'aurora', 'sable', 'cinder', 'opal', 'agate', 'jade', 'pearl',
];

const NOUNS = [
  'wombat', 'onion', 'vector', 'cantilever', 'tachyon', 'rocket', 'otter', 'comet',
  'mole', 'fossil', 'kestrel', 'paradox', 'falcon', 'thistle', 'bramble', 'lantern',
  'compass', 'sparrow', 'finch', 'heron', 'mantis', 'beetle', 'salamander', 'newt',
  'fern', 'orchid', 'lichen', 'kelp', 'coral', 'pebble', 'driftwood', 'meadow',
  'glade', 'fjord', 'mesa', 'tundra', 'oasis', 'reef', 'estuary', 'arroyo',
  'lighthouse', 'archive', 'satchel', 'pocket', 'almanac', 'codex', 'sonnet', 'haiku',
  'sundial', 'astrolabe', 'sextant', 'beacon', 'bridle', 'lantern', 'kite', 'pennant',
  'fjord', 'glacier', 'aurora', 'moonrise', 'sunrise', 'eclipse', 'meridian', 'parallel',
  'lemma', 'theorem', 'quanta', 'tessera', 'mosaic', 'helix', 'nebula', 'pulsar',
  'umbra', 'penumbra', 'apogee', 'parsec', 'lattice', 'spindle', 'lyre', 'fugue',
];

const usedInSession = new Set<string>();

export function generateAgentName(): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const name = `${adj}-${noun}`;
    if (!usedInSession.has(name)) {
      usedInSession.add(name);
      return name;
    }
  }
  // Collisions exhausted — append 2-digit suffix.
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}-${noun}-${Math.floor(Math.random() * 90 + 10)}`;
}

export function resetSessionNamePool(): void {
  usedInSession.clear();
}
