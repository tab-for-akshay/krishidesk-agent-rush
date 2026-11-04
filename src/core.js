// KrishiDesk core v2: triage + safety guard + knowledge lookup. Pure JS, shared by the Forge functions and the web demo.
// Built by Tab (AI assistant) for team lead Akshay Wagh.
const CATEGORIES = {
  pest: ['pest', 'insect', 'worm', 'caterpillar', 'larva', 'aphid', 'whitefly', 'white fly', 'borer', 'bollworm', 'armyworm', 'jassid', 'thrips', 'mite', 'locust', 'hopper', 'beetle', 'grub', 'termite', 'dead heart', 'holes'],
  disease: ['disease', 'blight', 'rust', 'wilt', 'rot', 'mildew', 'spot', 'virus', 'fungus', 'yellowing', 'yellow', 'curl', 'blast', 'smut', 'lesion', 'mosaic', 'drying', 'patches', 'bunchy'],
  nutrient: ['fertiliser', 'fertilizer', 'urea', 'dap', 'npk', 'soil', 'nutrient', 'deficiency', 'zinc', 'manure', 'compost', 'soil health', 'pale'],
  water: ['irrigation', 'water', 'drip', 'sprinkler', 'drought', 'flood', 'rain', 'monsoon', 'waterlogging'],
  scheme: ['scheme', 'pm-kisan', 'pm kisan', 'kcc', 'loan', 'subsidy', 'insurance', 'pmfby', 'fasal bima', 'installment', 'instalment', 'claim', 'credit'],
  market: ['price', 'mandi', 'sell', 'market', 'msp', 'e-nam', 'enam', 'trader', 'rate'],
};
const CROPS = ['rice', 'paddy', 'wheat', 'maize', 'corn', 'cotton', 'soybean', 'sugarcane', 'tomato', 'onion', 'potato', 'chilli', 'chili', 'groundnut', 'mustard', 'gram', 'chickpea', 'tur', 'arhar', 'pigeonpea', 'moong', 'mung', 'urad', 'lentil', 'bajra', 'jowar', 'sorghum', 'ragi', 'banana', 'mango', 'grapes', 'pomegranate', 'brinjal', 'okra', 'bhindi', 'cabbage', 'cauliflower', 'cucumber', 'chickpea', 'sunflower', 'coconut', 'tea', 'coffee'];
// --- Safety guard (rule floor; an AI classifier may only add escalations, never remove these) ---
const INGEST = ['drank', 'drink', 'drunk', 'swallow', 'ingest', 'consumed', 'ate ', 'eaten', 'poison', 'suicide', 'overdose', 'pi liya', 'pee liya', 'kha liya', 'zeher', 'zahar', 'जहर', 'ज़हर', 'विष', 'पी लिया', 'प्यायले'];
const SYMPTOM = ['headache', 'head ache', 'dizzy', 'dizziness', 'giddy', 'vomit', 'nausea', 'sweating', 'sweat', 'breath', 'unconscious', 'faint', 'fits', 'seizure', 'convulsion', 'blurred', 'blurry', 'saliva', 'froth', 'eyes burning', 'burning eyes', 'skin burning', 'rash', 'chest pain', 'collapsed', 'shivering', 'tremor', 'chakkar', 'ulti', 'चक्कर', 'उल्टी'];
const EXPOSURE = ['spray', 'sprayed', 'spraying', 'pesticide', 'insecticide', 'fungicide', 'herbicide', 'weedicide', 'chemical', 'dawai', 'davai', 'medicine for crop', 'keetnashak', 'kitnashak', 'कीटनाशक', 'field', 'tank', 'pump'];
const PESTICIDES = ['monocrotophos', 'chlorpyrifos', 'chlorpyriphos', 'imidacloprid', 'acephate', 'profenofos', 'cypermethrin', 'lambda', 'cyhalothrin', 'emamectin', 'fipronil', 'thiamethoxam', 'carbofuran', 'phorate', 'thimet', 'quinalphos', 'dimethoate', 'dichlorvos', 'ddvp', 'endosulfan', 'paraquat', 'glyphosate', '2,4-d', '2,4 d', 'atrazine', 'pendimethalin', 'mancozeb', 'carbendazim', 'tricyclazole', 'hexaconazole', 'propiconazole', 'copper oxychloride', 'chlorantraniliprole', 'spinosad', 'malathion', 'triazophos', 'methyl parathion', 'parathion', 'aluminium phosphide', 'aluminum phosphide', 'celphos', 'zinc phosphide', 'carbaryl', 'acetamiprid', 'buprofezin', 'flubendiamide', 'indoxacarb', 'methomyl', 'ethion', 'phosalone', 'oxydemeton', 'methyl demeton', 'thiacloprid', 'spinetoram', 'carbosulfan', 'clothianidin', 'dinotefuran', 'neonicotinoid', 'organophosphate'];
const DOSE = ['how many ml', 'how much ml', ' ml', 'ml per', 'ml/', 'dose', 'dosage', 'how much to spray', 'how much should i spray', 'per litre', 'per liter', 'per acre', 'per pump', 'per tank', 'gram per', 'g per', 'mix how much', 'kitna'];
const SELF_HARM = ['suicide', 'suicidal', 'kill myself', 'end my life', 'want to die', 'no reason to live', 'take my life', 'jeena nahi', 'mar jaunga', 'mar jaungi', 'aatmahatya', 'आत्महत्या', 'मरना चाहता', 'जीना नहीं'];
const MIXING = ['mix', 'mixing', 'mixed', 'tank mix', 'combine', 'combination', 'together in one'];
const FAKE_INPUT = ['fake', 'duplicate', 'adulterated', 'spurious', 'counterfeit', 'nakli', 'नकली', 'substandard'];
const URGENT = ['dying', 'whole field', 'entire field', 'spreading fast', 'all plants', 'urgent', 'emergency', 'help fast', 'overnight'];

