/**
 * What Preview says when something goes wrong, in one place (docs/design.html,
 * PA-6): what happened, and what to do next when there is something, in a
 * plain sentence. Never a program's name or a package to install: a missing
 * helper is packaging's bug (the dashi package requires them), and the person
 * only needs to know what this computer can't do.
 */

export const MESSAGES = {
  notAFile: "This is a folder, not a file.",
  tooLarge: "This file is too large to open.",
  notFound: "The file is gone, or you don’t have access to it.",
  unreadable: "The file couldn’t be read.",
  mislabelled: "The file’s name says it’s a picture or a PDF, but what’s inside isn’t.",
  unknownKind: "Preview opens pictures and PDFs. Try another app with Open With.",
  cantOpenKind: (label: string): string => `Preview can’t open ${label.replace(/ image$/, "")} pictures on this computer.`,
  cantOpenPdf: "Preview can’t open PDFs on this computer.",
  tooLargeToShow: "This picture is too large to show.",
  noSize: "This picture’s size couldn’t be read. It may be damaged.",
  damaged: "This picture couldn’t be shown. It may be damaged.",
  damagedPdf: "This PDF couldn’t be read. It may be damaged.",
  locked: "This PDF is locked with a password. Preview can’t open locked PDFs yet.",
  /** Info's line about a picture shown other than as stored. */
  shownSmaller: "Shown smaller than it is, to save memory",
  notUpright: "Shown as stored: its camera rotation isn’t applied",
  clipboard: "Couldn’t copy. Try again.",
  noChooser: "Open the file from Files, or drag it onto this window.",
  noPrinting: "No printer is set up. Add one in Settings, then try again.",
  printFailed: "The printer didn’t take it. Check the printer, then try again.",
  exportFailed: "The copy couldn’t be written. Check there’s room and that you can write there.",
  trashFailed: "Check that the file is still there and that you can change its folder.",
  exportUnrotated: "Its pages are saved as they are, without the rotation.",
} as const;
