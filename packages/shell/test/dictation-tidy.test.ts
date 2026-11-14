import { expect, test } from "bun:test";
import { tidy } from "../src/dictation/lib/tidy.ts";
import { keepsMeaning } from "../src/dictation/lib/tidy-check.ts";
import { DROPPABLE, isNegation, isNumber } from "../src/dictation/lib/tidy-words.ts";

const typed = (heard: string): string => tidy(heard).typed;

test("fillers go out, with the comma that was only theirs", () => {
  expect(typed("Um, I think we should, uh, meet on Tuesday.")).toBe("I think we should, meet on Tuesday.");
  expect(typed("So um we can go")).toBe("So we can go");
  expect(typed("Uh. Let's start.")).toBe("Let's start.");
  expect(typed("I was there, um.")).toBe("I was there.");
  expect(tidy("Um, hello, uh, there").changes).toContainEqual({ kind: "filler", count: 2 });
});

test("los rellenos salen, y «este» y «o sea» solo entre comas", () => {
  expect(typed("Eh, creo que, este, podemos ir mañana.")).toBe("Creo que, podemos ir mañana.");
  expect(typed("Quiero este libro, o sea, el azul.")).toBe("Quiero este libro, el azul.");
  // A real word stays: "este" the demonstrative, "o sea" inside a clause.
  expect(typed("Este libro es mío.")).toBe("Este libro es mío.");
  expect(typed("Que venga o sea puntual.")).toBe("Que venga o sea puntual.");
});

test("spaces and capitals are set", () => {
  expect(typed("hello there .  how are you ?")).toBe("Hello there. How are you?");
  expect(typed("¿cómo estás? bien.")).toBe("¿Cómo estás? Bien.");
  const { changes } = tidy("hello there . fine");
  expect(changes).toContainEqual({ kind: "capital", count: 2 });
  expect(changes).toContainEqual({ kind: "spacing", count: 1 });
  // Marks that are not sentence marks keep the spaces they had.
  expect(typed("It costs $5 (about 4.50 €) at 10:30.")).toBe("It costs $5 (about 4.50 €) at 10:30.");
});

test("punctuation said out loud becomes the mark", () => {
  expect(typed("Hello comma how are you period")).toBe("Hello, how are you.");
  expect(typed("Hello, comma, how are you question mark")).toBe("Hello, how are you?");
  expect(typed("Dear Alex, new line. Thanks for the notes. New paragraph. See you soon")).toBe("Dear Alex\nThanks for the notes.\n\nSee you soon");
  expect(typed("first item new line second item")).toBe("First item\nSecond item");
  // The model's own full stop after a comma said out loud goes, and so does the capital it gave the next word.
  expect(typed("Um, hello there, comma. This is a test of dictation period.")).toBe("Hello there, this is a test of dictation.");
  expect(typed("Tell Sam comma. I'm late period")).toBe("Tell Sam, I'm late.");
  expect(tidy("Hello comma world period").changes).toContainEqual({ kind: "punctuation", count: 2 });
});

test("la puntuación dicha se escribe", () => {
  expect(typed("Hola coma cómo estás punto")).toBe("Hola, cómo estás.");
  expect(typed("Primera cosa. Nueva línea. Segunda cosa")).toBe("Primera cosa.\nSegunda cosa");
  expect(typed("lo primero punto y coma lo segundo punto")).toBe("Lo primero; lo segundo.");
});

test("a word that only sounds like punctuation stays a word", () => {
  expect(typed("The trial period ends on Friday.")).toBe("The trial period ends on Friday.");
  expect(typed("A new line of products.")).toBe("A new line of products.");
  expect(typed("Nos vemos a las tres en punto.")).toBe("Nos vemos a las tres en punto.");
  expect(typed("Desde mi punto de vista está bien.")).toBe("Desde mi punto de vista está bien.");
  expect(typed("Está en coma desde ayer.")).toBe("Está en coma desde ayer.");
  expect(typed("Quiero que coma más.")).toBe("Quiero que coma más.");
  expect(typed("Period pieces are fun.")).toBe("Period pieces are fun.");
});

