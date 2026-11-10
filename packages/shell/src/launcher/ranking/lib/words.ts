/**
 * Dashi's own words in the languages Setup offers first, so a person who
 * speaks German finds Displays by "Bildschirm" and Sound by "Lautstärke".
 * Keyed by the item's id: a Settings pane by its pane id
 * (`dev.dashi.settings/<pane>`), an app by its app id. They are keywords:
 * the English names and words still match. Accents are kept here as people
 * write them; the ranking folds them ("ecran" finds "écran").
 */

import { SETTINGS_APP_ID } from "../../../apps.ts";

type Words = Readonly<Record<string, readonly string[]>>;

const pane = (id: string): string => `${SETTINGS_APP_ID}/${id}`;

const DE: Words = {
  [pane("appearance")]: ["Erscheinungsbild", "Dunkelmodus", "dunkler Modus", "Akzentfarbe"],
  [pane("wallpaper")]: ["Hintergrundbild", "Hintergrund"],
  [pane("displays")]: ["Bildschirm", "Monitor", "Auflösung", "Skalierung"],
  [pane("desktop-dock")]: ["Schreibtisch", "Arbeitsfläche", "Vollbild"],
  [pane("network")]: ["Netzwerk", "WLAN", "Internet"],
  [pane("sound")]: ["Ton", "Lautstärke", "Lautsprecher", "Mikrofon"],
  [pane("battery")]: ["Batterie", "Akku", "Energie", "Stromsparmodus"],
  [pane("keyboard")]: ["Tastatur", "Tastaturbelegung", "Tastenkürzel"],
  [pane("mouse")]: ["Maus", "Zeiger"],
  [pane("date-time")]: ["Datum", "Uhrzeit", "Uhr", "Zeitzone"],
  [pane("language-region")]: ["Sprache", "Region", "Formate"],
  [pane("lock-screen")]: ["Sperrbildschirm", "sperren", "Bildschirmschoner"],
  [pane("users")]: ["Benutzer", "Konto", "Passwort"],
  [pane("notifications")]: ["Mitteilungen", "Benachrichtigungen", "Nicht stören"],
  [pane("passwords")]: ["Passwörter", "Kennwörter"],
  [pane("about")]: ["Über", "Info", "Systeminformationen"],
  "dev.dashi.files": ["Dateien", "Dateimanager", "Ordner"],
  "dev.dashi.notes": ["Notizen"],
  "dev.dashi.calculator": ["Rechner", "Taschenrechner"],
  "dev.dashi.calendar": ["Kalender", "Termine"],
  "dev.dashi.editor": ["Texteditor"],
  "dev.dashi.software": ["Programme", "Apps installieren"],
  "dev.dashi.activity-monitor": ["Aktivitätsanzeige", "Prozesse"],
  "dev.dashi.preview": ["Vorschau", "Bilder"],
};

const FR: Words = {
  [pane("appearance")]: ["Apparence", "mode sombre", "thème", "couleur d'accentuation"],
  [pane("wallpaper")]: ["Fond d'écran", "arrière-plan"],
  [pane("displays")]: ["Écran", "Écrans", "moniteur", "résolution"],
  [pane("desktop-dock")]: ["Bureau", "plein écran"],
  [pane("network")]: ["Réseau", "Internet"],
  [pane("sound")]: ["Son", "volume", "haut-parleurs", "micro"],
  [pane("battery")]: ["Batterie", "énergie", "économie d'énergie"],
  [pane("keyboard")]: ["Clavier", "disposition", "raccourcis"],
  [pane("mouse")]: ["Souris", "pointeur"],
  [pane("trackpad")]: ["pavé tactile"],
  [pane("date-time")]: ["Date", "heure", "horloge", "fuseau horaire"],
  [pane("language-region")]: ["Langue", "région", "formats"],
  [pane("lock-screen")]: ["Écran de verrouillage", "verrouiller", "économiseur d'écran"],
  [pane("users")]: ["Utilisateurs", "compte", "mot de passe"],
  [pane("notifications")]: ["Notifications", "ne pas déranger"],
  [pane("passwords")]: ["Mots de passe"],
  [pane("about")]: ["À propos", "informations système"],
  "dev.dashi.files": ["Fichiers", "gestionnaire de fichiers", "dossier"],
  "dev.dashi.notes": ["Notes"],
  "dev.dashi.calculator": ["Calculatrice"],
  "dev.dashi.calendar": ["Calendrier", "agenda"],
  "dev.dashi.editor": ["Éditeur de texte"],
  "dev.dashi.software": ["Logiciels", "installer"],
  "dev.dashi.activity-monitor": ["Moniteur d'activité", "processus"],
  "dev.dashi.preview": ["Aperçu", "images"],
};