function norm(s) { return ' ' + String(s || '').toLowerCase().replace(/\s+/g, ' ') + ' '; }
const esc = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// ASCII words match on word boundaries (so 'ate' does not fire inside 'glyphosate'); Devanagari phrases match as substrings
const hasRaw = (t, list) => list.filter(w => /^[\x00-\x7f]+$/.test(w) ? new RegExp('(^|[^a-z0-9])' + esc(w.trim()) + (w.endsWith(' ') ? '([^a-z0-9]|$)' : /^[a-z]{1,4}$/.test(w.trim()) ? '(s|es|ed|ing|y)?([^a-z0-9]|$)' : '')).test(t) : t.includes(w));
// drop a match that is part of a longer match ('sweat' inside 'sweating')
const has = (t, list) => { const m = hasRaw(t, list); return m.filter(w => !m.some(o => o !== w && o.includes(w.trim()))); };

function safetyCheck(text) {
  const t = norm(text);
  const ingest = has(t, INGEST), symptom = has(t, SYMPTOM), exposure = has(t, EXPOSURE), chem = has(t, PESTICIDES), dose = has(t, DOSE);
  const reasons = [];
  let level = 'none', kind = null;
  const selfHarm = has(t, SELF_HARM);
  if (selfHarm.length) { reasons.push('self-harm words: ' + selfHarm.join(', ')); return { level: 'poisoning', kind: 'self-harm', reasons, matched: { ingest, symptom, exposure, chem, dose, selfHarm } }; }
  if (ingest.length && (exposure.length || chem.length || /poison|zeher|zahar|जहर|ज़हर|विष|overdose/.test(t))) { level = 'poisoning'; kind = 'swallowed'; reasons.push('swallowed/poison words: ' + ingest.join(', ')); }
  if (symptom.length && (exposure.length || chem.length)) { if (level === 'none') kind = 'exposure'; level = 'poisoning'; reasons.push('symptoms after chemical exposure: ' + symptom.join(', ')); }
  if (level === 'none' && ingest.length && symptom.length) { level = 'poisoning'; kind = 'swallowed'; reasons.push('swallowed something + symptoms'); }
  const mixing = has(t, MIXING), fake = has(t, FAKE_INPUT);
  if (level === 'none' && mixing.length && (chem.length || /insecticide|pesticide|fungicide|herbicide|weedicide|chemical|spray|fertili[sz]er|urea|dap/.test(t))) { level = 'chemical'; reasons.push('asks about mixing chemicals: ' + mixing.join(', ')); }
  if (level === 'none' && fake.length) { level = 'input-quality'; reasons.push('suspected fake or substandard input: ' + fake.join(', ')); }
  if (level === 'none' && (chem.length || (dose.length && (exposure.length || /spray|chemical|pesticide|insecticide|fungicide|herbicide|urea|dap|fertili[sz]er/.test(t))))) {
    level = 'chemical'; reasons.push(chem.length ? 'names a pesticide: ' + chem.join(', ') : 'asks for a chemical dose');
  }
  return { level, kind, reasons, matched: { ingest, symptom, exposure, chem, dose } };
}

