/**
 * AT-SPI's roles and states (at-spi2-core's AtspiRole and AtspiStateType),
 * and what each role is called in read_window's lines: the words read_page
 * uses for the same things on a web page, so a model learns one set.
 */

/** AtspiRole numbers this module decides by. */
export const R = {
  ALERT: 2,
  CANVAS: 6,
  CHECK_BOX: 7,
  CHECK_MENU_ITEM: 8,
  COLUMN_HEADER: 10,
  COMBO_BOX: 11,
  DIALOG: 16,
  DRAWING_AREA: 18,
  FILE_CHOOSER: 19,
  FILLER: 20,
  FRAME: 23,
  ICON: 26,
  IMAGE: 27,
  LABEL: 29,
  LIST: 31,
  LIST_ITEM: 32,
  MENU: 33,
  MENU_BAR: 34,
  MENU_ITEM: 35,
  PAGE_TAB: 37,
  PAGE_TAB_LIST: 38,
  PANEL: 39,
  PASSWORD_TEXT: 40,
  POPUP_MENU: 41,
  PROGRESS_BAR: 42,
  PUSH_BUTTON: 43,
  RADIO_BUTTON: 44,
  RADIO_MENU_ITEM: 45,
  SCROLL_BAR: 48,
  SCROLL_PANE: 49,
  SEPARATOR: 50,
  SLIDER: 51,
  SPIN_BUTTON: 52,
  SPLIT_PANE: 53,
  STATUS_BAR: 54,
  TABLE: 55,
  TABLE_CELL: 56,
  TERMINAL: 60,
  TEXT: 61,
  TOGGLE_BUTTON: 62,
  TOOL_BAR: 63,
  TOOL_TIP: 64,
  TREE: 65,
  TREE_TABLE: 66,
  UNKNOWN: 67,
  VIEWPORT: 68,
  WINDOW: 69,
  HEADER: 71,
  FOOTER: 72,
  PARAGRAPH: 73,
  APPLICATION: 75,
  AUTOCOMPLETE: 76,
  ENTRY: 79,
  CAPTION: 81,
  DOCUMENT_FRAME: 82,
  HEADING: 83,
  SECTION: 85,
  FORM: 87,
  LINK: 88,
  TABLE_ROW: 90,
  TREE_ITEM: 91,
  DOCUMENT_TEXT: 94,
  DOCUMENT_WEB: 95,
  LIST_BOX: 98,
  GROUPING: 99,
  NOTIFICATION: 101,
  INFO_BAR: 102,
  LEVEL_BAR: 103,
  TITLE_BAR: 104,
  LANDMARK: 110,
  STATIC: 116,
  PUSH_BUTTON_MENU: 129,
  SWITCH: 130,
} as const;

/** AtspiStateType bit numbers. */
export const S = {
  ACTIVE: 1,
  BUSY: 3,
  CHECKED: 4,
  COLLAPSED: 5,
  DEFUNCT: 6,
  EDITABLE: 7,
  ENABLED: 8,
  EXPANDABLE: 9,
  EXPANDED: 10,
  FOCUSABLE: 11,
  FOCUSED: 12,
  MODAL: 16,
  MULTI_LINE: 17,
  MULTISELECTABLE: 18,
  PRESSED: 20,
  SELECTABLE: 22,
  SELECTED: 23,
  SENSITIVE: 24,
  SHOWING: 25,
  VISIBLE: 30,
  INDETERMINATE: 32,
  REQUIRED: 33,
  IS_DEFAULT: 39,
  CHECKABLE: 41,
  HAS_POPUP: 42,
  READ_ONLY: 43,
} as const;

export function has(states: readonly number[], state: number): boolean {
  const word = states[state >> 5] ?? 0;
  return ((word >>> (state & 31)) & 1) === 1;
}

