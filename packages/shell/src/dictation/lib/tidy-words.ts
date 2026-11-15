/**
 * The words tidying knows (tidy.ts), in English and Spanish: sounds that are
 * never words, phrases that are fillers only when set off, punctuation said
 * out loud, the phrases of a change of mind, and the words tidying may never
 * lose (numbers, a "not" or a "no").
 */

/** Never words: out wherever they are. */
export const FILLERS: ReadonlySet<string> = new Set(["um", "umm", "uh", "uhh", "uhm", "erm", "hm", "hmm", "mm", "mmm", "eh", "ehm"]);

/**
 * Fillers only where they are set off, where they can be nothing else: between two commas ("…, este, …", "…, o sea, …"),
 * or starting a sentence before a comma ("Like, I said…", "O sea, no sé").
 */
export const SET_OFF_FILLERS: readonly (readonly string[])[] = [["o", "sea"], ["you", "know"], ["este"], ["like"]];

/**
 * "like" with no commas round it is a filler only by its place: after a word that "like" cannot follow as a verb or a
 * comparison (a verb that takes its object straight away, a joining word, an article), and before a word that starts what
 * was meant ("give like an instruction", "gather like most of them", "the like describing"). "looks like a", "I like the"
 * and "something like that" stay.
 */
export const BEFORE_FILLER_LIKE: ReadonlySet<string> = new Set(
  (
    "give gives gave giving start starts started starting make makes made making write writes wrote writing gather gathers gathered " +
    "use uses used using have has had having get gets got getting need needs needed want wants wanted put puts take takes took add adds added " +
    "create creates created open opens opened see saw find found show shows showed say says said tell tells told build builds built " +
    "and so but then because when if the a an with for in of about just"
  ).split(" "),
);
export const AFTER_FILLER_LIKE: ReadonlySet<string> = new Set(
  "a an the one two three four five most some this that these those my your our any every all really very just hey".split(" "),
);

export interface Spoken {
  words: readonly string[];
  /** What is typed for it. */
  mark: string;
  /** Not punctuation after one of these ("the trial period", "en punto"). */
  notAfter?: readonly string[];
  /** Only where a sentence ends: before a mark, a line break or the end ("period", "punto"). */
  closes?: true;
}

const ARTICLES_EN = ["a", "an", "the", "this", "that", "my", "your", "his", "her", "our", "their"];
const ARTICLES_ES = ["el", "la", "un", "una", "este", "esta", "ese", "esa", "mi", "tu", "su", "al", "del", "de", "en", "a"];
const NOT_A_COMMA = [...ARTICLES_ES, "que", "se", "no", "me", "te", "lo", "le", "y"];

/** Punctuation said out loud, the longest first. */
export const SPOKEN: readonly Spoken[] = [
  { words: ["punto", "y", "coma"], mark: ";" },
  { words: ["new", "paragraph"], mark: "\n\n", notAfter: ARTICLES_EN },
  { words: ["nuevo", "párrafo"], mark: "\n\n", notAfter: ARTICLES_ES },
  { words: ["nuevo", "parrafo"], mark: "\n\n", notAfter: ARTICLES_ES },
  { words: ["new", "line"], mark: "\n", notAfter: ARTICLES_EN },
  { words: ["nueva", "línea"], mark: "\n", notAfter: ARTICLES_ES },
  { words: ["nueva", "linea"], mark: "\n", notAfter: ARTICLES_ES },
  { words: ["question", "mark"], mark: "?", notAfter: ARTICLES_EN },
  { words: ["exclamation", "mark"], mark: "!", notAfter: ARTICLES_EN },
  { words: ["full", "stop"], mark: ".", notAfter: ARTICLES_EN, closes: true },
  { words: ["comma"], mark: ",", notAfter: [...ARTICLES_EN, "oxford"] },
  { words: ["coma"], mark: ",", notAfter: NOT_A_COMMA },
  { words: ["period"], mark: ".", notAfter: [...ARTICLES_EN, "trial", "time", "grace"], closes: true },
  { words: ["punto"], mark: ".", notAfter: ARTICLES_ES, closes: true },
];

/** A change of mind: what came before it in the sentence is taken back. */
export const CHANGES_OF_MIND: readonly (readonly string[])[] = [
  ["no", "wait"],
  ["scratch", "that"],
  ["no", "perdón"],
  ["no", "perdon"],
];

const NUMBERS = new Set(
  (
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen " +
    "twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion half quarter first second third " +
    "cero uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciséis diecisiete dieciocho diecinueve " +
    "veinte treinta cuarenta cincuenta sesenta setenta ochenta noventa cien ciento mil millón millones medio"
  ).split(" "),
);

const NEGATIONS = new Set(
  "not no never none nor neither nothing nobody without cannot nunca ni sin jamás tampoco nada nadie ningún ninguno ninguna".split(" "),
);

/** A number, in digits or in words. */
export const isNumber = (word: string): boolean => /\d/.test(word) || NUMBERS.has(word);

/** A word that turns a sentence around: "not", "no", "never", "don't". */
export const isNegation = (word: string): boolean => NEGATIONS.has(word) || /n['’]t$/.test(word);

/** Every word tidying may take out by a rule (a change of mind's are named apart). */
export const DROPPABLE: ReadonlySet<string> = new Set([...FILLERS, ...SET_OFF_FILLERS.flat(), ...SPOKEN.flatMap((spoken) => spoken.words)]);
