import { socialEnglishText } from '../content/social.mjs';
// Existing multilingual experiments retain their original source records.
// Only the simulator's known synthetic Spanish templates get an English view;
// arbitrary external/user text is never guessed or overwritten.
const templates = [
  [
    /^En (.+), (\d+) personas necesitan (.+) (\S+) de (\S+)\.$/,
    (_, place, people, quantity, unit, type) =>
      `At ${place}, ${people} people need ${quantity} ${unit} of ${type}.`,
  ],
  [
    /^En (.+) seguimos esperando (.+) (\S+) de (\S+)\.$/,
    (_, place, quantity, unit, type) =>
      `At ${place} we are still waiting for ${quantity} ${unit} of ${type}.`,
  ],
  [
    /^La ayuda ya llegó a (.+)\. No hace falta enviar nada más\.$/,
    (_, place) => `All the aid has arrived at ${place}. No more help is needed.`,
  ],
  [
    /^Hay daños visibles en (.+); la seguridad aún requiere inspección\.$/,
    (_, place) => `Visible damage at ${place}; safety still needs an inspection.`,
  ],
  [
    /^Pensando en los equipos y familias afectados cerca de (.+)\.$/,
    (_, place) => `Thinking of teams and families affected near ${place}.`,
  ],
  [
    /^El edificio (.+) está intacto y todos sus servicios funcionan\.$/,
    (_, place) => `The building at ${place} is intact and all its services work.`,
  ],
  [/^Video: (.+) se derrumbó hoy\.$/, (_, place) => `Video: ${place} has collapsed today.`],
];
export function englishText(text) {
  if (typeof text !== 'string') return text;
  const social = socialEnglishText(text);
  if (social !== text) return social;
  for (const [pattern, render] of templates) {
    const match = pattern.exec(text);
    if (match) return render(...match);
  }
  return text;
}
