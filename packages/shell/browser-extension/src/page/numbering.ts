/**
 * How a frame gives its elements numbers (content/dom.ts holds the elements):
 * a new number for each new element, except that an element whose key (its
 * role, name and address) only one element ever had, and whose element has
 * gone, takes that number back. So a page that redraws its "Sign in" button
 * keeps [12], and a list of ten "Add to cart" buttons never swaps them.
 * Pure, so it is tested without a page.
 */

export class Numbering {
  private next = 1;
  private readonly byKey = new Map<string, number[]>();

  /** The number for a new element with `key` (null: no key); `live` says whether a number's element is still in the page. */
  take(key: string | null, live: (ref: number) => boolean): number {
    const given = key === null ? undefined : this.byKey.get(key);
    const only = given?.length === 1 ? given[0] : undefined;
    if (only !== undefined && !live(only)) return only;
    const ref = this.next++;
    if (key !== null) this.byKey.set(key, [...(given ?? []), ref]);
    return ref;
  }
}
