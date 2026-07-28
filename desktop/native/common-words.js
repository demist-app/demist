// desktop/native/common-words.js
// Everyday English used as a precision filter for term detection.
//
// The small on-device models reliably FIND jargon (measured: 5/5 technical
// excerpts produced correct terms) but are bad at declining ordinary speech
// (measured: 5/5 mundane excerpts produced cards, including "raspberry" from
// "did you put the raspberry ones in the bag", "bye" from a goodbye, and
// "cold"/"jacket" from a remark about the weather). Prompt wording alone did
// not fix it; a 1.5-3B model simply is not a reliable judge of "would a
// student need this explained".
//
// This list is applied ONLY to single-word terms. Multi-word terms pass
// untouched, because "proton motive force", "Giffen good" and "loss function"
// are unambiguous jargon and no everyday phrase survives the model's own
// filtering to reach here. That distinction is what keeps genuine one-word
// jargon - chemiosmosis, datagram, enthalpy, calorimetry - working: none of
// them are everyday words, so none of them are in here.
//
// Deliberately NOT a frequency list of the top N words. Several of the most
// frequent words in English are also real technical terms in some subject
// (current, work, field, power, force, energy, mass, charge, wave, function,
// set, group, ring, order, class, matrix). Those are omitted on purpose: a
// physics lecture saying "current" or a maths lecture saying "ring" must
// still be able to produce a card. What is listed here is everyday
// vocabulary that is essentially never the subject of a lecture explanation.
const COMMON_WORDS = new Set([
  // function words and pronouns
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'cannot', 'could', 'did', 'do', 'does', 'doing', 'down', 'during',
  'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers',
  'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself',
  'just', 'me', 'more', 'most', 'my', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only',
  'or', 'other', 'ought', 'our', 'ours', 'out', 'over', 'own',
  'same', 'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them',
  'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up',
  'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why',
  'will', 'with', 'would', 'you', 'your', 'yours',
  // greetings, discourse, filler
  'hello', 'hi', 'hey', 'bye', 'goodbye', 'yes', 'yeah', 'yep', 'no', 'nope', 'okay', 'ok',
  'please', 'thanks', 'thank', 'sorry', 'welcome', 'right', 'well', 'anyway', 'actually',
  'basically', 'obviously', 'literally', 'really', 'maybe', 'perhaps', 'sure', 'fine',
  'alright', 'cheers', 'oh', 'ah', 'um', 'uh', 'hmm', 'yay', 'wow', 'oops',
  'morning', 'afternoon', 'evening', 'night', 'today', 'tomorrow', 'yesterday', 'later', 'soon',
  // everyday verbs
  'go', 'going', 'went', 'gone', 'come', 'came', 'get', 'got', 'give', 'gave', 'take', 'took',
  'make', 'made', 'put', 'say', 'said', 'tell', 'told', 'ask', 'asked', 'know', 'knew', 'think',
  'thought', 'see', 'saw', 'look', 'looked', 'want', 'wanted', 'need', 'needed', 'try', 'tried',
  'use', 'used', 'find', 'found', 'worked', 'call', 'called', 'feel', 'felt', 'seem',
  'leave', 'left', 'keep', 'kept', 'let', 'begin', 'began', 'start', 'started', 'stop', 'stopped',
  'help', 'helped', 'talk', 'talked', 'turn', 'turned', 'show', 'showed', 'hear', 'heard',
  'play', 'played', 'run', 'ran', 'move', 'moved', 'live', 'lived', 'believe', 'hold', 'held',
  'bring', 'brought', 'happen', 'happened', 'write', 'wrote', 'sit', 'sat', 'stand', 'stood',
  'lose', 'lost', 'pay', 'paid', 'meet', 'met', 'send', 'sent', 'expect', 'build', 'built',
  'stay', 'stayed', 'fall', 'fell', 'cut', 'reach', 'kill', 'remain', 'buy', 'bought', 'eat',
  'ate', 'drink', 'drank', 'sleep', 'slept', 'walk', 'walked', 'wear', 'wore', 'open', 'opened',
  'close', 'closed', 'forget', 'forgot', 'remember', 'wait', 'waited', 'watch', 'watched',
  'read', 'listen', 'learn', 'teach', 'taught', 'prepare', 'prepared', 'break', 'broke', 'broken',
  'fix', 'fixed', 'check', 'checked', 'pick', 'picked', 'carry', 'carried', 'drop', 'dropped',
  // everyday adjectives
  'good', 'bad', 'big', 'small', 'large', 'little', 'long', 'short', 'high', 'low', 'old', 'young',
  'new', 'first', 'last', 'next', 'early', 'late', 'easy', 'hard', 'difficult', 'simple',
  'different', 'important', 'nice', 'lovely', 'great', 'terrible', 'awful', 'wonderful',
  'happy', 'sad', 'angry', 'tired', 'busy', 'free', 'ready', 'sure', 'true', 'false',
  'hot', 'cold', 'warm', 'cool', 'wet', 'dry', 'clean', 'dirty', 'full', 'empty', 'heavy',
  'light', 'fast', 'slow', 'quick', 'loud', 'quiet', 'strong', 'weak', 'silly', 'funny',
  'normal', 'strange', 'weird', 'boring', 'interesting', 'beautiful', 'ugly', 'rich', 'poor',
  'sick', 'ill', 'healthy', 'safe', 'dangerous', 'possible', 'impossible', 'real', 'fake',
  // colours
  'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown', 'black', 'white', 'grey', 'gray',
  // food and drink
  'food', 'drink', 'water', 'coffee', 'tea', 'milk', 'juice', 'beer', 'wine', 'bread', 'butter',
  'cheese', 'egg', 'eggs', 'meat', 'chicken', 'beef', 'pork', 'fish', 'rice', 'pasta', 'noodles',
  'soup', 'salad', 'sandwich', 'burger', 'pizza', 'cake', 'biscuit', 'cookie', 'chocolate',
  'sugar', 'salt', 'pepper', 'fruit', 'apple', 'banana', 'orange', 'grape', 'grapes', 'berry',
  'berries', 'strawberry', 'raspberry', 'blueberry', 'blackberry', 'lemon', 'lime', 'peach',
  'pear', 'cherry', 'melon', 'mango', 'pineapple', 'vegetable', 'potato', 'tomato', 'carrot',
  'onion', 'garlic', 'lettuce', 'breakfast', 'lunch', 'dinner', 'snack', 'meal', 'restaurant',
  // clothing and household
  'clothes', 'shirt', 'tshirt', 'trousers', 'pants', 'jeans', 'dress', 'skirt', 'jacket', 'coat',
  'jumper', 'sweater', 'hoodie', 'shoe', 'shoes', 'boot', 'boots', 'sock', 'socks', 'hat', 'cap',
  'scarf', 'glove', 'gloves', 'bag', 'backpack', 'wallet', 'purse', 'umbrella',
  'house', 'home', 'flat', 'apartment', 'room', 'kitchen', 'bathroom', 'bedroom', 'door', 'window',
  'wall', 'floor', 'ceiling', 'roof', 'table', 'chair', 'desk', 'bed', 'sofa', 'couch', 'lamp',
  'cup', 'mug', 'glass', 'plate', 'bowl', 'fork', 'knife', 'spoon', 'bottle', 'box', 'key', 'keys',
  // people, places, time
  'person', 'people', 'man', 'woman', 'boy', 'girl', 'child', 'children', 'kid', 'kids', 'baby',
  'friend', 'friends', 'family', 'mother', 'father', 'mum', 'dad', 'parent', 'parents', 'brother',
  'sister', 'son', 'daughter', 'wife', 'husband', 'guy', 'guys', 'everyone', 'someone', 'anyone',
  'nobody', 'somebody', 'everybody', 'name', 'names',
  'city', 'town', 'village', 'country', 'street', 'road', 'shop', 'store', 'market', 'park',
  'school', 'university', 'college', 'campus', 'library', 'office', 'building', 'place', 'area',
  'car', 'bus', 'train', 'bike', 'taxi', 'plane', 'station', 'airport',
  'day', 'days', 'week', 'weeks', 'month', 'months', 'year', 'years', 'hour', 'hours', 'minute',
  'minutes', 'second', 'seconds', 'time', 'times', 'monday', 'tuesday', 'wednesday', 'thursday',
  'friday', 'saturday', 'sunday', 'weekend', 'january', 'february', 'march', 'april', 'may',
  'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'spring', 'summer', 'autumn', 'winter', 'weather', 'rain', 'snow', 'sun', 'wind', 'cloud',
  // numbers and quantity
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'twenty', 'thirty', 'fifty', 'hundred', 'thousand', 'million', 'half', 'quarter',
  'lot', 'lots', 'many', 'much', 'more', 'less', 'least', 'enough', 'part', 'piece', 'bit',
  'thing', 'things', 'stuff', 'way', 'ways', 'kind', 'sort', 'type', 'side', 'end', 'top',
  'bottom', 'back', 'front', 'middle', 'beginning', 'number', 'numbers',
  // generic body / everyday nouns
  'head', 'hand', 'hands', 'foot', 'feet', 'eye', 'eyes', 'ear', 'ears', 'mouth', 'nose', 'hair',
  'face', 'arm', 'leg', 'body', 'phone', 'computer', 'laptop', 'screen', 'email', 'message',
  'word', 'words', 'book', 'books', 'page', 'paper', 'pen', 'pencil', 'picture', 'photo', 'video',
  'music', 'song', 'film', 'movie', 'game', 'games', 'money', 'price', 'cost', 'job',
  'idea', 'ideas', 'problem', 'question', 'answer', 'story', 'news', 'life', 'world', 'point',
])

// A term is filtered only when it is a SINGLE everyday word. Multi-word terms
// are left alone: the model does not invent everyday phrases here, and real
// jargon is very often multi-word.
function isEverydayWord(term) {
  const t = String(term).trim().toLowerCase().replace(/[.,!?;:'"]+$/g, '')
  if (!t || /\s/.test(t)) return false
  if (COMMON_WORDS.has(t)) return true
  // Plurals of listed words ("ones", "jackets", "berries").
  if (t.endsWith('s') && COMMON_WORDS.has(t.slice(0, -1))) return true
  if (t.endsWith('es') && COMMON_WORDS.has(t.slice(0, -2))) return true
  if (t.endsWith('ies') && COMMON_WORDS.has(`${t.slice(0, -3)}y`)) return true
  return false
}

module.exports = { COMMON_WORDS, isEverydayWord }
