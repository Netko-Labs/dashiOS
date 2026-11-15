//! The common words of English and Spanish, as an assistant and the person
//! talking to it use them. `*_GLUE` holds sentences together and weighs
//! double. A word that is common in two languages ("no", "me", "a") is in
//! both lists, so it tells neither apart.

pub(super) const ENGLISH_GLUE: &str = "
the and is are was were of to you your it this that with for have will would can what which
not from there here they we my be been do does did at by but if an as on or a no me he has
so in";

pub(super) const ENGLISH: &str = "
open opened opening close closed found find want wants wanted need needs done sent sure okay
please thanks thank yes yeah hello hi hey sorry now then when where who why how all any some
more most one two three four five six seven eight nine ten first next last new file files
folder window page should could about just like know think see look go going get got make
made take put say said tell show let let's right left up down out into over after before
again also only very well good great today tomorrow yesterday time day week month year
minutes hours meeting email message call don't can't won't it's that's there's i'll i've
i'm i'd didn't doesn't isn't aren't wasn't couldn't wouldn't shouldn't you're you'll you've
we're we'll they're what's here's him her his their them us our too than these those being
had may might must still already yet nothing something anything everything because while
without between through both each other another much many few little long back way thing
things work working try trying use using set turn turned play playing stop start save saved
delete deleted search searching download downloads downloaded screen computer ready off she
its am got gonna wanna actually basically really maybe anyway though always never ever
sometimes instead once red come comes came give gave keep kept mean means meant talk talking
speak speaking voice word words sentence language sounds sound nice cool stuff kind sort lot
bit pretty quite enough different same every own best better worse big small old high low
update updated install installed settings change changed changes add added remove removed
check checked move moved copy copied paste send sending read reading write writing type
click press hold wait waiting running run ran finished failed error problem question answer
help name names list item items note notes song songs music video videos photo photos
picture link site web browser tab tabs desktop app apps battery volume wifi network
calendar reminder timer alarm weather morning afternoon evening night tonight weekend
monday tuesday wednesday thursday friday saturday sunday";

pub(super) const SPANISH_GLUE: &str = "
el la los las una unos unas de del que y es en por para con se su sus lo le les al como pero
más está están estoy esto este esta eso ese esa hay muy tu tú mi te nos yo él ella ellos qué
sí ya también cuando donde dónde porque sin sobre entre hasta desde un a no me he has o";

pub(super) const SPANISH: &str = "
si tiene tienen tengo tienes quiero quieres quiere queremos puedo puedes puede pueden ser soy
eres somos son fue era ha han hacer hago haz hice hecho hace listo lista bien bueno buena
buenos buenas hola gracias favor ahora hoy mañana ayer aquí ahí allí allá acá entonces luego
después antes siempre nunca nada algo todo todos toda todas otro otra otros mismo misma cada
mucho mucha muchos poco uno dos tres cuatro cinco seis siete ocho nueve diez abre abrir abrí
abro abierto cierra cerrar cerré busca buscar busqué encontré encontrado encuentro dime dame
pon poner puse puesto ve ver veo ir voy vamos va van ven mira oye quita quitar guarda
guardar guardé guardado borra borrar borré manda mandar mandé envía enviar envié enviado
escribe escribir lee leer carpeta carpetas archivo archivos ventana ventanas página pantalla
descargas descarga descargar correo correos mensaje mensajes reunión día días semana mes
año hora horas minutos minuto tiempo vez veces cosa cosas nombre nuevo nueva primero primera
último siguiente vale claro perdón necesito necesitas necesita sé sabes sabe creo digo dice
dijo decir dije pues sea era eran estaba estás estamos estar fui ido tenía hay había será
sería puedes podría quisiera gustaría mejor peor grande pequeño igual tal vez quizá quizás
aunque mientras durante según contra hacia cual cuál quien quién cómo cuándo cuánto cuánta
cuántos mío tuyo suyo nuestro nuestra mis tus esos esas estos estas aquel algún alguna
ningún ninguna ninguno nadie alguien tan tanto además todavía aún casi solo sólo así ojalá
dale parce listo bueno entiendo entiendes funciona funcionó falló error problema pregunta
respuesta ayuda canción canciones música foto fotos enlace sitio navegador pestaña
escritorio aplicación batería volumen red calendario recordatorio alarma clima tarde noche
fin lunes martes miércoles jueves viernes sábado domingo hablar habla hablo hablando voz
palabra palabras frase idioma inglés español suena decirlo dicho digamos cambiar cambia
cambié agrega agregar pega copia mueve espera corre terminó terminé quedó queda falta";
