// @dashi/ui: Dashi's own components, for what @mirinjs/metal-ui (shadcn) does not cover.
export {
  ALERT_TILE,
  Alert,
  type AlertButton,
  AlertButtons,
  type AlertProps,
  AlertSheet,
  type AlertSheetProps,
  type AlertTone,
  AlertWindow,
  type AlertWindowProps,
  alertKeyTarget,
  pressForKey,
  toneColors,
} from "./alert.tsx";
export { ALERT_WINDOW, type AlertContent, alertButtonsWidth, alertWindowHeight, alertWordsWidth, wrappedLines } from "./alert-size.ts";
export { BAR_ITEM, BAR_ITEM_WASH, BarItem, type BarItemProps, type BarItemTone, barItemColors, useBarItemColors } from "./bar-item.tsx";
export { BareField, type BareFieldProps } from "./bare-field.tsx";
export { Button } from "./button.tsx";
export { type ButtonKind, type ButtonLook, buttonLook } from "./button-look.ts";
export { BUTTON, type ButtonInks, type ButtonProps, type ButtonSize, type Look } from "./button-measures.ts";
export { CHECKBOX, Checkbox, type CheckboxProps, CheckMark } from "./checkbox.tsx";
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
export { Frosted, type FrostedProps, GlassLayer, OffGlass, useFocusGap, useGlassTone, useOnGlass, useSolidTwin } from "./frosted.tsx";
export { GLYPH_BUTTON, GlyphButton, type GlyphButtonProps } from "./glyph-button.tsx";
export * as glyphs from "./glyphs.ts";
export {
  ADD,
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
  QUESTION,
  RESTART,
  SEARCH,
  SHUT_DOWN,
  SLEEP,
  SQUARE,
  STOP,
  WARNING,
} from "./glyphs.ts";
export {
  CLOCK_DAY,
  ClockHead,
  type ClockHeadProps,
  clockFace,
  clockParts,
  InksClock,
  type InksClockProps,
  LockClock,
  type LockClockProps,
} from "./inks-clock.tsx";
export { InlineField, type InlineFieldProps } from "./inline-field.tsx";
export { KeySink, type KeySinkProps } from "./key-sink.tsx";
export { KeyedText, type KeyedTextStyle, keyGlyphSize, namesKeys } from "./keyed-text.tsx";
export { KEYPAD_KEY, KeypadKey, type KeypadKeyProps, type KeypadKeyTone } from "./keypad-key.tsx";
export { type KeyInput, keyName } from "./keys.ts";
export { clockBlock, clockFor, type LockLayout, type LockShape, lockLayout, lockShape, paneWidth, type TodayPlace, WHO_HEIGHT } from "./lock-layout.ts";
export { Avatar, LOGIN_PARTS, LoginBackLink, LoginChip, LoginPerson } from "./login-parts.tsx";
export {
  LOGIN_FOCUS_RING,
  LOGIN_GROUND,
  LOGIN_INK,
  LOGIN_MUTED,
  LoginScreen,
  type LoginScreenProps,
  type PowerAction,
} from "./login-screen.tsx";
export { initialsOf, SplitLogin, type SplitLoginProps, type SplitPower } from "./login-split.tsx";
export { WhoSignsIn, type WhoSignsInProps } from "./login-who.tsx";
export { MENU, type MenuRowKind, menuHeight, menuLabelLeft, placeMenu, rowTop, type Size } from "./menu-place.ts";
export { type MenuHighlight, MenuHighlightContext, MenuLine, MenuRow, type MenuRowProps, menuHighlight } from "./menu-row.tsx";
export { MONTH_GRID, MonthGrid, type MonthGridProps } from "./month-grid.tsx";
export { addMonths, type Day, dayKey, type GridDay, monthWeeks, sameDay, weekdayLetters } from "./month-math.ts";
export { MORE_BUTTON, MoreButton } from "./more.tsx";
export { Notice, type NoticeProps } from "./notice.tsx";
export {
  type BatteryLook,
  BatteryTile,
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
  KNOB_BUTTON,
  Knob,
  KnobButton,
  type KnobButtonProps,
  LimitBar,
  LOW_CHARGE,
  moreMenuOrigin,
  NOW_PLAYING,
  type NowPlayingGlyphs,
  type NowPlayingLook,
  NowPlayingTile,
  OnPanelCard,
  PANEL_EDGE_WIDTH,
  type PanelEdge,
  panelEdge,
  panelFieldGround,
  RoundTile,
  type SliderLook,
  SliderTile,
  setControlMotion,
  springAt,
  TILE,
  type TileLook,
  type TilePress,
  useControlColors,
  useGrow,
  usePanelEdge,
  useSpring,
  WideTile,
} from "./panel/index.ts";
export { PICK_ROW, PickList, PickRow, type PickRowProps } from "./pick-row.tsx";
export { Picture, type PictureProps } from "./picture.tsx";
export { PICTURE_CHOICE, PictureChoice, type PictureChoiceProps, pictureRingRadius } from "./picture-choice.tsx";
export { PopUpButton, type PopUpButtonProps, type PopUpOption, popUpMenuWidth, popUpOrigin } from "./popup-button.tsx";
export { isSeparator, MENU_SEPARATOR, type MenuEntry, type MenuItem, MenuList, type MenuSeparator, PopupMenu, tidyEntries } from "./popup-menu.tsx";
export { LOADING_DELAY_MS, Loading, PROGRESS_BAR, ProgressBar, type ProgressBarProps, Spinner, useShownAfter } from "./progress.tsx";
export { clampFraction, spinnerMarkup, spokeOpacities, sweepOffset } from "./progress-math.ts";
export { defaultScale, isBuiltIn, SCALES, type ScreenSize } from "./scale.ts";
export { placeholderAt, SEARCH_FIELD, SearchField, type SearchFieldProps } from "./search-field.tsx";
export { type MorePill, type PillsLaid, PillsWrapped, pillsWrapped, SEGMENTED, SEGMENTED_WINDOW, Segmented, type SegmentedProps } from "./segmented.tsx";
export { type RowLook, rowLook, SELECTION_BAR, SelectionBar, selectionBarHeight, TextSelectionLook } from "./selection.tsx";
export { SHEET_MARGIN, SHEET_RADIUS, Sheet, SheetCard, type SheetPlace, type SheetProps, sheetBodyRoom, sheetWidth } from "./sheet.tsx";
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
export { INKS_SWITCH, PANEL_SWITCH, SWITCH, Switch, type SwitchProps } from "./switch.tsx";
export { Table, type TableProps } from "./table.tsx";
export type { Column } from "./table-parts.tsx";
export { holdOrder, moveSelection, nextSort, type SortableColumn, type SortState, sortRows } from "./table-sort.ts";
export { hostTextAntialiasing, type TextAntialiasing } from "./text-antialiasing.ts";
export { TEXT_AREA, TextArea, type TextAreaProps } from "./text-area.tsx";
export { TEXT_FIELD, TextField, type TextFieldProps } from "./text-field.tsx";
export { TextLink } from "./text-link.tsx";
export * from "./theme/index.ts";
export { TILE_SIZE, Tile } from "./tile.tsx";
export { inksButtonColors } from "./tinted-button.tsx";
export { titleFace, useTitleFace } from "./title-face.ts";
export { TITLE_TAB, TitleTab, TitleTabMore, type TitleTabProps } from "./title-tab.tsx";
export { ToolbarButton } from "./toolbar-button.tsx";
export { TOOLTIP_DELAY_MS, type Tooltip, TooltipLayer, tooltipOrigin, useTooltip, useWindowLayer } from "./tooltip.tsx";
export { JOIN_MS as UNDO_JOIN_MS, redoLabel, UNDO_LIMIT, type UndoAction, UndoStack, type UndoState, undoLabel, undoMenuItems, useUndo } from "./undo.ts";
export {
  AppWindow,
  type AppWindowProps,
  SIDEBAR_WIDTH,
  SidebarSection,
  type TitleBarInset,
  useTitleBarInset,
  WIZARD_PAGE,
} from "./window.tsx";
export { placeOf, TITLE_KEEP, titleRoom, WindowTitle } from "./window-title.tsx";
