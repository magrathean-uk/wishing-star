// Kind built-in words for a letter or a bottle whose own words are not in this copy's personal file (a player in
// players mode has none, D67). They live in strings.ts as `kind:<id>:<page>` and use tokens only, never a name.

/** Who a letter with built-in words is from, as the letter's heading and in the mailbox list. */
export const KIND_FROM = 'A friend on the island';
export const KIND_FROM_LIST = 'a friend on the island';

/**
 * The pages for letter or bottle `id`: its own built-in pages, else the general ones, with the friend's sign-off on
 * the last page. Never empty.
 */
export function kindPages(strings: Record<string, string>, id: string): string[] {
  const read = (key: string): string[] => {
    const out: string[] = [];
    for (let i = 1; strings[`kind:${key}:${i}`]; i++) out.push(strings[`kind:${key}:${i}`]!);
    return out;
  };
  let pages = read(id);
  if (!pages.length) pages = read(id.startsWith('bottle') ? 'bottle' : 'letter');
  if (!pages.length) pages = ['Hello, {hero}! Have a lovely day.'];
  const sign = strings.kind_sign ?? 'Love, a friend on the island';
  pages[pages.length - 1] = `${pages[pages.length - 1]}\n\n${sign}`;
  return pages;
}
