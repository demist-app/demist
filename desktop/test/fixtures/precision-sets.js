// The excerpts term detection is graded on, shared by term-precision.js
// (the current pipeline) and define-precision.js (candidates-first).
const MUNDANE = [
  ['raspberry', 'Oh, did you put the raspberry ones in the bag and said they were normal ones?'],
  ['goodbye', 'Yeah. Bye. See you later, take care.'],
  ['admin', 'The reading is chapter four and the tutorial is on Thursday, so please come prepared.'],
  ['smalltalk', 'I am going to use this one because the other one was a bit broken yesterday.'],
  ['weather', 'It is really cold outside today and I forgot my jacket again, which was silly of me.'],
  // Reported from a real session on the 'tiny' tier: it produced cards for
  // "five or six seconds" and "working out". Both are phrases made entirely of
  // ordinary words, which the filters could not catch at all until they were
  // made phrase-aware (see common-words.js).
  ['timing', 'Just give it five or six seconds and then it should settle down on its own.'],
  ['workingout', 'So we are working out how many of these we need before the end of the week.'],
]

// Two sentences each, which is the shape of a real detection chunk. A single
// terse sentence is NOT representative: the same ML excerpt cut to one line
// returned nothing while the two-line version returned "Prior" and "Loss
// function", so short fixtures test the model's tolerance for fragments
// rather than the behaviour this suite is meant to pin down.
const TECHNICAL = [
  ['biology', 'Chemiosmosis drives ATP synthase using the proton motive force across the inner mitochondrial membrane. This gradient is what actually couples respiration to ATP production.', 'Biology'],
  ['ml', 'Today we look at Bayesian ridge regularization. The prior acts as a penalty term in the loss function, which shrinks the coefficients toward zero and controls overfitting.', 'Machine Learning'],
  ['networks', 'Packet switching means each datagram is routed independently. Because of that the network adapter may receive them out of order, and the transport layer has to reassemble them.', 'Computer Science'],
  ['econ', 'A Giffen good violates the law of demand. That happens because the income effect outweighs the substitution effect, so demand rises as the price rises.', 'Economics'],
  ['chem', 'The enthalpy change of the reaction is measured by calorimetry. The activation energy determines the reaction rate, which is why a catalyst speeds things up.', 'Chemistry'],
]
// Mis-transcribed jargon (2026-10-18). These SOUND technical, so extraction
// proposes them; the verification pass exists to drop them. None may come
// back. Taken from the 2026-09 production audit. Added alongside the fix for
// verification rejecting EVERY term on the small tier: the suite had no case
// for what verification is for, so "reject everything" passed it.
const GARBLED = [
  ['purkinje', 'The impulse then spreads through the Patriarchs fibres to the ventricles, which contract together.', 'Medicine', 'patriarchs'],
  ['sanode', 'Every heartbeat begins in the S-mode, which is the natural pacemaker of the heart.', 'Medicine', 's-mode'],
  ['depolar', 'This is called spontaneous dechloridation and it is what drives the pacemaker potential.', 'Medicine', 'dechloridation'],
]

module.exports = { MUNDANE, TECHNICAL, GARBLED }