/** A role's word in read_window's lines, as read_page says it for the web. */
const WORDS: Readonly<Record<number, string>> = {
  [R.ALERT]: "alert",
  [R.CANVAS]: "canvas",
  [R.CHECK_BOX]: "checkbox",
  [R.CHECK_MENU_ITEM]: "menuitem",
  [R.COLUMN_HEADER]: "column header",
  57: "column header",
  58: "row header",
  [R.COMBO_BOX]: "combobox",
  [R.DIALOG]: "dialog",
  [R.DRAWING_AREA]: "canvas",
  [R.FILE_CHOOSER]: "file chooser",
  [R.ICON]: "image",
  [R.IMAGE]: "image",
  [R.LIST]: "list",
  [R.LIST_BOX]: "list",
  [R.LIST_ITEM]: "list item",
  [R.MENU]: "menu",
  [R.MENU_BAR]: "menu bar",
  [R.MENU_ITEM]: "menuitem",
  [R.PAGE_TAB]: "tab",
  [R.PAGE_TAB_LIST]: "tab list",
  [R.PASSWORD_TEXT]: "password field",
  [R.POPUP_MENU]: "menu",
  [R.PROGRESS_BAR]: "progress bar",
  [R.LEVEL_BAR]: "progress bar",
  [R.PUSH_BUTTON]: "button",
  [R.PUSH_BUTTON_MENU]: "button",
  [R.RADIO_BUTTON]: "radio",
  [R.RADIO_MENU_ITEM]: "menuitem",
  [R.SCROLL_BAR]: "scroll bar",
  [R.SLIDER]: "slider",
  [R.SPIN_BUTTON]: "spin button",
  [R.STATUS_BAR]: "status",
  [R.TABLE]: "table",
  [R.TREE_TABLE]: "table",
  [R.TREE]: "tree",
  [R.TABLE_ROW]: "row",
  [R.TABLE_CELL]: "cell",
  [R.TREE_ITEM]: "tree item",
  [R.TERMINAL]: "terminal",
  [R.TEXT]: "textbox",
  [R.ENTRY]: "textbox",
  [R.AUTOCOMPLETE]: "combobox",
  [R.TOGGLE_BUTTON]: "toggle button",
  [R.SWITCH]: "switch",
  [R.TOOL_BAR]: "toolbar",
  [R.LINK]: "link",
  [R.HEADING]: "heading",
  [R.NOTIFICATION]: "notification",
  [R.INFO_BAR]: "info bar",
  [R.DOCUMENT_WEB]: "web page",
  [R.DOCUMENT_TEXT]: "document",
  [R.DOCUMENT_FRAME]: "document",
  [R.TOOL_TIP]: "tooltip",
};

export const roleWord = (role: number): string => WORDS[role] ?? `role ${role}`;

/** Roles that are only layout: their children join the line above unless they are named. */
export const LAYOUT = new Set<number>([
  R.FILLER,
  R.PANEL,
  R.SCROLL_PANE,
  R.VIEWPORT,
  R.SPLIT_PANE,
  R.SECTION,
  R.GROUPING,
  R.FORM,
  R.LANDMARK,
  R.HEADER,
  R.FOOTER,
  R.UNKNOWN,
  R.WINDOW,
  R.FRAME,
  R.TITLE_BAR,
]);

/** Roles whose words are text to read, not something to use. */
export const TEXTUAL = new Set<number>([R.LABEL, R.STATIC, R.PARAGRAPH, R.CAPTION]);

/** Roles that hold rows, read a page at a time. */
export const ROWS = new Set<number>([R.LIST, R.LIST_BOX, R.TABLE, R.TREE, R.TREE_TABLE, R.MENU, R.POPUP_MENU]);

/** Roles one types into. */
export const FIELDS = new Set<number>([R.TEXT, R.ENTRY, R.PASSWORD_TEXT, R.SPIN_BUTTON, R.AUTOCOMPLETE, R.TERMINAL]);

/** Roles that are checked or not. */
export const CHECKABLE = new Set<number>([R.CHECK_BOX, R.CHECK_MENU_ITEM, R.RADIO_BUTTON, R.RADIO_MENU_ITEM, R.TOGGLE_BUTTON, R.SWITCH]);

/** Roles a sheet or dialog is. */
export const DIALOGS = new Set<number>([R.DIALOG, R.ALERT, R.FILE_CHOOSER]);
