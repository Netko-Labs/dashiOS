// @dashi/ui: Dashi's own components, for what @mirinjs/metal-ui (shadcn) does not cover.
export {
  ALERT_TILE,
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
export { BUTTON, Button, type ButtonProps, type ButtonSize, type Look } from "./button.tsx";
export { type ButtonKind, type ButtonLook, buttonLook } from "./button-look.ts";
export { CHECKBOX, Checkbox, type CheckboxProps } from "./checkbox.tsx";
export { CHIP, Chip, type ChipTone, chipColors } from "./chip.tsx";
export { type Choice, Choices } from "./choices.tsx";
export { type Confirm, type ConfirmRequest, ConfirmSheet, type ConfirmSheetProps, confirmKeyAction, useConfirm } from "./confirm.tsx";
export { ControlName } from "./control-name.ts";
export { type ControlState, DISABLED_OPACITY, isHeld, type ShownStates, ShowStates, useControlState } from "./control-state.tsx";
export { Caption, Group, Note, ROW_INSET, Row } from "./controls.tsx";
export { EDITABLE_TEXT, EditableText, type EditableTextProps, type EditableTextStyle } from "./editable-text.tsx";
export { EMPTY_STATE, EmptyState, NoResults, noResultsMessage } from "./empty-state.tsx";
export { ERROR_STATE, ErrorState } from "./error-state.tsx";
export { FoldedChoices, type FoldedChoicesProps } from "./folded.tsx";
export { FormSheet, type FormSheetProps } from "./form-sheet.tsx";
export * as glyphs from "./glyphs.ts";
export {
  CHECK,
  CHEVRON_DOWN,
  CHEVRON_LEFT,
  CHEVRON_RIGHT,
  CHEVRON_UP,
  CHEVRON_UP_DOWN,
  CLOSE,
  INFO,
  LOCK,
  LOGO,
  MORE,
  OFFLINE,
  PROBLEM,
  RESTART,
  SEARCH,
  SHUT_DOWN,
  SLEEP,
  STOP,
  WARNING,
} from "./glyphs.ts";
export { KeySink, type KeySinkProps } from "./key-sink.tsx";
export { KeyedText, type KeyedTextStyle, keyGlyphSize, namesKeys } from "./keyed-text.tsx";
export { KEYPAD_KEY, KeypadKey, type KeypadKeyProps, type KeypadKeyTone } from "./keypad-key.tsx";
export { type KeyInput, keyName } from "./keys.ts";
export { Avatar, LOGIN_FOCUS_RING, LOGIN_GROUND, LOGIN_INK, LOGIN_MUTED, LoginScreen, type LoginScreenProps, type PowerAction } from "./login-screen.tsx";
export { MENU, type MenuRowKind, menuHeight, menuLabelLeft, placeMenu, rowTop, type Size } from "./menu-place.ts";
export { type MenuHighlight, MenuHighlightContext, MenuLine, MenuRow, type MenuRowProps, menuHighlight } from "./menu-row.tsx";
export { MONTH_GRID, MonthGrid, type MonthGridProps } from "./month-grid.tsx";
export { addMonths, type Day, dayKey, type GridDay, monthWeeks, sameDay, weekdayLetters } from "./month-math.ts";
export { MORE_BUTTON, MoreButton } from "./more.tsx";
export { Notice, type NoticeProps } from "./notice.tsx";
export {
  CONTROL_MOTION_MS,
  controlMenuHighlight,
  FOLD_PAST,
  FOLDED_PILLS,
  type Folded,
  foldChoices,
  GlyphDisc,
  INK_SLIDER,
  InkFill,
  InkSlider,
  type InkSliderProps,
  Knob,
  LimitBar,
  LOW_CHARGE,
  moreMenuOrigin,
  PANEL_EDGE_WIDTH,
  type PanelEdge,
  panelEdge,
  setControlMotion,
  springAt,
  useControlColors,
  useGrow,
  usePanelEdge,
  useSpring,
} from "./panel/index.ts";
export { PICK_ROW, PickList, PickRow, type PickRowProps } from "./pick-row.tsx";
export { Picture, type PictureProps } from "./picture.tsx";
export { PopUpButton, type PopUpButtonProps, type PopUpOption, popUpMenuWidth, popUpOrigin } from "./popup-button.tsx";
export { isSeparator, MENU_SEPARATOR, type MenuEntry, type MenuItem, MenuList, type MenuSeparator, PopupMenu, tidyEntries } from "./popup-menu.tsx";
export { LOADING_DELAY_MS, Loading, PROGRESS_BAR, ProgressBar, type ProgressBarProps, Spinner, useShownAfter } from "./progress.tsx";
export { clampFraction, spinnerMarkup, spokeOpacities, sweepOffset } from "./progress-math.ts";
export { defaultScale, isBuiltIn, SCALES, type ScreenSize } from "./scale.ts";
export { placeholderAt, SEARCH_FIELD, SearchField, type SearchFieldProps } from "./search-field.tsx";
export { type MorePill, type PillsLaid, PillsWrapped, pillsWrapped, SEGMENTED, SEGMENTED_WINDOW, Segmented, type SegmentedProps } from "./segmented.tsx";
export { type RowLook, rowLook, SELECTION_BAR, SelectionBar, selectionBarHeight, TextSelectionLook } from "./selection.tsx";
export { SHEET_MARGIN, Sheet, SheetCard, type SheetProps, sheetBodyRoom, sheetWidth } from "./sheet.tsx";
export { KEY_GLYPHS, Shortcut, shortcutParts } from "./shortcut.tsx";
export { railTip, SIDEBAR, SIDEBAR_ROW_HEIGHT, SidebarItem, type SidebarItemProps } from "./sidebar.tsx";
export { Slider, type SliderProps } from "./slider.tsx";
export {
  type Direction,
  fillLength,
  fractionAt,
  fractionOf,
  keyValues,
  knobLeft,
  levelAt,
  nearestIndex,
  type SliderBox,
  type SliderRange,
  stepLevel,
  UNIT_RANGE,
  valueAt,
} from "./slider-math.ts";
export { StepKeys, type StepKeysProps } from "./step-keys.tsx";
export { PANEL_SWITCH, SWITCH, Switch, type SwitchProps } from "./switch.tsx";
export { Table, type TableProps } from "./table.tsx";
export type { Column } from "./table-parts.tsx";
export { holdOrder, moveSelection, nextSort, type SortableColumn, type SortState, sortRows } from "./table-sort.ts";
export { hostTextAntialiasing, type TextAntialiasing } from "./text-antialiasing.ts";
export { TEXT_FIELD, TextField, type TextFieldProps } from "./text-field.tsx";
export { TextLink } from "./text-link.tsx";
export {
  ACCENT_PRESET_IDS,
  ACCENT_PRESETS,
  type AccentChoice,
  type AccentDrawing,
  type AccentPreset,
  type AccentTokens,
  AMBER,
  Appearance,
  type AppearanceSource,
  accentSentence,
  CAPSULE,
  CAPTURE_AREA,
  CLEAR,
  type ControlPalette,
  CURVE,
  choiceName,
  contrastRatio,
  controlPalette,
  DARK_CONTROLS,
  DARK_SURFACE,
  DEFAULT_TEXT_SIZE,
  DELAY,
  darkColors,
  deltaE,
  drawAccent,
  FILE_ICONS,
  FILE_TINTS,
  type FileCategory,
  type FileIconColors,
  GNOME_ACCENTS,
  GTK_DARK,
  GTK_LIGHT,
  GTK_STATUS,
  type GtkNamedColors,
  type GtkStatusColors,
  HIT_AREA,
  hexToOklch,
  INK_NAMES,
  INK_PAPER,
  INK_RULE,
  INK_TEXT,
  INK_TILE,
  INKS,
  type InkMode,
  type InkName,
  type InkOptions,
  type InkSpec,
  type InkTokens,
  inkHex,
  inkTokens,
  isAccentChoice,
  isAccentHex,
  isGuardedHue,
  isKombu,
  isTextSize,
  KNOB,
  KOMBU_SEED,
  LIGHT_CONTROLS,
  LIGHT_SURFACE,
  LOCK_GLASS,
  LOGIN,
  lightColors,
  MEDIA_SCRIM,
  MOTION,
  type Oklch,
  ON_AGENT,
  ON_DANGER,
  ON_INK,
  ON_TINT,
  type OnColors,
  OPACITY,
  oklchToHex,
  onOf,
  type Palette,
  PERSONA_COLORS,
  type PersonaColor,
  paletteFor,
  parseHex,
  pill,
  RADIUS,
  SCRIM,
  SHADOW,
  type ShadowToken,
  SPACE,
  type Surface,
  scaled,
  scaleType,
  seedFromPixels,
  seedOf,
  setAppearanceSource,
  setTextSizeSource,
  TALLY,
  TERMINAL,
  TEXT_SIZES,
  type TerminalColors,
  type TextSizeSource,
  TINT_ORDER,
  TINT_VALUES,
  TINTS,
  type TintName,
  TRUE_BLACK,
  TYPE,
  type TypeRole,
  type TypeSet,
  tallyHex,
  tintFor,
  typeAt,
  useAccent,
  useColors,
  useDark,
  useSurface,
  useTextSize,
  useType,
  WEIGHT,
} from "./theme/index.ts";
export { TILE_SIZE, Tile } from "./tile.tsx";
export { TITLE_TAB, TitleTab, TitleTabMore, type TitleTabProps } from "./title-tab.tsx";
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
export { placeOf, TITLE_KEEP, titleRoom, WindowTitle } from "./window-title.tsx";
