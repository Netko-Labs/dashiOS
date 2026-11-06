// @dashi/ui: Dashi's own components, for what @mirinjs/metal-ui (shadcn) does not cover.
export { type Confirm, type ConfirmRequest, ConfirmSheet, type ConfirmSheetProps, confirmKeyAction, useConfirm } from "./confirm.tsx";
export { Button, Caption, type Choice, Choices, Group, Note, Row, Tile } from "./controls.tsx";
export { SearchField, Segmented, TextField, type TextFieldProps } from "./fields.tsx";
export * as glyphs from "./glyphs.ts";
export { CHECK, CHEVRON_DOWN, CHEVRON_UP, CLEAR, CLOSE, INFO, LOCK, RESTART, SEARCH, SHUT_DOWN, SLEEP, STOP, WARNING } from "./glyphs.ts";
export { KeySink, type KeySinkProps } from "./key-sink.tsx";
export { type KeyInput, keyName } from "./keys.ts";
export { Avatar, LoginScreen, type LoginScreenProps, type PowerAction } from "./login-screen.tsx";
export { Notice, type NoticeProps } from "./notice.tsx";
export { defaultScale, isBuiltIn, SCALES, type ScreenSize } from "./scale.ts";
export { type RowLook, rowLook, SELECTION_BAR, SelectionBar, selectionBarHeight } from "./selection.tsx";
export { EmptyState, type MenuItem, PopupMenu, Sheet, type SheetProps } from "./sheet.tsx";
export { KEY_GLYPHS, Shortcut, shortcutParts } from "./shortcut.tsx";
export { SidebarItem, type SidebarItemProps } from "./sidebar.tsx";
export { Switch, type SwitchProps } from "./switch.tsx";
export { type Column, Table, type TableProps } from "./table.tsx";
export { moveSelection, nextSort, type SortableColumn, type SortState, sortRows } from "./table-sort.ts";
export {
  type AppearanceSource,
  contrastRatio,
  DARK_SURFACE,
  darkColors,
  LIGHT_SURFACE,
  lightColors,
  type Palette,
  paletteFor,
  parseHex,
  type Surface,
  setAppearanceSource,
  TINT_ORDER,
  TINT_VALUES,
  TINTS,
  type TintName,
  tintFor,
  useColors,
  useDark,
  useSurface,
} from "./theme/index.ts";
export { TOOLTIP_DELAY_MS, type Tooltip, TooltipLayer, tooltipOrigin, useTooltip } from "./tooltip.tsx";
export {
  AppWindow,
  type AppWindowProps,
  SIDEBAR_WIDTH,
  SidebarSection,
  type TitleBarInset,
  ToolbarButton,
  useTitleBarInset,
} from "./window.tsx";
