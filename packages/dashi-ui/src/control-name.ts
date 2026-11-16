/**
 * The name a control takes from the row it sits in: Settings' rows say what
 * their switch does in the row's words ("Natural scrolling"), so the switch
 * names itself with them for a screen reader and an agent's read_window
 * (`Row` provides it; `Switch` reads it unless given a `label`).
 */

import { createContext } from "react";

export const ControlName = createContext<string | undefined>(undefined);
