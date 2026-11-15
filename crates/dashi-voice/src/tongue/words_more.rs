//! The common words of French, Italian and Portuguese: shorter lists, for
//! the languages a person turns on beside their own.

pub(super) const FRENCH_GLUE: &str = "
le la les un une des du de et est en dans pour avec sur pas ne que qui je tu il elle nous
vous ils ce cette ces au aux mais ou où très plus c'est j'ai sont suis";

pub(super) const FRENCH: &str = "
mon ma mes ton votre son sa ses donc bien oui non merci bonjour salut voilà ai as a avez
avons ont es sommes êtes fait faire peux peut veux veut voulez dossier fichier fichiers
ouvrir ouvre ouvert trouvé aujourd'hui demain hier maintenant ici là quand comment pourquoi
parce si tout tous toute rien quelque chose aussi encore déjà alors puis après avant être
avoir été y on se me te lui leur fenêtre écran prêt terminé envoyé fermer ferme cherche
chercher deux trois quatre cinq six sept huit neuf dix jour semaine mois année heure heures
minutes temps nouveau nouvelle premier dernier besoin voulez pouvez dites moi toi";

pub(super) const ITALIAN_GLUE: &str = "
il lo la gli le un uno una di del della dei delle e è in nel nella per con su non che chi io
tu lui lei noi voi loro questo questa sono c'è";

pub(super) const ITALIAN: &str = "
i mi ti ci si quello quella mio tuo suo ma o se come quando dove perché più molto bene sì no
grazie ciao buongiorno prego ho hai ha abbiamo avete hanno sei siamo fatto fare posso puoi
può voglio vuoi vuole cartella apri aprire aperto trovato oggi domani ieri adesso ora qui lì
tutto tutti niente qualcosa anche ancora già allora poi dopo prima essere avere stato da dal
al alla ai sul ecco cosa finestra schermo pronto finito inviato chiudi chiudere cerca cercare
due tre quattro cinque sei sette otto nove dieci giorno settimana mese anno ore minuti tempo
nuovo nuova primo ultimo bisogno dimmi me te a";

pub(super) const PORTUGUESE_GLUE: &str = "
o a os as um uma de do da dos das em no na nos nas e é para por com não que eu você ele ela
isso isto está são mais mas muito também já";

pub(super) const PORTUGUESE: &str = "
estou tem tenho foi aqui agora obrigado obrigada olá sim sem ou quando onde porque como pelo
pela ao à às seu sua meu minha vou vai pode posso quer quero fazer feito pronto arquivo
arquivos pasta abrir abre aberto achei encontrei bom boa dia hoje amanhã ontem tudo todos
nada algo ainda então depois antes ser ter estar me te se lhe janela tela terminado enviado
fechar fecha procurar procura dois três quatro cinco seis sete oito nove dez semana mês ano
hora horas minutos tempo novo nova primeiro último preciso diga";
