import chalk from 'chalk';
import * as p from '@clack/prompts';

const TOGGLE_ALL = '__synap_toggle_all__';

/**
 * Wraps `p.multiselect` with a "Select / Deselect All" toggle as the first
 * option. The label is always the same — the user can see the current state
 * from the checkboxes themselves.
 *
 * When the toggle is checked:
 *   - If all real items are currently selected → deselects all (returns []).
 *   - Otherwise → selects all (returns every item).
 *
 * Leaving the toggle alone → returns whatever the user individually selected.
 */
export async function multiselectWithToggle<T>(opts: {
  message: string;
  options: { value: T; label: string; hint?: string }[];
  initialValues?: T[];
  required?: boolean;
}): Promise<T[] | symbol> {
  const allItems = opts.options.map((o) => o.value);

  const result = await p.multiselect<T>({
    message: opts.message,
    options: ([
      { value: TOGGLE_ALL as unknown as T, label: chalk.dim('Select / Deselect All') },
      ...opts.options,
    ] as unknown) as Parameters<typeof p.multiselect<T>>[0]['options'],
    initialValues: [...(opts.initialValues ?? [])],
    required: opts.required,
  });

  if (typeof result === 'symbol') return result;

  const raw = result as unknown[];

  if (raw.includes(TOGGLE_ALL)) {
    const realSelected = raw.filter((v) => v !== TOGGLE_ALL);
    return realSelected.length === allItems.length ? [] : [...allItems];
  }

  return raw as T[];
}
