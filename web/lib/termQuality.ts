// Precision gate for detected terms, applied in the renderer so it covers BOTH
// detection paths at once: the cloud detect-terms function and the on-device
// model in desktop/native/llm.js. That placement is deliberate. llm.js ships
// inside the AppX, so a fix there reaches nobody until the next Store build,
// while the renderer is served from demist.app and updates the moment it
// deploys, including inside desktop apps already installed.
//
// WHY THIS EXISTS. An audit of all 692 terms in production on 2026-09-20 found
// roughly one in seven was worth having. The rest were:
//
//   ordinary words   toothpaste, toilet, puppy, beach, rubbish, eyebrows,
//                    disco, camera, chat, party, surveillance, presentation
//   fragments        sy, sis, ials, orum
//   ASR garble       bleaboo, kachiro, Pay-a-doo, Polysophagoras, Epikartic
//
// Both prompts already instruct the model to "silently drop anything that
// isn't a real technical term", and both models ignore it: a 1.5B on-device
// model cannot reliably judge "would a student need this explained", and
// gpt-4o-mini, handed a list a device has already labelled "possible technical
// terms", treats its job as defining them rather than refusing them. Asking
// more politely is not a fix. This is the deterministic backstop.
//
// It does not catch ASR garble (see isPlausibleTerm) - a mis-heard word is
// still a word-shaped string, and detecting that "Epikartic" is not a real
// term needs a dictionary this does not have.

// Everyday vocabulary that is essentially never the subject of a lecture
// explanation. Concrete nouns, domestic objects, food, animals, clothing,
// weather, everyday verbs and adjectives.
//
// Deliberately NOT a top-N frequency list: several of the commonest words in
// English are real jargon somewhere (current in physics, ring in maths, charge
// in chemistry, function in programming), and a frequency cut would silently
// break exactly those lectures. Anything with a technical reading lives in
// TECHNICAL_HOMONYMS below and is never filtered.
const EVERYDAY = new Set<string>([
  // domestic objects and furniture
  'toothpaste','toothbrush','toilet','bathroom','kitchen','bedroom','sofa','couch','chair','table','desk',
  'bed','pillow','blanket','curtain','carpet','cupboard','drawer','shelf','mirror','lamp','candle','clock',
  'bottle','cup','mug','plate','bowl','spoon','fork','knife','kettle','fridge','freezer','oven','microwave',
  'towel','soap','shampoo','brush','comb','basket','bucket','broom','bin','rubbish','garbage','trash',
  'umbrella','wallet','purse','handbag','backpack','suitcase','luggage','ladder','hammer','scissors',
  // clothing
  'shirt','tshirt','trousers','pants','jeans','jacket','coat','jumper','sweater','hoodie','dress','skirt',
  'shoes','boots','trainers','sneakers','socks','gloves','scarf','hat','cap','belt','tie','pyjamas','uniform',
  // food and drink
  'breakfast','lunch','dinner','supper','snack','sandwich','burger','pizza','pasta','noodles','rice','bread',
  'butter','cheese','milk','yoghurt','egg','eggs','bacon','chicken','beef','pork','fish','soup','salad',
  'potato','potatoes','tomato','onion','garlic','carrot','apple','banana','orange','grape','strawberry',
  'raspberry','lemon','sugar','salt','pepper','chocolate','biscuit','cookie','cake','pudding','dessert',
  'coffee','tea','juice','water','beer','wine','soda','breakfast','takeaway','restaurant','cafe','menu',
  // animals
  'dog','puppy','cat','kitten','horse','cow','sheep','pig','goat','chicken','duck','rabbit','mouse','rat',
  'bird','fish','frog','snake','spider','bee','ant','butterfly','elephant','lion','tiger','bear','monkey',
  'whale','dolphin','shark','penguin','pet','pets','animal','animals',
  // places and everyday nouns
  'beach','park','garden','forest','mountain','river','lake','ocean','island','village','town','city',
  'street','road','bridge','building','house','home','flat','apartment','hotel','airport','station','shop',
  'supermarket','market','hospital','church','museum','cinema','theatre','stadium','gym','pool','library',
  'bus','train','taxi','plane','bicycle','bike','boat','ship','truck','lorry',
  // body, everyday register only (clinical anatomy is not listed: see note)
  'eyebrows','eyelash','hair','beard','moustache','fingernail','toenail','tummy','belly',
  // weather, time, seasons
  'weather','rain','snow','sunshine','cloud','clouds','wind','storm','fog','summer','winter','autumn',
  'spring','morning','afternoon','evening','night','weekend','holiday','holidays','birthday','christmas',
  'monday','tuesday','wednesday','thursday','friday','saturday','sunday','yesterday','tomorrow',
  // people and social
  'family','mother','father','mum','dad','parent','parents','brother','sister','son','daughter','baby',
  'child','children','friend','friends','neighbour','stranger','guest','party','wedding','funeral',
  'boyfriend','girlfriend','husband','wife','teacher','student','doctor','nurse','driver','waiter',
  // everyday activities and verbs
  'walking','running','jogging','swimming','cooking','baking','cleaning','washing','shopping','sleeping',
  'eating','drinking','talking','laughing','crying','smiling','dancing','singing','shouting','whispering',
  'sitting','standing','waiting','driving','travelling','visiting','texting','calling','watching',
  'listening','reading','writing','playing','learning','teaching','helping','buying','selling','paying',
  // everyday adjectives
  'happy','sad','angry','tired','hungry','thirsty','bored','excited','nervous','lonely','lucky','busy',
  'easy','difficult','simple','hard','nice','lovely','horrible','awful','terrible','wonderful','boring',
  'interesting','funny','serious','quiet','loud','clean','dirty','empty','full','heavy','light','fast',
  'slow','early','late','young','modern','ancient','beautiful','ugly','pretty','handsome','strange','weird',
  'expensive','cheap','free','rich','poor','healthy','sick','safe','dangerous','careful','friendly',
  // colours
  'red','blue','green','yellow','orange','purple','pink','brown','black','white','grey','gray',
  // discourse, admin and generic process words that keep surfacing as cards
  'presentation','preferences','structured','surveillance','transformation','transportation','translation',
  'permission','definitions','decisions','paragraph','silhouette','salute','stitch','disco','camera',
  'playlists','bookend','handshake','toothpaste','eyebrow','scalp','conquest','incarceration','terrorist',
  'charity','empathy','exploration','institution','corporation','regulation','proficiencies','assessment',
])