const ES: Words = {
  [pane("appearance")]: ["Apariencia", "modo oscuro", "tema"],
  [pane("wallpaper")]: ["Fondo de pantalla", "fondo"],
  [pane("displays")]: ["Pantalla", "Pantallas", "monitor", "resolución"],
  [pane("desktop-dock")]: ["Escritorio", "pantalla completa"],
  [pane("network")]: ["Red", "Internet"],
  [pane("sound")]: ["Sonido", "volumen", "altavoces", "micrófono"],
  [pane("battery")]: ["Batería", "energía", "ahorro de energía"],
  [pane("keyboard")]: ["Teclado", "distribución", "atajos"],
  [pane("mouse")]: ["Ratón", "puntero"],
  [pane("date-time")]: ["Fecha", "hora", "reloj", "zona horaria"],
  [pane("language-region")]: ["Idioma", "región", "formatos"],
  [pane("lock-screen")]: ["Pantalla de bloqueo", "bloquear"],
  [pane("users")]: ["Usuarios", "cuenta", "contraseña"],
  [pane("notifications")]: ["Notificaciones", "no molestar"],
  [pane("passwords")]: ["Contraseñas"],
  [pane("about")]: ["Acerca de", "información del sistema"],
  "dev.dashi.files": ["Archivos", "gestor de archivos", "carpeta"],
  "dev.dashi.notes": ["Notas"],
  "dev.dashi.calculator": ["Calculadora"],
  "dev.dashi.calendar": ["Calendario"],
  "dev.dashi.editor": ["Editor de texto"],
  "dev.dashi.software": ["Programas", "instalar"],
  "dev.dashi.activity-monitor": ["Monitor de actividad", "procesos"],
  "dev.dashi.preview": ["Vista previa", "imágenes"],
};

const IT: Words = {
  [pane("appearance")]: ["Aspetto", "modalità scura", "tema"],
  [pane("wallpaper")]: ["Sfondo"],
  [pane("displays")]: ["Schermo", "Monitor", "risoluzione"],
  [pane("desktop-dock")]: ["Scrivania", "schermo intero"],
  [pane("network")]: ["Rete", "Internet"],
  [pane("sound")]: ["Suono", "volume", "altoparlanti", "microfono"],
  [pane("battery")]: ["Batteria", "energia", "risparmio energetico"],
  [pane("keyboard")]: ["Tastiera", "scorciatoie"],
  [pane("mouse")]: ["puntatore"],
  [pane("date-time")]: ["Data", "ora", "orologio", "fuso orario"],
  [pane("language-region")]: ["Lingua", "regione", "formati"],
  [pane("lock-screen")]: ["Schermata di blocco", "blocca"],
  [pane("users")]: ["Utenti", "account", "password"],
  [pane("notifications")]: ["Notifiche", "non disturbare"],
  [pane("about")]: ["Informazioni", "informazioni di sistema"],
  "dev.dashi.files": ["File", "gestore file", "cartella"],
  "dev.dashi.notes": ["Note"],
  "dev.dashi.calculator": ["Calcolatrice"],
  "dev.dashi.calendar": ["Calendario"],
  "dev.dashi.editor": ["Editor di testo"],
  "dev.dashi.software": ["Programmi", "installa"],
  "dev.dashi.activity-monitor": ["Monitoraggio attività", "processi"],
  "dev.dashi.preview": ["Anteprima", "immagini"],
};

