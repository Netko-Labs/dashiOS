// @dashi/ui: Dashi's own components, for what @mirinjs/metal-ui (shadcn) does not cover.
export {
  Alert,
  type AlertButton,
  AlertButtons,
  type AlertProps,
  AlertSheet,
  type AlertTone,
  AlertWindow,
  type AlertWindowProps,
  alertKeyTarget,
  pressForKey,
  toneColors,
} from "./alert.tsx";
export { ALERT_WINDOW, type AlertContent, alertButtonsWidth, alertWindowHeight, alertWordsWidth, wrappedLines } from "./alert-size.ts";
export { type ButtonKind, type ButtonLook, buttonLook } from "./button-look.ts";
export { type Confirm, type ConfirmRequest, ConfirmSheet, type ConfirmSheetProps, confirmKeyAction, useConfirm } from "./confirm.tsx";
export { type ControlState, DISABLED_OPACITY, isHeld, type ShownStates, ShowStates, useControlState } from "./control-state.tsx";
export { Button, Caption, type Choice, Choices, Group, Note, Row, Tile } from "./controls.tsx";
export { SearchField, Segmented, TextField, type TextFieldProps } from "./fields.tsx";
export * as glyphs from "./glyphs.ts";
export {
  CHECK,
  CHEVRON_DOWN,
  CHEVRON_UP,
  CHEVRON_UP_DOWN,
  CLEAR,
  CLOSE,
  INFO,
  LOCK,
  MORE,
  RESTART,
  SEARCH,
  SHUT_DOWN,
  SLEEP,
  STOP,
  WARNING,
} from "./glyphs.ts";
export { KeySink, type KeySinkProps } from "./key-sink.tsx";
export { type KeyInput, keyName } from "./keys.ts";
export { Avatar, LOGIN_FOCUS_RING, LOGIN_GROUND, LOGIN_INK, LOGIN_MUTED, LoginScreen, type LoginScreenProps, type PowerAction } from "./login-screen.tsx";
export { MENU, type MenuRowKind, menuHeight, menuLabelLeft, placeMenu, rowTop, type Size } from "./menu-place.ts";
export { type MenuHighlight, MenuHighlightContext, MenuLine, MenuRow, type MenuRowProps, menuHighlight } from "./menu-row.tsx";
export { MORE_BUTTON, MoreButton } from "./more.tsx";
export { Notice, type NoticeProps } from "./notice.tsx";
export { PopUpButton, type PopUpButtonProps, type PopUpOption, popUpMenuWidth, popUpOrigin } from "./popup-button.tsx";
export { LOADING_DELAY_MS, Loading, ProgressBar, type ProgressBarProps, Spinner, useShownAfter } from "./progress.tsx";
export { clampFraction, spinnerMarkup, spokeOpacities, sweepOffset } from "./progress-math.ts";
export { defaultScale, isBuiltIn, SCALES, type ScreenSize } from "./scale.ts";
export { type RowLook, rowLook, SELECTION_BAR, SelectionBar, selectionBarHeight, TextSelectionLook } from "./selection.tsx";
export {
  EmptyState,
  isSeparator,
  MENU_SEPARATOR,
  type MenuEntry,
  type MenuItem,
  MenuList,
  type MenuSeparator,
  PopupMenu,
  SCRIM,
  SHEET_MARGIN,
  Sheet,
  SheetCard,
  type SheetProps,
  sheetBodyRoom,
  sheetWidth,
  tidyEntries,
} from "./sheet.tsx";
export { KEY_GLYPHS, Shortcut, shortcutParts } from "./shortcut.tsx";
export { SidebarItem, type SidebarItemProps } from "./sidebar.tsx";
export { Slider, type SliderProps } from "./slider.tsx";
export { fractionAt, fractionOf, keyValues, knobLeft, nearestIndex, type SliderRange, UNIT_RANGE, valueAt } from "./slider-math.ts";
export { StepKeys, type StepKeysProps } from "./step-keys.tsx";
export { Switch, type SwitchProps } from "./switch.tsx";
export { type Column, Table, type TableProps } from "./table.tsx";
export { holdOrder, moveSelection, nextSort, type SortableColumn, type SortState, sortRows } from "./table-sort.ts";
export {
  Appearance,
  type AppearanceSource,
  contrastRatio,
  DARK_SURFACE,
  DEFAULT_TEXT_SIZE,
  darkColors,
  isTextSize,
  LIGHT_SURFACE,
  lightColors,
  type Palette,
  paletteFor,
  parseHex,
  type Surface,
  scaled,
  setAppearanceSource,
  setTextSizeSource,
  TEXT_SIZES,
  type TextSizeSource,
  TINT_ORDER,
  TINT_VALUES,
  TINTS,
  type TintName,
  TRUE_BLACK,
  tintFor,
  useColors,
  useDark,
  useSurface,
  useTextSize,
} from "./theme/index.ts";
export { TOOLTIP_DELAY_MS, type Tooltip, TooltipLayer, tooltipOrigin, useTooltip, useWindowLayer } from "./tooltip.tsx";
export { JOIN_MS as UNDO_JOIN_MS, redoLabel, UNDO_LIMIT, type UndoAction, UndoStack, type UndoState, undoLabel, undoMenuItems, useUndo } from "./undo.ts";
export {
  AppWindow,
  type AppWindowProps,
  SIDEBAR_WIDTH,
  SidebarSection,
  type TitleBarInset,
  ToolbarButton,
  useTitleBarInset,
} from "./window.tsx";