// Words that are everyday English AND real jargon somewhere. Never filtered,
// because a physics lecture saying "current", a maths lecture saying "ring" or
// a programming lecture saying "class" must still be able to produce a card.
// If a word is in both sets, this one wins.
//
// "party" is deliberately NOT here despite being a real term in contract law.
// The legal sense is virtually always multi-word ("third party", "the parties
// to the agreement") and passes on that route, whereas a bare "party" in
// production was the social sense with the definition "a social gathering
// with food, drink, and entertainment" attached to a business lecture.
const TECHNICAL_HOMONYMS = new Set<string>([
  'current','work','field','power','force','energy','mass','charge','wave','function','set','group','ring',
  'order','class','matrix','field','base','acid','salt','solution','element','compound','bond','shell',
  'cell','tissue','organ','plate','stress','strain','moment','torque','resistance','capacity','volume',
  'pressure','density','velocity','momentum','frequency','amplitude','phase','period','medium','spectrum',
  'model','tree','graph','node','edge','stack','queue','heap','thread','process','kernel','buffer','cache',
  'market','capital','labour','labor','supply','demand','equity','bond','interest','yield','margin','asset',
  'liability','share','stock','trust','contract','tort','damages','consideration','remedy','estate',
  'plant','root','stem','leaf','crown','joint','canal','duct','valve','chamber','node','plexus','process',
])

// Below this, a lowercase string is a fragment rather than a word. Measured
// against the real failures: sy, sis, ials and orum are all four characters or
// fewer, and every genuine single-word term in production is longer.
//
// All-caps strings are exempt because acronyms are real terms and are short by
// nature: API, CDC, GMC, NPA, LLC, MSTP and FLOPS all appeared legitimately.
const MIN_TERM_LENGTH = 5

function looksLikeAcronym(term: string): boolean {
  return /^[A-Z][A-Z0-9.]{1,7}$/.test(term.replace(/\./g, '')) || /^[A-Z]{2,8}$/.test(term)
}

// Structural sanity only. This CANNOT tell a mis-transcription from a real
// term: "Epikartic" and "erythropoietic" are the same shape to a regex, and
// separating them needs a dictionary. It catches the shapes that are never
// words in any language rather than pretending to catch more.
function isPlausibleTerm(term: string): boolean {
  if (!/[aeiouy]/i.test(term)) return false          // no vowel at all
  if (/(.)\1{2,}/.test(term)) return false           // three identical letters running
  if (/^[^A-Za-z]/.test(term)) return false          // starts with punctuation or a digit
  return true
}

/**
 * True when a detected term is worth showing to a student.
 *
 * Multi-word terms pass unless every word is everyday vocabulary, because
 * "proton motive force" and "Giffen good" are unambiguous jargon while
 * "the reading" is not. Single words carry the burden of proof.
 */
export function isLikelyJargon(rawTerm: string): boolean {
  const term = rawTerm.trim()
  if (!term) return false

  // Acronyms are checked FIRST, before any structural rule. They are exempt
  // from both the length floor and the vowel rule: CDC, GMC and NPA are real
  // terms that appeared legitimately in production and contain no vowel at
  // all, so testing plausibility before this dropped every one of them.
  if (looksLikeAcronym(term)) return true

  if (!isPlausibleTerm(term)) return false

  const words = term.toLowerCase().split(/[\s-]+/).filter(Boolean)
  if (words.length === 0) return false

  if (words.length > 1) {
    // A multi-word phrase is junk only when nothing in it is technical.
    return !words.every(w => EVERYDAY.has(w) && !TECHNICAL_HOMONYMS.has(w))
  }

  const word = words[0]
  if (word.length < MIN_TERM_LENGTH) return false
  if (TECHNICAL_HOMONYMS.has(word)) return true
  if (EVERYDAY.has(word)) return false
  return true
}

/** Terms rejected by the gate, for the analytics event. */
export function rejectedTerms(terms: { term: string }[]): string[] {
  return terms.filter(t => !isLikelyJargon(t.term)).map(t => t.term)
}
