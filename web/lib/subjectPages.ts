// Subject landing pages: one indexable page per course, at /for/<slug>.
//
// WHY THESE EXIST. Every single answer to "how did you find us" so far has
// been `ai_assistant` (5 of 5 as of 2026-09-21), and Google organic started
// sending traffic on 2026-08-27. Asked to recommend a lecture tool, ChatGPT
// named Demist first and then offered: "tell me what you're studying and I
// can find one particularly good at your subject." That is the channel saying
// out loud what it wants. A generic page competes for one broad query; a page
// per subject competes for the narrow, high-intent ones, and gives an LLM
// something specific to quote.
//
// THE EXAMPLES ARE HAND-WRITTEN, NOT PULLED FROM `terms`. That was the
// original plan and it does not survive contact with the data: an audit on
// 2026-09-20 found roughly one term in seven worth having, and a raw pull for
// anatomy returned "Dark hand", "Bumble branches", "South Endocardial
// Computing Network" and "Wisconsin" alongside the real ones. The quality
// gates shipped since should fix that going forward, but marketing copy
// cannot wait on a clean table, and nothing here may be wrong: these pages
// are read by students deciding whether to trust the product and by models
// deciding whether to recommend it.
//
// Each `terms` entry is a real term from that subject with a definition
// written to be correct, at the level a first or second year would need.

export interface SubjectPage {
  slug: string
  /** Used in the <h1> and throughout the copy, e.g. "a nursing lecture". */
  subject: string
  /** How students describe themselves, e.g. "nursing students". */
  audience: string
  title: string
  description: string
  /** The specific pain, in that subject's language. Two sentences, no more. */
  problem: string
  terms: { term: string; definition: string }[]
  /** Answers a real objection that is particular to this subject. */
  note: { heading: string; body: string }
}

