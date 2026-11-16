import { withPauses, gate } from "../../../src/dictation/lib/gate.ts";
for (const t of ["Mándale el archivo a Marcos, no perdón a Lucía.", "Mándale el archivo a Marcos, no perdon a Lucía.", "Nos vemos a las cinco, no digo a las seis."]) console.log(withPauses(t));