function triage(text) {
  const t = norm(text);
  const scores = {};
  for (const [cat, words] of Object.entries(CATEGORIES)) scores[cat] = has(t, words).length;
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const category = ranked[0][1] > 0 ? ranked[0][0] : 'general';
  let crop = CROPS.find(c => new RegExp('\\b' + c + '\\b').test(t)) || null;
  if (crop === 'corn') crop = 'maize'; if (crop === 'paddy') crop = 'rice'; if (crop === 'chili') crop = 'chilli';
  const s = safetyCheck(text);
  const safety = s.level === 'poisoning';
  const urgency = safety ? 'critical' : has(t, URGENT).length ? 'high' : s.level === 'chemical' ? 'medium' : (category === 'pest' || category === 'disease') ? 'medium' : 'low';
  const requestType = safety ? 'Emergency' : (category === 'pest' || category === 'disease' || category === 'nutrient') ? 'Pest/Disease' : category === 'scheme' ? 'Scheme' : category === 'market' ? 'Market' : 'General';
  const labels = ['krishidesk', 'cat-' + category, 'type-' + requestType.toLowerCase().replace(/[^a-z]/g, '')]
    .concat(crop ? ['crop-' + crop] : [])
    .concat(safety ? [s.kind === 'self-harm' ? 'safety-selfharm' : 'safety-poisoning', 'urgent'] : [])
    .concat(s.level === 'chemical' ? ['chem-expert-signoff'] : [])
    .concat(!safety && urgency === 'high' ? ['urgent'] : []);
  if (s.level === 'input-quality') labels.push('input-quality');
  return { category, crop, urgency, safety, safetyLevel: s.level, safetyKind: s.kind, safetyReasons: s.reasons, requestType, labels };
}

function lookup(kb, text, crop) {
  const t = norm(text);
  const hits = kb.map(e => {
    const kw = has(t, e.keywords);
    let s = kw.length * 2;
    const cropOk = e.crops.includes('*') || !crop || e.crops.includes(crop) || (crop === 'rice' && e.crops.includes('paddy'));
    if (crop && (e.crops.includes(crop) || (crop === 'rice' && e.crops.includes('paddy')))) s += 3;
    if (!cropOk) s -= 4;
    if (!kw.length) s = 0; // crop alone is not a match
    return { e, s };
  }).filter(h => h.s > 0).sort((a, b) => b.s - a.s).slice(0, 3);
  return hits.map(h => ({ id: h.e.id, title: h.e.title, advice: h.e.advice, source: h.e.source, portal: h.e.portal || null, page: h.e.page || null, expertReview: !!h.e.expert_review, score: h.s }));
}