test("a simple change of mind is carried out", () => {
  expect(typed("Let's meet on Tuesday, no wait, Wednesday.")).toBe("Let's meet on Wednesday.");
  expect(typed("Let's meet on Tuesday, no wait, on Wednesday at noon.")).toBe("Let's meet on Wednesday at noon.");
  expect(typed("Send it to Sam. Scratch that. Send it to Alex.")).toBe("Send it to Alex.");
  expect(typed("I think we should cancel, no wait, let's just move the meeting.")).toBe("Let's just move the meeting.");
  expect(typed("Call me at five. No, wait. Six.")).toBe("Call me at six.");
  expect(typed("Buy milk. Buy eggs. Scratch that.")).toBe("Buy milk.");
  // As the model writes it when no comma is heard.
  expect(typed("Let's meet on Tuesday. No wait Wednesday. I do not want three of them. Uh, I want thirty.")).toBe(
    "Let's meet on Wednesday. I do not want three of them. I want thirty.",
  );
  expect(tidy("Let's meet on Tuesday, no wait, Wednesday.").changes).toContainEqual({ kind: "change-of-mind", from: "Tuesday", to: "Wednesday" });
});

test("un cambio de idea sencillo se cumple", () => {
  expect(typed("Nos vemos el martes, no, perdón, el miércoles.")).toBe("Nos vemos el miércoles.");
  expect(typed("Llega a las cinco, no perdón, seis.")).toBe("Llega a las seis.");
});

test("words that only look like a change of mind stay", () => {
  expect(typed("There's no wait at the restaurant.")).toBe("There's no wait at the restaurant.");
  expect(typed("No wait time is fine.")).toBe("No wait time is fine.");
  expect(typed("I said no. Wait for me.")).toBe("I said no. Wait for me.");
  expect(typed("Scratch that itch.")).toBe("Scratch that itch.");
});

test("a number is never changed and a not is never lost", () => {
  for (const heard of [
    "I do not want 3 of them, um, I want 30.",
    "No, uh, don't send the 1,000 dollars.",
    "No quiero, eh, ninguno de los 15.",
    "Um, never call before 10:30, period",
  ]) {
    const out = tidy(heard);
    expect(out.asHeard).toBe(false);
    const kept = (text: string): string[] =>
      text
        .toLowerCase()
        .split(/[^\p{L}\p{N}'’:.,]+/u)
        .map((word) => word.replace(/[.,:]+$/, ""))
        .filter((word) => isNumber(word) || isNegation(word));
    expect(kept(out.typed)).toEqual(kept(heard));
  }
});

test("the check trips on a lost not, a changed number or a word that was not said", () => {
  expect(keepsMeaning("I do not want it", "I do want it")).toBe(false);
  expect(keepsMeaning("Send 15 boxes", "Send 50 boxes")).toBe(false);
  expect(keepsMeaning("Send 15 boxes", "Send boxes")).toBe(false);
  expect(keepsMeaning("Send the boxes", "Send all the boxes")).toBe(false);
  expect(keepsMeaning("boxes the send", "send the boxes")).toBe(false);
  expect(keepsMeaning("Um, send the boxes", "Send the boxes")).toBe(true);
  expect(keepsMeaning("No, send them", "Send them")).toBe(false);
  // No rule may take out a number or a negation.
  for (const word of DROPPABLE) expect(isNumber(word) || isNegation(word)).toBe(false);
});

test("when the check trips the words land as heard", () => {
  // The part taken back said "not"; what replaced it does not: Dashi does not guess.
  const out = tidy("Do not send it, no wait, send it today.");
  expect(out.asHeard).toBe(true);
  expect(out.typed).toBe("Do not send it, no wait, send it today.");
  expect(out.changes).toEqual([]);
});

test("off, the words are typed as heard", () => {
  expect(tidy("um, hello comma world", false)).toEqual({ typed: "um, hello comma world", heard: "um, hello comma world", changes: [], asHeard: false });
  expect(tidy("  ").typed).toBe("");
});

test("a line break said alone is a line break", () => {
  expect(typed("New line.")).toBe("\n");
  expect(typed("Nueva línea")).toBe("\n");
  expect(typed("new line hello")).toBe("\nHello");
});