const PT: Words = {
  [pane("appearance")]: ["Aparência", "modo escuro", "tema"],
  [pane("wallpaper")]: ["Papel de parede", "fundo"],
  [pane("displays")]: ["Tela", "Ecrã", "monitor", "resolução"],
  [pane("desktop-dock")]: ["Área de trabalho", "ecrã inteiro", "tela cheia"],
  [pane("network")]: ["Rede", "Internet"],
  [pane("sound")]: ["Som", "volume", "alto-falantes", "microfone"],
  [pane("battery")]: ["Bateria", "energia", "economia de energia"],
  [pane("keyboard")]: ["Teclado", "atalhos"],
  [pane("mouse")]: ["Rato", "ponteiro"],
  [pane("date-time")]: ["Data", "hora", "relógio", "fuso horário"],
  [pane("language-region")]: ["Idioma", "região", "formatos"],
  [pane("lock-screen")]: ["Tela de bloqueio", "bloquear"],
  [pane("users")]: ["Usuários", "Utilizadores", "conta", "senha"],
  [pane("notifications")]: ["Notificações", "não perturbe"],
  [pane("passwords")]: ["Senhas", "Palavras-passe"],
  [pane("about")]: ["Sobre", "informações do sistema"],
  "dev.dashi.files": ["Arquivos", "Ficheiros", "pasta"],
  "dev.dashi.notes": ["Notas"],
  "dev.dashi.calculator": ["Calculadora"],
  "dev.dashi.calendar": ["Calendário"],
  "dev.dashi.editor": ["Editor de texto"],
  "dev.dashi.software": ["Programas", "instalar"],
  "dev.dashi.activity-monitor": ["Monitor de atividade", "processos"],
  "dev.dashi.preview": ["Pré-visualização", "imagens"],
};

const NL: Words = {
  [pane("appearance")]: ["Weergave", "donkere modus", "thema"],
  [pane("wallpaper")]: ["Achtergrond", "bureaubladachtergrond"],
  [pane("displays")]: ["Beeldscherm", "scherm", "resolutie"],
  [pane("desktop-dock")]: ["Bureaublad", "volledig scherm"],
  [pane("network")]: ["Netwerk", "Internet"],
  [pane("sound")]: ["Geluid", "volume", "luidsprekers", "microfoon"],
  [pane("battery")]: ["Batterij", "energie", "energiebesparing"],
  [pane("keyboard")]: ["Toetsenbord", "sneltoetsen"],
  [pane("mouse")]: ["Muis", "aanwijzer"],
  [pane("date-time")]: ["Datum", "tijd", "klok", "tijdzone"],
  [pane("language-region")]: ["Taal", "regio", "notatie"],
  [pane("lock-screen")]: ["Vergrendelscherm", "vergrendelen"],
  [pane("users")]: ["Gebruikers", "account", "wachtwoord"],
  [pane("notifications")]: ["Meldingen", "niet storen"],
  [pane("passwords")]: ["Wachtwoorden"],
  [pane("about")]: ["Over", "systeeminformatie"],
  "dev.dashi.files": ["Bestanden", "bestandsbeheer", "map"],
  "dev.dashi.notes": ["Notities"],
  "dev.dashi.calculator": ["Rekenmachine"],
  "dev.dashi.calendar": ["Agenda", "kalender"],
  "dev.dashi.editor": ["Teksteditor"],
  "dev.dashi.software": ["Programma's", "installeren"],
  "dev.dashi.activity-monitor": ["Activiteitenweergave", "processen"],
  "dev.dashi.preview": ["Voorvertoning", "afbeeldingen"],
};

const WORDS: Readonly<Record<string, Words>> = { de: DE, fr: FR, es: ES, it: IT, pt: PT, nl: NL };

/** Dashi's words for `id` in `languages` (languagesOf), best language first. */
export function dashiWords(id: string, languages: readonly string[]): string[] {
  return languages.flatMap((language) => WORDS[language]?.[id] ?? []);
}