const SWALLOW_REPLY = 'SAFETY FIRST: someone may have swallowed a pesticide. This is a medical emergency even if they feel fine. Call 108 (ambulance) or take them to the nearest hospital NOW, and take the pesticide container or label along. Do not wait for symptoms. A human officer has been alerted and must call back. No crop advice is sent on this ticket.';
const SELF_HARM_REPLY = 'SAFETY FIRST: the caller may be at risk of harming themselves. Stay with them on the line and keep them talking. Call 112 (emergency) if there is immediate danger. Share Tele-MANAS, the free 24x7 mental health helpline: 14416 or 1-800-891-4416. Keep pesticides and other means out of reach. A human officer has been alerted and must call back now. Crop-loss and loan questions are handled after the caller is safe.';
const INPUT_REPLY = 'This looks like a complaint about a fake or substandard input (seed, fertiliser or pesticide). Keep the packet, bill and batch number; do not use the rest. The ticket goes to the officer who handles input-quality complaints.';
const POISON_REPLY = 'SAFETY FIRST: this may be pesticide poisoning. Tell the caller: stop all work; move the person to fresh air; remove contaminated clothes and wash the skin with soap and water; call 108 (ambulance) or go to the nearest hospital now, and take the pesticide container or label along. A human officer has been alerted and must call back. No crop advice is sent on this ticket.';
const CHEM_REPLY = 'This question names a pesticide, asks for a dose, or asks about mixing chemicals. KrishiDesk does not draft chemical names, doses or mixes: a human expert will reply with a product and dose approved for this crop. Meanwhile: use only products whose label lists this crop and pest, follow the label dose, wear gloves and a mask, and never spray in strong wind or mix chemicals at home.';

function draftReply(text, kb) {
  const tri = triage(text);
  const matches = (tri.safety || tri.safetyLevel === 'input-quality') ? [] : lookup(kb, text, tri.crop);
  const lines = [];
  if (tri.safety) lines.push(tri.safetyKind === 'self-harm' ? SELF_HARM_REPLY : tri.safetyKind === 'swallowed' ? SWALLOW_REPLY : POISON_REPLY);
  else {
    if (tri.safetyLevel === 'chemical') lines.push(CHEM_REPLY);
    if (tri.safetyLevel === 'input-quality') lines.push(INPUT_REPLY);
    if (matches.length) matches.forEach(m => lines.push(m.title + ': ' + m.advice + ' (Source: ' + (m.source || m.page && m.page.url) + (m.page && m.page.owner ? '; advisory owner: ' + m.page.owner + ', v' + m.page.version : '') + ')' + (m.expertReview ? ' [Expert sign-off needed before any chemical step]' : '')));
    else if (tri.safetyLevel === 'none') lines.push('No vetted advisory matches this yet. Ticket routed to the ' + (tri.requestType === 'General' ? 'duty officer' : tri.requestType + ' expert') + ' with the details above. A clear photo of the affected plant helps.');
  }
  // auto-draft only when every cited advisory is not chemical, and a crop-specific advisory matches a crop the farmer actually named
  const cropUnsure = matches.some(m => { const e = kb.find(x => x.id === m.id); return e && !e.crops.includes('*') && !tri.crop; });
  const needsHuman = tri.safety || tri.safetyLevel !== 'none' || !matches.length || matches.some(m => m.expertReview) || cropUnsure;
  return { triage: tri, matches, reply: lines.join('\n\n'), needsHuman, queue: tri.safety ? 'Emergency (15-min SLA)' : tri.safetyLevel === 'input-quality' ? 'Input-quality complaints' : needsHuman ? 'Expert review' : 'Auto-draft, officer approves', cropUnsure };
}

const API = { triage, lookup, draftReply, safetyCheck, CATEGORIES, CROPS, PESTICIDES };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else globalThis.KrishiCore = API;