export const SUBJECT_PAGES: SubjectPage[] = [
  {
    slug: 'medicine',
    subject: 'medical',
    audience: 'medical students',
    title: 'Demist for medical students',
    description:
      'Demist listens to your medical lectures and explains the terminology as your lecturer says it, then builds a glossary and flashcards from what came up. Free, and the Windows app runs entirely on your own computer.',
    problem:
      'Medical lectures move at the speed of someone who already knows the vocabulary. Miss one term and the next ten minutes are built on something you did not catch.',
    terms: [
      { term: 'Purkinje fibres', definition: 'Specialised cardiac muscle fibres that carry the electrical impulse from the atrioventricular node through the ventricles, so both ventricles contract together.' },
      { term: 'Phagocytosis', definition: 'The process by which a cell such as a macrophage or neutrophil engulfs a particle or microorganism and digests it inside a vesicle.' },
      { term: 'Sarcoplasmic reticulum', definition: 'The calcium store inside a muscle cell; releasing that calcium is what triggers contraction, and pumping it back is what allows relaxation.' },
      { term: 'Erythropoietin', definition: 'A hormone released by the kidneys in response to low oxygen, which tells the bone marrow to produce more red blood cells.' },
      { term: 'Myocardium', definition: 'The muscular middle layer of the heart wall, between the endocardium and the epicardium, and the part that actually does the pumping.' },
    ],
    note: {
      heading: 'Recording in a clinical setting',
      body: 'Demist is for lectures, not for placements or patient contact. Nothing in it is designed to be used where a patient could be recorded, and your medical school will have its own rules on recording teaching. Check them before you record anything.',
    },
  },
  {
    slug: 'nursing',
    subject: 'nursing',
    audience: 'nursing students',
    title: 'Demist for nursing students',
    description:
      'Demist explains clinical terminology during your nursing lectures, as it is said, and turns it into a glossary and flashcards afterwards. Free, and the Windows app runs entirely on your own computer.',
    problem:
      'Nursing teaching mixes physiology, pharmacology and practice vocabulary in the same hour, often from a lecturer who uses the abbreviations as second nature. Writing a term down to look up later means missing the sentence that explained it.',
    terms: [
      { term: 'Oedema', definition: 'Swelling caused by excess fluid trapped in the body’s tissues, commonly in the legs, ankles and feet.' },
      { term: 'Tachycardia', definition: 'A resting heart rate above about 100 beats per minute in an adult.' },
      { term: 'Contraindication', definition: 'A specific reason a treatment or drug should not be used in a particular patient, because it would be likely to cause harm.' },
      { term: 'Titration', definition: 'Adjusting a drug dose gradually, up or down, against the patient’s response rather than giving a fixed amount.' },
      { term: 'Auscultation', definition: 'Listening to sounds inside the body, usually with a stethoscope, to assess the heart, lungs or bowel.' },
    ],
    note: {
      heading: 'Placements and patient confidentiality',
      body: 'Demist is built for lecture theatres and seminar rooms. Do not record on placement or anywhere a patient could be heard. That is a confidentiality issue long before it is a Demist one.',
    },
  },
  {
    slug: 'psychology',
    subject: 'psychology',
    audience: 'psychology students',
    title: 'Demist for psychology students',
    description:
      'Demist explains psychological and statistical terminology during your lectures, then builds a glossary and flashcards from it. Free, and the Windows app runs entirely on your own computer.',
    problem:
      'Psychology uses ordinary words in precise technical senses, and a lecturer rarely stops to flag which sense they mean. The statistics half of the degree then adds a second vocabulary on top.',
    terms: [
      { term: 'Effect size', definition: 'A measure of how large a difference or relationship is, independent of sample size, which a p-value on its own does not tell you.' },
      { term: 'Demand characteristics', definition: 'Cues in a study that let participants guess its purpose, so they change their behaviour to match what they think is expected.' },
      { term: 'Operationalisation', definition: 'Defining an abstract concept, such as anxiety, as something specific and measurable, such as a score on a named scale.' },
      { term: 'Confound', definition: 'A variable that varies alongside the one you are studying, so you cannot tell which of the two produced the result.' },
      { term: 'Ecological validity', definition: 'How well a finding obtained under study conditions holds up in the everyday settings it is meant to describe.' },
    ],
    note: {
      heading: 'Terms you already know are left alone',
      body: 'Psychology is full of everyday words used technically. Demist only flags terms it judges you are unlikely to know at your year of study, and will not interrupt a lecture to define "memory" or "behaviour".',
    },
  },
  {
    slug: 'law',
    subject: 'law',
    audience: 'law students',
    title: 'Demist for law students',
    description:
      'Demist explains legal terminology and case names during your lectures, then builds a glossary and flashcards from them. Free, and the Windows app runs entirely on your own computer.',
    problem:
      'A law lecturer will cite a case in three words and move on, assuming you know what it stands for. Latin terms arrive the same way, spoken once and never spelled.',
    terms: [
      { term: 'Ratio decidendi', definition: 'The part of a judgment that forms the binding legal rule: the reasoning essential to the decision, as opposed to remarks made in passing.' },
      { term: 'Obiter dicta', definition: 'Remarks in a judgment that are not essential to the decision, and so are persuasive but not binding on later courts.' },
      { term: 'Consideration', definition: 'Something of value exchanged by each side of a contract, which is what makes a promise enforceable in English law.' },
      { term: 'Vicarious liability', definition: 'When one party, typically an employer, is held legally responsible for a wrong committed by another, typically an employee acting in the course of their work.' },
      { term: 'Mens rea', definition: 'The mental element of a criminal offence: the intention or recklessness that must be proved alongside the act itself.' },
    ],
    note: {
      heading: 'Case names and citations',
      body: 'Spoken case names are among the hardest things for any transcriber to catch, and Demist will not always get them right. If a card looks wrong, it is worth checking against your reading list rather than trusting it.',
    },
  },
  {
    slug: 'business',
    subject: 'business and economics',
    audience: 'business and economics students',
    title: 'Demist for business and economics students',
    description:
      'Demist explains economic and financial terminology during your lectures, then builds a glossary and flashcards from it. Free, and the Windows app runs entirely on your own computer.',
    problem:
      'Economics builds each concept on the last, so one unfamiliar term early in a lecture quietly costs you the rest of it. Finance adds a layer of terms that sound like ordinary English and are not.',
    terms: [
      { term: 'Externality', definition: 'A cost or benefit of an activity that falls on someone who did not choose to be part of it, and so is not reflected in the price.' },
      { term: 'Opportunity cost', definition: 'The value of the best alternative you gave up in order to do what you chose to do.' },
      { term: 'Liquidity', definition: 'How quickly an asset can be turned into cash without losing much of its value.' },
      { term: 'Price elasticity of demand', definition: 'How much the quantity people buy changes when the price changes, expressed as a proportion rather than an amount.' },
      { term: 'Moral hazard', definition: 'When being protected from a risk makes someone more willing to take it, because they no longer bear the full consequences.' },
    ],
    note: {
      heading: 'Words that mean something specific here',
      body: 'Terms like capital, equity, margin and interest all have everyday meanings and technical ones. Demist explains the technical reading when it flags one, but a word that sounds ordinary is more likely to be passed over than one that is plainly technical, so it will not catch every one.',
    },
  },
  {
    slug: 'pharmacy',
    subject: 'pharmacy',
    audience: 'pharmacy students',
    title: 'Demist for pharmacy students',
    description:
      'Demist explains pharmacology and pharmaceutics terminology during your pharmacy lectures, then builds a glossary and flashcards from it. Free, and the Windows app runs entirely on your own computer.',
    problem:
      'Pharmacy lectures move between chemistry, physiology and clinical practice in the same hour, and the drug names alone are a second vocabulary. Stop to look one up and the mechanism that followed it has gone.',
    terms: [
      { term: 'Bioavailability', definition: 'The proportion of a dose that reaches the general circulation unchanged. An intravenous dose is 100% bioavailable; an oral one is usually less.' },
      { term: 'First-pass metabolism', definition: 'The breakdown of a drug by the gut wall and liver after it is swallowed and before it reaches the rest of the body, which lowers how much is available.' },
      { term: 'Half-life', definition: 'The time it takes for the concentration of a drug in the blood to fall by half.' },
      { term: 'Therapeutic index', definition: 'The ratio between the dose that causes harm and the dose that has the intended effect. A narrow therapeutic index means little margin for error.' },
      { term: 'Agonist', definition: 'A drug that binds to a receptor and activates it, producing a response like the body\'s own signalling molecule would.' },
    ],
    note: {
      heading: 'For understanding lectures, not for dosing',
      body: 'Demist explains what a term means so you can follow the lecture. It is not a prescribing reference and its explanations are AI-generated, so never use them for doses, interactions or anything clinical. Your course will point you to the proper references for that.',
    },
  },
  {
    slug: 'engineering',
    subject: 'engineering',
    audience: 'engineering students',
    title: 'Demist for engineering students',
    description:
      'Demist explains engineering terminology during your lectures, as your lecturer says it, then builds a glossary and flashcards from it. Free, and the Windows app runs entirely on your own computer.',
    problem:
      'Engineering lectures name a concept once and then use it for the rest of the hour. If the name did not land, every derivation that follows is built on something you missed.',
    terms: [
      { term: "Young's modulus", definition: 'A measure of a material\'s stiffness: the stress applied divided by the strain it produces, while the material still springs back to its original shape.' },
      { term: 'Reynolds number', definition: 'A dimensionless number comparing inertial forces to viscous forces in a flowing fluid, used to predict whether the flow will be smooth (laminar) or turbulent.' },
      { term: 'Bending moment', definition: 'The turning effect of the forces acting on a beam at a given point, which determines how much the beam bends there.' },
      { term: 'Eigenvalue', definition: 'A number that describes how a transformation stretches or shrinks a particular direction, called an eigenvector, without changing the direction itself.' },
      { term: 'Fourier transform', definition: 'A way of breaking a signal down into the frequencies it is made of, so it can be analysed by frequency instead of over time.' },
    ],
    note: {
      heading: 'It listens, it does not read the board',
      body: 'Demist works from what your lecturer says. It will explain a concept they name, but it cannot see equations or diagrams written on the board or slides, so it is a companion to your notes on the maths, not a replacement for them.',
    },
  },
  {
    slug: 'international-students',
    subject: 'university',
    audience: 'international students',
    title: 'Demist for international students',
    description:
      'Demist helps international students follow lectures in English: it explains unfamiliar terms as they are said, can translate those explanations, and works alongside your university\'s lecture recordings. Free to start.',
    problem:
      'A lecture in your second language runs at the speed of a native speaker, with subject vocabulary on top of the English. Stopping to translate one word costs you the next sentence, and the one after that.',
    terms: [
      { term: 'Formative assessment', definition: 'Work that is marked to give you feedback on your progress but does not count towards your final grade.' },
      { term: 'Literature review', definition: 'A written survey of what published research already says about a topic, usually the starting point for an essay or dissertation.' },
      { term: 'Peer review', definition: 'The process where other experts check a piece of research before it is published, to judge whether it is sound.' },
      { term: 'Critical analysis', definition: 'Evaluating an argument or piece of evidence, including its weaknesses, rather than only describing what it says.' },
      { term: 'Methodology', definition: 'The reasoning behind how a study was carried out: why these methods, and what they can and cannot show.' },
    ],
    note: {
      heading: 'Use it with your university\'s recordings',
      body: 'If your university records lectures on Panopto, Teams or Zoom, you can play the recording in a browser tab and let Demist listen to that tab, pausing whenever you need to. Explanations can be translated into Mandarin, Arabic, Hindi, Spanish or French, so you can check a term in your own language without leaving the lecture.',
    },
  },
]

export function getSubjectPage(slug: string): SubjectPage | undefined {
  return SUBJECT_PAGES.find(p => p.slug === slug)
}
