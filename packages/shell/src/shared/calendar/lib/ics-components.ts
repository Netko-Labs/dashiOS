/**
 * The tree of an .ics file: its components (VCALENDAR, VEVENT, VALARM, …) and
 * the lines of each, with BEGIN and END checked to match and nesting capped.
 */

import { type ContentLine, parseLine } from "../ics-lines.ts";
import { CalendarError } from "../types.ts";

export interface Component {
  name: string;
  lines: ContentLine[];
  children: Component[];
  /** Every line from BEGIN to END, as written. */
  raw: string[];
}

export function parseComponents(lines: readonly string[]): Component {
  const root: Component = { name: "", lines: [], children: [], raw: [] };
  const stack: Component[] = [root];
  for (const raw of lines) {
    const line = parseLine(raw);
    if (!line) throw new CalendarError(`Not an iCalendar file: “${raw.slice(0, 40)}” is not a content line.`);
    const top = stack[stack.length - 1] as Component;
    if (line.name === "BEGIN") {
      const component: Component = { name: line.value.trim().toUpperCase(), lines: [], children: [], raw: [raw] };
      top.children.push(component);
      stack.push(component);
      if (stack.length > 6) throw new CalendarError("Not an iCalendar file: components are nested too deeply.");
    } else if (line.name === "END") {
      if (stack.length < 2 || top.name !== line.value.trim().toUpperCase()) throw new CalendarError("Not an iCalendar file: BEGIN and END do not match.");
      top.raw.push(raw);
      stack.pop();
      if (stack.length > 1) (stack[stack.length - 1] as Component).raw.push(...top.raw);
    } else {
      if (stack.length < 2) throw new CalendarError("Not an iCalendar file: a property is outside any component.");
      top.lines.push(line);
      top.raw.push(raw);
    }
  }
  if (stack.length !== 1) throw new CalendarError("Not an iCalendar file: it ends inside a component.");
  return root;
}
