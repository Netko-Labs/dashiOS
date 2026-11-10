/** Force Quit's public types: a row of the list. */

export interface AppGroup {
  /** The process that owns the windows; the process Force Quit signals. */
  pid: number;
  appId: string;
  name: string;
  icon: string;
  /** Windows the process has, minimized and hidden ones included. */
  windowCount: number;
  /** The first window's title, when another row has the same name, so the two can be told apart; "" otherwise. */
  detail: string;
}
