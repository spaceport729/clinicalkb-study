/* ClinicalKB Study — Main App Logic */

(function () {
  'use strict';

  // ==================== STATE ====================
  let DB = null;           // Full KB data
  let progress = {};       // Per-note progress tracking
  let session = null;      // Current study session state
  let currentView = 'home';
  let browseFilter = 'All';
  let browseSearch = '';
  let previousView = 'home';

  const STORAGE_KEY = 'clinicalkb-progress';
  const SESSION_KEY = 'clinicalkb-session';
  const STREAK_KEY = 'clinicalkb-streak';
  const DARK_KEY = 'clinicalkb-dark';
  const COOLDOWN_DAYS = 3;

  // ==================== SECTION LOOKUP ====================
  // Many notes use non-standard section keys (e.g. "ed-management" instead of "management",
  // "pathophysiology-how-hyperglycemia-damages-nerves" instead of "pathophysiology").
  // This helper finds the best matching section content for a given key.
  function findSection(note, key) {
    if (!note || !note.sections) return '';
    // 1. Exact match
    if (note.sections[key]) return note.sections[key];
    // 2. Try key with common prefixes/suffixes
    var keys = Object.keys(note.sections);
    // Find keys that start with the target (e.g. "management" matches "management-principles-all-subtypes")
    var startsWith = keys.filter(function (k) { return k.indexOf(key) === 0; });
    if (startsWith.length > 0) return note.sections[startsWith[0]];
    // Find keys that contain the target (e.g. "ed-management" contains "management")
    var contains = keys.filter(function (k) { return k.indexOf(key) !== -1; });
    if (contains.length > 0) return note.sections[contains[0]];
    return '';
  }

  // Also returns the actual key name used, for deep-linking
  function findSectionKey(note, key) {
    if (!note || !note.sections) return key;
    if (note.sections[key]) return key;
    var keys = Object.keys(note.sections);
    var startsWith = keys.filter(function (k) { return k.indexOf(key) === 0; });
    if (startsWith.length > 0) return startsWith[0];
    var contains = keys.filter(function (k) { return k.indexOf(key) !== -1; });
    if (contains.length > 0) return contains[0];
    return key;
  }

  // ==================== INIT ====================
  async function init() {
    loadProgress();
    loadDarkMode();
    try {
      const resp = await fetch('data.json');
      DB = await resp.json();
      renderHome();
      setupNav();
      setupDarkToggle();
    } catch (e) {
      document.getElementById('main').innerHTML =
        '<div class="card" style="margin-top:40px;text-align:center;">' +
        '<p style="font-size:16px;font-weight:600;">Could not load data</p>' +
        '<p style="color:var(--text-muted);margin-top:8px;">Make sure data.json is in the same folder as index.html</p></div>';
    }
  }

  // ==================== STORAGE ====================
  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      progress = raw ? JSON.parse(raw) : {};
    } catch { progress = {}; }
  }

  function saveProgress() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }

  function getNoteProgress(noteId) {
    if (!progress[noteId]) {
      progress[noteId] = { lastSeen: null, timesSeen: 0, confidence: null, streak: 0 };
    }
    return progress[noteId];
  }

  function recordView(noteId, confidence) {
    const p = getNoteProgress(noteId);
    p.lastSeen = new Date().toISOString().slice(0, 10);
    p.timesSeen++;
    if (confidence) {
      if (confidence === 'solid' && p.confidence === 'solid') {
        p.streak++;
      } else if (confidence === 'solid') {
        p.streak = 1;
      } else {
        p.streak = 0;
      }
      p.confidence = confidence;
    }
    saveProgress();
  }

  function getStreak() {
    try {
      const raw = localStorage.getItem(STREAK_KEY);
      const data = raw ? JSON.parse(raw) : { count: 0, lastDate: null };
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      if (data.lastDate === today) return data;
      if (data.lastDate === yesterday) return data; // streak continues if they do today
      if (data.lastDate && data.lastDate < yesterday) return { count: 0, lastDate: data.lastDate };
      return data;
    } catch { return { count: 0, lastDate: null }; }
  }

  function completeSessionStreak() {
    const today = new Date().toISOString().slice(0, 10);
    const streak = getStreak();
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (streak.lastDate === today) return streak; // already counted today
    if (streak.lastDate === yesterday || streak.lastDate === today) {
      streak.count++;
    } else {
      streak.count = 1;
    }
    streak.lastDate = today;
    localStorage.setItem(STREAK_KEY, JSON.stringify(streak));
    return streak;
  }

  // ==================== DARK MODE ====================
  function loadDarkMode() {
    const dark = localStorage.getItem(DARK_KEY);
    if (dark === 'true' || (!dark && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.body.classList.add('dark');
    }
  }

  function setupDarkToggle() {
    document.getElementById('dark-toggle').addEventListener('click', function () {
      document.body.classList.toggle('dark');
      localStorage.setItem(DARK_KEY, document.body.classList.contains('dark'));
      const icon = document.getElementById('dark-icon');
      icon.textContent = document.body.classList.contains('dark') ? '\u2600' : '\u263E';
    });
    const icon = document.getElementById('dark-icon');
    icon.textContent = document.body.classList.contains('dark') ? '\u2600' : '\u263E';
  }

  // ==================== NAVIGATION ====================
  function setupNav() {
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var view = btn.dataset.view;
        showView(view);
      });
    });
  }

  function showView(viewName) {
    previousView = currentView;
    currentView = viewName;
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    document.getElementById('view-' + viewName).classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === viewName);
    });

    // Update topbar title
    var titles = {
      home: 'ClinicalKB Study',
      scenario: 'Today\'s Case',
      pharm: 'Pharm Flash',
      concept: 'Concept Check',
      pearls: 'Quick Hits',
      complete: 'Session Complete',
      progress: 'Progress',
      browse: 'Browse',
      note: 'Note Detail'
    };
    document.getElementById('topbar-title').textContent = titles[viewName] || 'ClinicalKB Study';

    // Render views
    if (viewName === 'home') renderHome();
    if (viewName === 'progress') renderDashboard();
    if (viewName === 'browse') renderBrowse();
  }

  // ==================== SELECTION ALGORITHM ====================
  function selectNote(category) {
    var ids = DB.categories[category];
    if (!ids || ids.length === 0) return null;

    var today = new Date().toISOString().slice(0, 10);
    var scored = ids.map(function (id) {
      var p = progress[id] || {};
      var daysSince = p.lastSeen
        ? Math.floor((Date.now() - new Date(p.lastSeen).getTime()) / 86400000)
        : 999;
      // Higher score = more likely to be selected
      var score = daysSince;
      // Boost notes never seen
      if (!p.lastSeen) score += 100;
      // Boost notes rated needs-review or study-more
      if (p.confidence === 'needs-review') score += 20;
      if (p.confidence === 'study-more') score += 40;
      // Penalize recently seen
      if (daysSince < COOLDOWN_DAYS) score = -1;
      return { id: id, score: score };
    });

    // Filter out cooled-down notes
    var eligible = scored.filter(function (s) { return s.score > 0; });
    // If all are on cooldown, just use all
    if (eligible.length === 0) eligible = scored;

    // Sort by score descending, take top 5, pick using daily seed (stable for 24h)
    eligible.sort(function (a, b) { return b.score - a.score; });
    var pool = eligible.slice(0, Math.min(5, eligible.length));
    var daySeed = getDaySeed(category);
    return pool[daySeed % pool.length].id;
  }

  // Deterministic daily seed — same date + salt = same number all day
  function getDaySeed(salt) {
    var today = new Date();
    var base = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
    // Simple hash: mix in the salt string
    var h = base;
    if (salt) {
      for (var i = 0; i < salt.length; i++) {
        h = ((h << 5) - h + salt.charCodeAt(i)) | 0;
      }
    }
    return Math.abs(h);
  }

  // Seeded pseudo-random for stable daily shuffles
  function seededShuffle(arr, seed) {
    var s = seed;
    function next() {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    }
    var copy = arr.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(next() * (i + 1));
      var tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  function selectRandomPearls(count) {
    var allPearls = [];
    Object.keys(DB.notes).sort().forEach(function (id) {
      var note = DB.notes[id];
      if (note.clinicalPearls) {
        note.clinicalPearls.forEach(function (pearl) {
          allPearls.push({ pearl: pearl, noteId: id, noteTitle: note.title, category: note.category });
        });
      }
    });
    // Stable daily shuffle
    var shuffled = seededShuffle(allPearls, getDaySeed('pearls'));
    return shuffled.slice(0, count);
  }

  // ==================== SESSION ====================
  function getTodayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function saveSession() {
    if (!session) return;
    try {
      // Only save the note selections, not progress — user wants a fresh
      // start each time but the same notes all day
      var data = {
        date: getTodayStr(),
        conditionId: session.conditionId,
        pharmId: session.pharmId,
        conceptId: session.conceptId,
        pearls: session.pearls,
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(data));
    } catch (e) { /* ignore */ }
  }

  function loadSavedSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (data.date !== getTodayStr()) return null;
      if (!DB.notes[data.conditionId] || !DB.notes[data.pharmId]) return null;
      return data;
    } catch (e) { return null; }
  }

  function startSession() {
    // Use today's saved note selections but always start fresh
    var saved = loadSavedSession();
    if (saved) {
      session = {
        conditionId: saved.conditionId,
        pharmId: saved.pharmId,
        conceptId: saved.conceptId,
        pearls: saved.pearls,
        scenarioStep: 0,
        scenarioRevealed: {},
        ratings: {},
        pearlIndex: 0,
      };
    } else {
      var conditionId = selectNote('Conditions');
      var pharmId = selectNote('Pharmacology');
      var conceptId = selectNote('Concepts');
      var pearls = selectRandomPearls(3);

      session = {
        conditionId: conditionId,
        pharmId: pharmId,
        conceptId: conceptId,
        pearls: pearls,
        scenarioStep: 0,
        scenarioRevealed: {},
        ratings: {},
        pearlIndex: 0,
      };
      saveSession();
    }

    renderScenario();
    showView('scenario');
  }

  // ==================== SCENARIO RENDERING ====================
  function renderScenario() {
    var note = DB.notes[session.conditionId];
    if (!note) return;

    var steps = [
      { label: 'Patient Presentation', key: 'presentation' },
      { label: 'Differential', key: 'differential' },
      { label: 'Pathophysiology', key: 'pathophysiology' },
      { label: 'Diagnostics', key: 'diagnostics' },
      { label: 'Management & Pharmacology', key: 'management' },
      { label: 'Nursing Priorities', key: 'nursing' },
      { label: 'Clinical Pearls', key: 'pearls' },
    ];
    var step = session.scenarioStep;

    // Progress dots
    var dotsHtml = steps.map(function (s, i) {
      var cls = i < step ? 'done' : (i === step ? 'current' : '');
      return '<div class="progress-dot ' + cls + '"></div>';
    }).join('');
    document.getElementById('scenario-progress').innerHTML = dotsHtml;

    var card = document.getElementById('scenario-card');
    var actions = document.getElementById('scenario-actions');

    switch (step) {
      case 0: renderPresentation(note, card, actions); break;
      case 1: renderDifferential(note, card, actions); break;
      case 2: renderPathophys(note, card, actions); break;
      case 3: renderDiagnostics(note, card, actions); break;
      case 4: renderManagement(note, card, actions); break;
      case 5: renderNursing(note, card, actions); break;
      case 6: renderScenarioPearls(note, card, actions); break;
    }
  }

  function buildVignette(note) {
    var hints = note.scenarioHints || {};
    var signs = hints.signs || [];
    var features = findSection(note, 'clinicalFeatures') || '';
    var allText = features + ' ' + (findSection(note, 'definition') || '') + ' ' + (findSection(note, 'pathophysiology') || '');

    var demographics = generateDemographics(note);
    var chiefComplaint = extractChiefComplaint(note);
    var vitals = extractVitals(hints, allText);

    // Clean and filter presenting features from signs
    var presentingFeatures = signs.slice(0, 6).map(function (s) {
      return s.replace(/\*\*/g, '').replace(/\[.*?\]/g, '').replace(/\[\[.*?\]\]/g, '')
              .split('—')[0].split('--')[0].split('(')[0].trim();
    }).filter(function(s) {
      // Remove things that name the condition or are too short/long
      var lower = s.toLowerCase();
      var titleLower = note.title.toLowerCase();
      var titleWords = titleLower.split(/\s+/);
      var giveaway = titleWords.some(function(w) { return w.length > 4 && lower.indexOf(w) !== -1; });
      return s.length > 5 && s.length < 80 && !giveaway;
    });

    // If we don't have enough signs, try extracting from clinical features text directly
    if (presentingFeatures.length < 2 && features) {
      var lines = features.split('\n');
      for (var i = 0; i < lines.length && presentingFeatures.length < 4; i++) {
        var line = lines[i].trim();
        if ((line.startsWith('- ') || line.startsWith('* ')) && line.length > 10 && line.length < 80) {
          var cleaned = line.substring(2).replace(/\*\*/g, '').replace(/\[.*?\]/g, '')
                          .split('—')[0].split('--')[0].split('(')[0].trim();
          var lower = cleaned.toLowerCase();
          var titleWords = note.title.toLowerCase().split(/\s+/);
          var giveaway = titleWords.some(function(w) { return w.length > 4 && lower.indexOf(w) !== -1; });
          if (!giveaway && cleaned.length > 5) {
            presentingFeatures.push(cleaned);
          }
        }
      }
    }

    // If still no vitals, generate plausible baseline vitals
    if (!vitals) {
      vitals = 'Vitals: BP 138/86, HR 92, RR 18, T 37.1C, SpO2 96% on RA.';
    }

    var vignette = demographics + '. Chief complaint: ' + chiefComplaint + '. ' + vitals;
    if (presentingFeatures.length > 0) {
      vignette += ' On assessment: ' + presentingFeatures.slice(0, 4).join('; ') + '.';
    }
    return vignette;
  }

  function generateDemographics(note) {
    var ages = ['42', '55', '67', '73', '28', '61', '38', '81', '49', '56'];
    var sexes = ['M', 'F'];
    var transports = ['presents to ED', 'brought in by EMS', 'walks into triage', 'transferred from urgent care'];
    var seed = getDaySeed(note.id);
    var age = ages[seed % ages.length];
    var sex = sexes[Math.floor(seed / 10) % sexes.length];
    var transport = transports[Math.floor(seed / 100) % transports.length];
    return age + sex + ' ' + transport;
  }

  function extractChiefComplaint(note) {
    var title = note.title.toLowerCase();
    // Map common conditions to realistic chief complaints (what the PATIENT says)
    var complaints = {
      'sepsis': 'fever, confusion, and weakness',
      'stemi': 'sudden crushing chest pain radiating to left arm',
      'nstemi': 'intermittent chest pressure and shortness of breath',
      'myocardial infarction': 'sudden crushing chest pain',
      'stroke': 'sudden onset facial droop and left-sided weakness',
      'pneumonia': 'productive cough, fever, and shortness of breath',
      'heart failure': 'progressive shortness of breath and lower extremity edema',
      'copd': 'worsening dyspnea and increased sputum production',
      'asthma': 'acute wheezing and difficulty breathing',
      'anaphylaxis': 'sudden swelling, hives, and difficulty breathing after exposure',
      'pulmonary embolism': 'sudden pleuritic chest pain and dyspnea',
      'cardiac arrest': 'witnessed collapse, unresponsive',
      'dka': 'nausea, vomiting, abdominal pain, and fruity breath',
      'diabetic ketoacidosis': 'nausea, vomiting, abdominal pain, and fruity breath',
      'pancreatitis': 'severe epigastric pain radiating to back',
      'appendicitis': 'periumbilical pain migrating to RLQ',
      'atrial fibrillation': 'palpitations and irregular heartbeat',
      'hypertension': 'severe headache and blurred vision',
      'aortic': 'sudden tearing chest pain radiating to back',
      'tamponade': 'chest pain, dyspnea, and muffled heart sounds',
      'kidney injury': 'decreased urine output, nausea, and swelling',
      'kidney disease': 'fatigue, decreased urine output, and swelling',
      'gastrointestinal bleed': 'vomiting blood and dark tarry stools',
      'gi bleed': 'vomiting blood and dark tarry stools',
      'dvt': 'unilateral leg swelling, pain, and redness',
      'deep vein': 'unilateral leg swelling, pain, and redness',
      'cellulitis': 'spreading redness, warmth, and swelling on extremity',
      'meningitis': 'severe headache, neck stiffness, and fever',
      'seizure': 'witnessed convulsions and post-event confusion',
      'overdose': 'found unresponsive with altered mental status',
      'poisoning': 'nausea, vomiting, and altered mental status',
      'fracture': 'extremity pain, swelling, and deformity after fall',
      'pneumothorax': 'sudden chest pain and shortness of breath',
      'ards': 'progressive respiratory distress and hypoxia',
      'cirrhosis': 'abdominal distension, jaundice, and confusion',
      'hepatitis': 'jaundice, fatigue, and RUQ pain',
      'cholecystitis': 'RUQ pain after eating, nausea, and fever',
      'bowel obstruction': 'abdominal pain, vomiting, and no bowel movements',
      'diverticulitis': 'LLQ pain, fever, and change in bowel habits',
      'ulcerative colitis': 'bloody diarrhea with urgency and cramping',
      'crohn': 'abdominal pain, diarrhea, and weight loss',
      'aneurysm': 'sudden severe pain and lightheadedness',
      'uti': 'dysuria, frequency, and suprapubic pain',
      'urinary tract': 'dysuria, frequency, and suprapubic pain',
      'pyelonephritis': 'flank pain, fever, and painful urination',
      'encephalitis': 'fever, headache, and altered mental status',
      'endocarditis': 'persistent fever, fatigue, and new heart murmur',
      'pericarditis': 'sharp chest pain worse with inspiration and lying flat',
      'hyperkalemia': 'weakness, palpitations, and nausea',
      'hyponatremia': 'confusion, headache, and nausea',
      'hypoglycemia': 'tremor, diaphoresis, and confusion',
      'thyroid storm': 'agitation, high fever, and racing heart',
      'adrenal': 'weakness, hypotension, and abdominal pain',
      'sickle cell': 'severe pain in chest and extremities',
      'migraine': 'severe unilateral headache with nausea and photophobia',
      'vertigo': 'room-spinning dizziness and nausea',
      'bell': 'sudden onset unilateral facial weakness',
      'guillain': 'progressive bilateral leg weakness ascending upward',
      'myasthenia': 'progressive weakness, drooping eyelids, and difficulty swallowing',
      'multiple sclerosis': 'visual changes, numbness, and balance problems',
      'rhabdomyolysis': 'severe muscle pain, weakness, and dark urine',
      'psychosis': 'agitation, disorganized speech, and paranoid ideation',
      'delirium': 'acute confusion, agitation, and fluctuating awareness',
      'depression': 'worsening mood, insomnia, and thoughts of self-harm',
      'anxiety': 'chest tightness, palpitations, and feeling of impending doom',
      'suicidal': 'expressing intent to self-harm',
      'alcohol withdrawal': 'tremor, agitation, and visual hallucinations',
      'opioid': 'found unresponsive with pinpoint pupils and respiratory depression',
      'intoxication': 'altered mental status and unsteady gait',
      'withdrawal': 'tremor, diaphoresis, and agitation',
      'status epilepticus': 'continuous seizure activity for over 5 minutes',
      'ectopic': 'lower abdominal pain, vaginal bleeding, and missed period',
      'preeclampsia': 'headache, visual changes, and elevated blood pressure in pregnancy',
      'placenta': 'painless vaginal bleeding in third trimester',
      'burn': 'thermal injury with blistering and pain',
      'hypothermia': 'found outdoors, confused, with core temp below 35C',
      'heat stroke': 'confusion, hot dry skin, and core temp above 40C',
      'drowning': 'submersion event with coughing and respiratory distress',
      'spinal cord': 'loss of motor and sensory function below level of injury',
      'compartment': 'severe extremity pain out of proportion, especially with passive stretch',
      'acute coronary': 'chest pressure with diaphoresis and dyspnea',
      'aortic dissection': 'sudden tearing chest pain radiating to back',
      'aortic stenosis': 'exertional syncope, chest pain, and dyspnea',
      'mitral': 'dyspnea on exertion, fatigue, and palpitations',
      'cardiomyopathy': 'progressive dyspnea, fatigue, and lower extremity edema',
      'myocarditis': 'chest pain, dyspnea, and recent viral illness',
      'respiratory failure': 'progressive dyspnea, accessory muscle use, and cyanosis',
      'pleural effusion': 'dyspnea and decreased breath sounds on one side',
      'tension pneumo': 'severe dyspnea, tracheal deviation, and absent breath sounds',
      'tuberculosis': 'chronic cough, night sweats, and weight loss',
      'abscess': 'localized swelling, redness, warmth, and fluctuance',
      'nephrolithiasis': 'severe colicky flank pain radiating to groin',
      'kidney stone': 'severe colicky flank pain radiating to groin',
      'testicular torsion': 'sudden onset severe scrotal pain and swelling',
      'ovarian torsion': 'sudden onset severe unilateral pelvic pain with nausea',
      'ischemic bowel': 'severe abdominal pain out of proportion to exam',
      'intussusception': 'episodic abdominal pain, vomiting, and currant jelly stools',
      'volvulus': 'abdominal distension, pain, and obstipation',
    };
    for (var key in complaints) {
      if (title.indexOf(key) !== -1) return complaints[key];
    }
    // Fallback: build from clinical signs (never mention the condition name)
    var hints = note.scenarioHints || {};
    var signs = (hints.signs || []).slice(0, 3);
    if (signs.length >= 2) {
      var cleaned = signs.map(function(s) {
        return s.replace(/\*\*/g, '').replace(/\(.*?\)/g, '').split('—')[0].split('--')[0].trim().toLowerCase();
      }).filter(function(s) { return s.length > 3 && s.length < 60; });
      if (cleaned.length >= 2) {
        return cleaned.slice(0, 3).join(', ');
      }
    }
    // Last resort: use a generic but realistic chief complaint
    var generics = [
      'not feeling right for the past few days',
      'general malaise and worsening symptoms',
      'feeling weak and unwell',
      'worsening symptoms over the past 24 hours',
    ];
    return generics[getDaySeed(note.id) % generics.length];
  }

  function extractVitals(hints, features) {
    // Look for vital signs in the text
    var vitals = [];
    var text = features + ' ' + (hints.signs || []).join(' ');
    if (/bp\s*[<>]|sbp\s*[<>]|hypotens/i.test(text)) vitals.push('BP 82/48');
    else if (/hypertens/i.test(text)) vitals.push('BP 198/112');
    if (/tachycard|hr\s*>/i.test(text)) vitals.push('HR 118');
    if (/tachypn|rr\s*>/i.test(text)) vitals.push('RR 28');
    if (/fever|temp\s*>/i.test(text)) vitals.push('T 39.2C');
    else if (/hypotherm|temp\s*</i.test(text)) vitals.push('T 35.4C');
    if (/spo2|hypox|desat/i.test(text)) vitals.push('SpO2 88% on RA');
    if (vitals.length > 0) return 'Vitals: ' + vitals.join(', ') + '.';
    return '';
  }

  function renderPresentation(note, card, actions) {
    var vignette = buildVignette(note);
    card.innerHTML =
      '<div class="scenario-label">Patient Presentation</div>' +
      '<div class="vignette">' + escapeHtml(vignette) + '</div>' +
      '<div class="scenario-prompt">Take a moment to consider this presentation.</div>' +
      '<p class="scenario-body">What conditions are you considering? What\'s your primary survey, and what are you watching for?</p>';
    actions.innerHTML = '<button class="btn-primary" onclick="CKB.nextStep()">Show me the differential</button>' +
      renderStepNav(false, false);
  }

  function buildDifferential(note) {
    // Build a realistic differential: correct dx + 2-3 plausible alternatives
    if (session.differential) return session.differential;

    var correctId = session.conditionId;
    var candidates = [];

    // 1. Same system conditions
    if (note.system) {
      var conditionIds = DB.categories['Conditions'] || [];
      conditionIds.forEach(function (id) {
        if (id !== correctId && DB.notes[id] && DB.notes[id].system === note.system) {
          candidates.push(id);
        }
      });
    }

    // 2. Related conditions from the graph
    var related = (DB.graph[correctId] || []).filter(function (id) {
      return DB.notes[id] && DB.notes[id].category === 'Conditions' && id !== correctId;
    });
    related.forEach(function (id) {
      if (candidates.indexOf(id) === -1) candidates.push(id);
    });

    // 3. If still not enough, pull random conditions
    if (candidates.length < 2) {
      var allConditions = (DB.categories['Conditions'] || []).filter(function (id) {
        return id !== correctId && candidates.indexOf(id) === -1;
      });
      var shuffled = seededShuffle(allConditions, getDaySeed('diff-' + correctId));
      candidates = candidates.concat(shuffled.slice(0, 5));
    }

    // Pick 2-3 distractors using daily seed (stable all day)
    var shuffledCandidates = seededShuffle(candidates, getDaySeed('differential'));
    var distractors = shuffledCandidates.slice(0, 3).map(function (id) {
      return { id: id, title: DB.notes[id].title };
    });

    // Build shuffled list with correct answer mixed in
    var all = distractors.concat([{ id: correctId, title: note.title, correct: true }]);
    var shuffledAll = seededShuffle(all, getDaySeed('diff-order'));

    session.differential = { items: shuffledAll, correctId: correctId };
    return session.differential;
  }

  function renderDifferential(note, card, actions) {
    var revealed = session.scenarioRevealed.differential;
    var diff = buildDifferential(note);

    var listHtml = '';
    if (revealed) {
      diff.items.forEach(function (item) {
        var isCorrect = item.id === diff.correctId;
        listHtml += '<div style="padding:10px 12px;margin:6px 0;border-radius:8px;border:2px solid ' +
          (isCorrect ? 'var(--green)' : 'var(--border)') + ';background:' +
          (isCorrect ? 'rgba(34,197,94,0.08)' : 'transparent') + ';cursor:pointer" ' +
          'onclick="CKB.openNote(\'' + item.id + '\')">' +
          '<strong style="' + (isCorrect ? 'color:var(--green)' : '') + '">' +
          (isCorrect ? '✓ ' : '✗ ') + escapeHtml(item.title) + '</strong>' +
          '</div>';
      });
      // Show definition of the correct answer
      var defContent = findSection(note, 'definition');
      var defKey = findSectionKey(note, 'definition');
      listHtml += defContent
        ? '<div style="margin-top:12px">' + summarizeSection(defContent, 5, session.conditionId, defKey) + '</div>'
        : '';
    } else {
      diff.items.forEach(function (item, i) {
        listHtml += '<div style="padding:10px 12px;margin:6px 0;border-radius:8px;border:1px solid var(--border)">' +
          (i + 1) + '. ' + escapeHtml(item.title) + '</div>';
      });
    }

    card.innerHTML =
      '<div class="scenario-label">Differential</div>' +
      '<div class="scenario-prompt">What\'s on your differential?</div>' +
      '<p class="scenario-body">' + (revealed
        ? 'Here\'s the answer — tap any condition to explore it.'
        : 'Review the options below. Which condition best fits this presentation? Tap to reveal the answer.') + '</p>' +
      '<div class="reveal-zone ' + (revealed ? 'revealed' : '') + '" onclick="CKB.reveal(\'differential\')">' +
        listHtml
      + '</div>';
    actions.innerHTML = (revealed
      ? renderRatingAndNext('differential')
      : '') + renderStepNav(true, revealed);
  }

  function renderPathophys(note, card, actions) {
    var revealed = session.scenarioRevealed.pathophysiology;
    var content = findSection(note, 'pathophysiology') || findSection(note, 'mechanism') || 'No pathophysiology section available for this note.';
    var sKey = findSectionKey(note, 'pathophysiology') || findSectionKey(note, 'mechanism');
    card.innerHTML =
      '<div class="scenario-label">Pathophysiology</div>' +
      '<div class="scenario-prompt">Walk through the pathophysiology. Why is this happening?</div>' +
      '<p class="scenario-body">Trace it from the underlying mechanism to the signs and symptoms you\'re seeing at the bedside.</p>' +
      '<div class="reveal-zone ' + (revealed ? 'revealed' : '') + '" onclick="CKB.reveal(\'pathophysiology\')">' +
        (revealed ? summarizeSection(content, 8, session.conditionId, sKey) : 'Tap to reveal the pathophysiology')
      + '</div>';
    actions.innerHTML = (revealed ? renderRatingAndNext('pathophysiology') : '') + renderStepNav(true, revealed);
  }

  function renderDiagnostics(note, card, actions) {
    var revealed = session.scenarioRevealed.diagnostics;
    var content = findSection(note, 'diagnosis') || 'No diagnostics section available for this note.';
    var sKey = findSectionKey(note, 'diagnosis');
    card.innerHTML =
      '<div class="scenario-label">Diagnostics</div>' +
      '<div class="scenario-prompt">What diagnostics do you anticipate?</div>' +
      '<p class="scenario-body">Think labs, imaging, and bedside assessments the provider will likely order. What would you prioritize drawing first? What\'s time-critical?</p>' +
      '<div class="reveal-zone ' + (revealed ? 'revealed' : '') + '" onclick="CKB.reveal(\'diagnostics\')">' +
        (revealed ? summarizeSection(content, 8, session.conditionId, sKey) : 'Tap to reveal diagnostics')
      + '</div>';
    actions.innerHTML = (revealed ? renderRatingAndNext('diagnostics') : '') + renderStepNav(true, revealed);
  }

  function renderManagement(note, card, actions) {
    var revealed = session.scenarioRevealed.management;
    var content = findSection(note, 'management') || '';
    var sKey = findSectionKey(note, 'management');
    // Add linked pharmacology notes
    var pharmLinks = (DB.graph[session.conditionId] || []).filter(function (id) {
      return DB.notes[id] && DB.notes[id].category === 'Pharmacology';
    });
    var pharmHtml = '';
    if (pharmLinks.length > 0 && revealed) {
      pharmHtml = '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">' +
        '<strong style="font-size:13px;color:var(--green)">RELATED PHARMACOLOGY:</strong><br>';
      pharmLinks.slice(0, 5).forEach(function (pid) {
        var pn = DB.notes[pid];
        pharmHtml += '<span class="note-link-chip" onclick="CKB.openNote(\'' + pid + '\')">' + escapeHtml(pn.title) + '</span> ';
      });
      pharmHtml += '</div>';
    }
    card.innerHTML =
      '<div class="scenario-label">Management & Pharmacology</div>' +
      '<div class="scenario-prompt">What interventions do you anticipate?</div>' +
      '<p class="scenario-body">Think nursing interventions, medications you\'ll be administering, drips to prepare, and what to have at bedside. What are the priorities?</p>' +
      '<div class="reveal-zone ' + (revealed ? 'revealed' : '') + '" onclick="CKB.reveal(\'management\')">' +
        (revealed ? summarizeSection(content, 8, session.conditionId, sKey) + pharmHtml : 'Tap to reveal management plan')
      + '</div>';
    actions.innerHTML = (revealed ? renderRatingAndNext('management') : '') + renderStepNav(true, revealed);
  }

  function renderNursing(note, card, actions) {
    var revealed = session.scenarioRevealed.nursing;
    var content = findSection(note, 'nursingConsiderations') || 'No nursing considerations section available.';
    var sKey = findSectionKey(note, 'nursingConsiderations');
    card.innerHTML =
      '<div class="scenario-label">Nursing Priorities</div>' +
      '<div class="scenario-prompt">What are your nursing priorities?</div>' +
      '<p class="scenario-body">Think monitoring parameters, assessment frequency, meds you\'re pushing or hanging, patient safety, and when to escalate to the provider.</p>' +
      '<div class="reveal-zone ' + (revealed ? 'revealed' : '') + '" onclick="CKB.reveal(\'nursing\')">' +
        (revealed ? summarizeSection(content, 8, session.conditionId, sKey) : 'Tap to reveal nursing priorities')
      + '</div>';
    actions.innerHTML = (revealed ? renderRatingAndNext('nursing') : '') + renderStepNav(true, revealed);
  }

  function renderScenarioPearls(note, card, actions) {
    var pearls = note.clinicalPearls || [];
    var html = '<div class="scenario-label">Clinical Pearls</div>' +
      '<div class="scenario-prompt">' + escapeHtml(note.title) + '</div>';
    if (pearls.length > 0) {
      var showPearls = pearls.slice(0, 4);
      showPearls.forEach(function (p) {
        html += '<div class="note-pearl">' + formatSection(p) + '</div>';
      });
      if (pearls.length > 4) {
        html += '<p style="font-size:13px;color:var(--text-muted);margin-top:8px">+ ' + (pearls.length - 4) + ' more pearls in full note</p>';
      }
    } else {
      html += '<p class="scenario-body" style="color:var(--text-muted)">No clinical pearls for this note yet.</p>';
    }

    // Show related notes
    var related = DB.graph[session.conditionId] || [];
    if (related.length > 0) {
      html += '<div style="margin-top:16px"><strong style="font-size:13px;color:var(--text-muted)">EXPLORE RELATED:</strong><div class="note-links">';
      related.slice(0, 8).forEach(function (rid) {
        if (DB.notes[rid]) {
          html += '<button class="note-link-chip" onclick="CKB.openNote(\'' + rid + '\')">' + escapeHtml(DB.notes[rid].title) + '</button>';
        }
      });
      html += '</div></div>';
    }
    card.innerHTML = html;

    // Overall confidence rating
    actions.innerHTML =
      '<p style="text-align:center;font-size:14px;color:var(--text-muted);margin-bottom:8px">How confident do you feel about <strong>' + escapeHtml(note.title) + '</strong>?</p>' +
      '<div class="rating-row">' +
        '<button class="rating-btn green" onclick="CKB.rateScenario(\'solid\')">Solid</button>' +
        '<button class="rating-btn amber" onclick="CKB.rateScenario(\'needs-review\')">Needs Review</button>' +
        '<button class="rating-btn red" onclick="CKB.rateScenario(\'study-more\')">Study More</button>' +
      '</div>' + renderStepNav(true, false);
  }

  function renderRatingAndNext(stepKey) {
    return '<div class="rating-row">' +
      '<button class="rating-btn green" onclick="CKB.rateStep(\'' + stepKey + '\',\'solid\')">Got it</button>' +
      '<button class="rating-btn amber" onclick="CKB.rateStep(\'' + stepKey + '\',\'partial\')">Partially</button>' +
      '<button class="rating-btn red" onclick="CKB.rateStep(\'' + stepKey + '\',\'missed\')">Missed it</button>' +
    '</div>';
  }

  function summarizeSection(text, maxLines, noteId, sectionKey) {
    if (!text) return '<em style="color:var(--text-muted)">No content available.</em>';
    var lines = text.split('\n');
    var kept = [];
    var count = 0;
    var charCount = 0;
    var maxChars = 500;
    for (var i = 0; i < lines.length && count < maxLines; i++) {
      var line = lines[i].trim();
      if (line === '' && kept.length === 0) continue;
      if (line === '' && count > 0) { kept.push(''); continue; }
      if (line.startsWith('|') && line.indexOf('---') !== -1) continue;
      if (charCount + line.length > maxChars && charCount > 0) break;
      kept.push(lines[i]);
      charCount += line.length;
      if (charCount >= maxChars) break;
      count++;
    }
    var summary = kept.join('\n').trim();
    if (summary.length > maxChars) {
      var cut = summary.lastIndexOf(' ', maxChars);
      if (cut < maxChars * 0.5) cut = maxChars;
      summary = summary.substring(0, cut) + '…';
    }
    var html = formatSection(summary);
    var truncated = text.length > summary.length + 20;
    if (truncated) {
      var onclick = sectionKey
        ? "CKB.openNote('" + noteId + "','" + sectionKey + "')"
        : "CKB.openNote('" + noteId + "')";
      html += '<br><button class="note-link-chip" style="margin-top:8px;font-size:13px" onclick="' + onclick + '">Read more &rarr;</button>';
    }
    return html;
  }

  function renderStepNav(showBack, showForward) {
    var html = '<div class="step-nav">';
    if (showBack) {
      html += '<button class="step-nav-btn" onclick="CKB.prevStep()">&larr; Back</button>';
    } else {
      html += '<span class="step-nav-spacer"></span>';
    }
    if (showForward) {
      html += '<button class="step-nav-btn" onclick="CKB.nextStep()">Skip &rarr;</button>';
    } else {
      html += '<span class="step-nav-spacer"></span>';
    }
    html += '</div>';
    return html;
  }

  // ==================== PHARM FLASH ====================
  function renderPharmFlash() {
    var note = DB.notes[session.pharmId];
    if (!note) { goToConceptCheck(); return; }

    var card = document.getElementById('pharm-card');
    var actions = document.getElementById('pharm-actions');
    var revealed = session.pharmRevealed;

    card.innerHTML =
      '<div class="flash-category pharm">Pharmacology</div>' +
      '<div class="flash-title">' + escapeHtml(note.title) + '</div>' +
      (note.drugClass ? '<p style="color:var(--text-muted);font-size:14px;margin-bottom:12px">' + escapeHtml(note.drugClass) + '</p>' : '') +
      '<div class="flash-question">Can you recall the mechanism of action, key drugs, and primary indications?</div>' +
      '<div class="reveal-zone ' + (revealed ? 'revealed' : '') + '" onclick="CKB.revealPharm()">' +
        (revealed
          ? (function() {
              var mechContent = findSection(note, 'mechanism');
              var indContent = findSection(note, 'indications');
              var drugContent = findSection(note, 'keyDrugs') || findSection(note, 'key-agents') || findSection(note, 'key-drug');
              return (mechContent ? '<strong>Mechanism:</strong><br>' + summarizeSection(mechContent, 8, session.pharmId, findSectionKey(note, 'mechanism')) + '<br><br>' : '') +
                (indContent ? '<strong>Indications:</strong><br>' + summarizeSection(indContent, 8, session.pharmId, findSectionKey(note, 'indications')) + '<br><br>' : '') +
                (drugContent ? '<strong>Key Drugs:</strong><br>' + summarizeSection(drugContent, 10, session.pharmId, findSectionKey(note, 'keyDrugs') || findSectionKey(note, 'key-agents') || findSectionKey(note, 'key-drug')) : '');
            })()
          : 'Tap to reveal')
      + '</div>';

    actions.innerHTML = (revealed
      ? '<div class="rating-row">' +
          '<button class="rating-btn green" onclick="CKB.ratePharm(\'solid\')">Solid</button>' +
          '<button class="rating-btn amber" onclick="CKB.ratePharm(\'needs-review\')">Needs Review</button>' +
          '<button class="rating-btn red" onclick="CKB.ratePharm(\'study-more\')">Study More</button>' +
        '</div>'
      : '') +
      '<div class="step-nav"><button class="step-nav-btn" onclick="CKB.backToScenario()">&larr; Back to Case</button><span class="step-nav-spacer"></span></div>';

    showView('pharm');
  }

  // ==================== CONCEPT CHECK ====================
  function goToConceptCheck() {
    var note = DB.notes[session.conceptId];
    if (!note) { goToPearls(); return; }

    var card = document.getElementById('concept-card');
    var actions = document.getElementById('concept-actions');
    session.conceptRevealed = false;

    renderConceptCard(note, card, actions);
    showView('concept');
  }

  function renderConceptCard(note, card, actions) {
    var revealed = session.conceptRevealed;
    card.innerHTML =
      '<div class="flash-category concept">First Principles</div>' +
      '<div class="flash-title">' + escapeHtml(note.title) + '</div>' +
      '<div class="flash-question">Explain this concept. How does it connect to clinical conditions you\'ve seen?</div>' +
      '<div class="reveal-zone ' + (revealed ? 'revealed' : '') + '" onclick="CKB.revealConcept()">' +
        (revealed
          ? (function() {
              var conceptContent = findSection(note, 'definition') || findSection(note, 'the-core-concept') || findSection(note, 'key-principles') || 'No definition available.';
              var conceptKey = findSectionKey(note, 'definition');
              if (!note.sections[conceptKey]) conceptKey = findSectionKey(note, 'the-core-concept');
              if (!note.sections[conceptKey]) conceptKey = findSectionKey(note, 'key-principles');
              return summarizeSection(conceptContent, 10, session.conceptId, conceptKey);
            })()
          : 'Tap to reveal')
      + '</div>';

    actions.innerHTML = (revealed
      ? '<div class="rating-row">' +
          '<button class="rating-btn green" onclick="CKB.rateConcept(\'solid\')">Solid</button>' +
          '<button class="rating-btn amber" onclick="CKB.rateConcept(\'needs-review\')">Needs Review</button>' +
          '<button class="rating-btn red" onclick="CKB.rateConcept(\'study-more\')">Study More</button>' +
        '</div>'
      : '') +
      '<div class="step-nav"><button class="step-nav-btn" onclick="CKB.backToPharm()">&larr; Back to Pharm</button><span class="step-nav-spacer"></span></div>';
  }

  // ==================== QUICK HITS (PEARLS) ====================
  function goToPearls() {
    session.pearlIndex = 0;
    renderPearlCard();
    showView('pearls');
  }

  function renderPearlCard() {
    var pearls = session.pearls;
    if (!pearls || session.pearlIndex >= pearls.length) {
      finishSession();
      return;
    }
    var p = pearls[session.pearlIndex];
    var card = document.getElementById('pearl-card');
    var actions = document.getElementById('pearl-actions');
    var revealed = session['pearl_' + session.pearlIndex + '_revealed'];

    card.innerHTML =
      '<div class="flash-category pearl">Quick Hit ' + (session.pearlIndex + 1) + ' of ' + pearls.length + '</div>' +
      '<div style="margin-bottom:16px">' +
        '<div class="note-pearl">' + formatSection(p.pearl) + '</div>' +
      '</div>' +
      '<div class="reveal-zone ' + (revealed ? 'revealed' : '') + '" onclick="CKB.revealPearl()">' +
        (revealed
          ? '<strong>From:</strong> ' + escapeHtml(p.noteTitle) + ' <span style="color:var(--text-muted)">(' + p.category + ')</span>' +
            '<br><button class="note-link-chip" style="margin-top:8px" onclick="CKB.openNote(\'' + p.noteId + '\')">' +
            'Open full note</button>'
          : 'Tap to see which note this is from')
      + '</div>';

    var backLabel = session.pearlIndex === 0 ? '&larr; Back to Concept' : '&larr; Previous Pearl';
    var backAction = session.pearlIndex === 0 ? 'CKB.backToConcept()' : 'CKB.prevPearl()';
    actions.innerHTML = (revealed
      ? '<button class="btn-primary" onclick="CKB.nextPearl()" style="margin-top:12px">' +
          (session.pearlIndex < pearls.length - 1 ? 'Next Pearl' : 'Finish Session') + '</button>'
      : '') +
      '<div class="step-nav"><button class="step-nav-btn" onclick="' + backAction + '">' + backLabel + '</button><span class="step-nav-spacer"></span></div>';
  }

  // ==================== SESSION COMPLETE ====================
  function finishSession() {
    var streak = completeSessionStreak();
    var card = document.getElementById('complete-card');

    // Count today's ratings
    var ratings = session.ratings || {};
    var ratingCounts = { solid: 0, partial: 0, missed: 0, 'needs-review': 0, 'study-more': 0 };
    Object.values(ratings).forEach(function (r) {
      if (ratingCounts[r] !== undefined) ratingCounts[r]++;
    });

    var condTitle = DB.notes[session.conditionId] ? DB.notes[session.conditionId].title : '—';
    var pharmTitle = DB.notes[session.pharmId] ? DB.notes[session.pharmId].title : '—';
    var conceptTitle = DB.notes[session.conceptId] ? DB.notes[session.conceptId].title : '—';

    card.innerHTML =
      '<div class="complete-icon">&#10003;</div>' +
      '<div class="complete-title">Session Complete</div>' +
      '<div class="complete-subtitle">Great work today!</div>' +
      '<div class="complete-stats">' +
        '<div class="stat-row"><span class="stat-label">Case</span><span class="stat-value">' + escapeHtml(condTitle) + '</span></div>' +
        '<div class="stat-row"><span class="stat-label">Pharm Flash</span><span class="stat-value">' + escapeHtml(pharmTitle) + '</span></div>' +
        '<div class="stat-row"><span class="stat-label">Concept Check</span><span class="stat-value">' + escapeHtml(conceptTitle) + '</span></div>' +
        '<div class="stat-row"><span class="stat-label">Quick Hits</span><span class="stat-value">' + session.pearls.length + ' pearls</span></div>' +
      '</div>' +
      '<div class="streak-display" style="margin-bottom:20px">' +
        '<div class="streak-number">' + streak.count + '</div>' +
        '<div class="streak-label">day streak</div>' +
      '</div>' +
      '<button class="btn-primary" onclick="CKB.showView(\'home\')">Done</button>';

    showView('complete');
  }

  // ==================== HOME VIEW ====================
  function renderHome() {
    if (!DB) return;

    document.getElementById('greeting').textContent = getDailyQuip();

    // Session summary
    var totalNotes = Object.keys(DB.notes).length;
    var seenCount = Object.keys(progress).filter(function (id) { return progress[id].lastSeen; }).length;
    var pct = Math.round((seenCount / totalNotes) * 100);
    document.getElementById('session-summary').textContent =
      'You\'ve studied ' + seenCount + ' of ' + totalNotes + ' notes (' + pct + '%)';

    // Button
    var btn = document.getElementById('btn-start-session');
    btn.onclick = startSession;

    // Stats
    var streak = getStreak();
    var confidenceCounts = { solid: 0, 'needs-review': 0, 'study-more': 0, unseen: 0 };
    Object.keys(DB.notes).forEach(function (id) {
      var p = progress[id];
      if (!p || !p.confidence) confidenceCounts.unseen++;
      else if (confidenceCounts[p.confidence] !== undefined) confidenceCounts[p.confidence]++;
      else confidenceCounts.unseen++;
    });

    document.getElementById('home-stats').innerHTML =
      '<div class="card">' +
        '<div class="stat-row"><span class="stat-label">Study streak</span><span class="stat-value">' + streak.count + ' days</span></div>' +
        '<div class="stat-row"><span class="stat-label">Solid</span><span class="stat-value" style="color:var(--green)">' + confidenceCounts.solid + '</span></div>' +
        '<div class="stat-row"><span class="stat-label">Needs review</span><span class="stat-value" style="color:var(--amber)">' + confidenceCounts['needs-review'] + '</span></div>' +
        '<div class="stat-row"><span class="stat-label">Study more</span><span class="stat-value" style="color:var(--red)">' + confidenceCounts['study-more'] + '</span></div>' +
        '<div class="stat-row"><span class="stat-label">Not yet seen</span><span class="stat-value">' + confidenceCounts.unseen + '</span></div>' +
      '</div>';
  }

  // ==================== PROGRESS DASHBOARD ====================
  function renderDashboard() {
    if (!DB) return;
    var html = '<div class="dash-title">Your Progress</div>';

    // Streak
    var streak = getStreak();
    html += '<div class="dash-section">' +
      '<div class="streak-display">' +
        '<div class="streak-number">' + streak.count + '</div>' +
        '<div class="streak-label">day study streak</div>' +
      '</div></div>';

    // Coverage by category
    html += '<div class="dash-section"><div class="dash-section-title">Coverage by Category</div>';
    ['Conditions', 'Pharmacology', 'Concepts', 'Systems', 'Procedures'].forEach(function (cat) {
      var ids = DB.categories[cat] || [];
      var seen = ids.filter(function (id) { return progress[id] && progress[id].lastSeen; }).length;
      var pct = ids.length > 0 ? Math.round((seen / ids.length) * 100) : 0;
      var color = pct > 70 ? 'green' : pct > 30 ? 'amber' : 'blue';
      html += '<div class="progress-bar-container">' +
        '<div class="progress-bar-label"><span>' + cat + '</span><span>' + seen + '/' + ids.length + '</span></div>' +
        '<div class="progress-bar"><div class="progress-bar-fill ' + color + '" style="width:' + pct + '%"></div></div>' +
      '</div>';
    });
    html += '</div>';

    // Confidence distribution
    var counts = { solid: 0, 'needs-review': 0, 'study-more': 0 };
    Object.values(progress).forEach(function (p) {
      if (p.confidence && counts[p.confidence] !== undefined) counts[p.confidence]++;
    });
    html += '<div class="dash-section"><div class="dash-section-title">Confidence Distribution</div>' +
      '<div class="confidence-grid">' +
        '<div class="confidence-box"><div class="confidence-number" style="color:var(--green)">' + counts.solid + '</div><div class="confidence-label">Solid</div></div>' +
        '<div class="confidence-box"><div class="confidence-number" style="color:var(--amber)">' + counts['needs-review'] + '</div><div class="confidence-label">Review</div></div>' +
        '<div class="confidence-box"><div class="confidence-number" style="color:var(--red)">' + counts['study-more'] + '</div><div class="confidence-label">Study More</div></div>' +
      '</div></div>';

    // Overdue notes (seen but not reviewed in 7+ days)
    var overdue = [];
    var now = Date.now();
    Object.keys(progress).forEach(function (id) {
      var p = progress[id];
      if (p.lastSeen) {
        var daysSince = Math.floor((now - new Date(p.lastSeen).getTime()) / 86400000);
        if (daysSince >= 7 && DB.notes[id]) {
          overdue.push({ id: id, title: DB.notes[id].title, days: daysSince, confidence: p.confidence });
        }
      }
    });
    overdue.sort(function (a, b) { return b.days - a.days; });

    if (overdue.length > 0) {
      html += '<div class="dash-section"><div class="dash-section-title">Due for Review (' + overdue.length + ')</div>';
      overdue.slice(0, 10).forEach(function (item) {
        var color = item.confidence === 'study-more' ? 'var(--red)' :
                    item.confidence === 'needs-review' ? 'var(--amber)' : 'var(--green)';
        html += '<div class="browse-item" onclick="CKB.openNote(\'' + item.id + '\')">' +
          '<div><div class="browse-item-title">' + escapeHtml(item.title) + '</div>' +
          '<div class="browse-item-cat">' + item.days + ' days ago</div></div>' +
          '<div class="browse-item-confidence" style="background:' + color + '"></div></div>';
      });
      html += '</div>';
    }

    document.getElementById('dashboard').innerHTML = html;
  }

  // ==================== BROWSE VIEW ====================
  function renderBrowse() {
    if (!DB) return;

    // Controls
    var controlsHtml = '<input type="text" class="browse-search" id="browse-search-input" placeholder="Search notes..." value="' + escapeHtml(browseSearch) + '">' +
      '<div class="browse-filters">';
    ['All', 'Conditions', 'Pharmacology', 'Concepts', 'Systems', 'Procedures'].forEach(function (f) {
      controlsHtml += '<button class="filter-chip ' + (browseFilter === f ? 'active' : '') + '" onclick="CKB.setBrowseFilter(\'' + f + '\')">' + f + '</button>';
    });
    controlsHtml += '</div>';
    document.getElementById('browse-controls').innerHTML = controlsHtml;

    // Add search listener
    setTimeout(function () {
      var input = document.getElementById('browse-search-input');
      if (input) {
        input.oninput = function () {
          browseSearch = input.value;
          renderBrowseList();
        };
      }
    }, 0);

    renderBrowseList();
  }

  function renderBrowseList() {
    var listHtml = '';
    var notes = Object.values(DB.notes);

    // Filter
    if (browseFilter !== 'All') {
      notes = notes.filter(function (n) { return n.category === browseFilter; });
    }
    if (browseSearch) {
      var q = browseSearch.toLowerCase();
      notes = notes.filter(function (n) {
        return n.title.toLowerCase().indexOf(q) !== -1 ||
          (n.aliases && n.aliases.some(function (a) { return a.toLowerCase().indexOf(q) !== -1; }));
      });
    }

    // Sort alphabetically
    notes.sort(function (a, b) { return a.title.localeCompare(b.title); });

    notes.forEach(function (note) {
      var p = progress[note.id] || {};
      var color = !p.confidence ? 'var(--border)' :
                  p.confidence === 'solid' ? 'var(--green)' :
                  p.confidence === 'needs-review' ? 'var(--amber)' : 'var(--red)';
      listHtml += '<div class="browse-item" onclick="CKB.openNote(\'' + note.id + '\')">' +
        '<div><div class="browse-item-title">' + escapeHtml(note.title) + '</div>' +
        '<div class="browse-item-cat">' + note.category + '</div></div>' +
        '<div class="browse-item-confidence" style="background:' + color + '"></div></div>';
    });

    if (notes.length === 0) {
      listHtml = '<p style="text-align:center;color:var(--text-muted);padding:20px">No notes found</p>';
    }

    document.getElementById('browse-list').innerHTML = listHtml;
  }

  // ==================== NOTE DETAIL VIEW ====================
  function openNote(noteId, scrollToSection) {
    var note = DB.notes[noteId];
    if (!note) return;

    var html = '<button class="note-back" onclick="CKB.goBack()">&larr; Back</button>';
    html += '<div class="note-title">' + escapeHtml(note.title) + '</div>';

    var metaParts = [note.category];
    if (note.system) metaParts.push(note.system);
    if (note.drugClass) metaParts.push(note.drugClass);
    if (note.edTriage) metaParts.push(note.edTriage);
    html += '<div class="note-meta">' + escapeHtml(metaParts.join(' \u00B7 ')) + '</div>';

    // Sections
    var sectionOrder = ['definition', 'epidemiology', 'pathophysiology', 'mechanism',
      'clinicalFeatures', 'diagnosis', 'indications', 'keyDrugs', 'receptorProfiles',
      'management', 'adverseEffects', 'contraindications', 'pharmacokinetics',
      'nursingConsiderations', 'keyPoints', 'anatomy', 'physiology', 'assessment'];
    var sectionLabels = {
      definition: 'Definition', epidemiology: 'Epidemiology', pathophysiology: 'Pathophysiology',
      mechanism: 'Mechanism of Action', clinicalFeatures: 'Clinical Features', diagnosis: 'Diagnosis',
      indications: 'Indications', keyDrugs: 'Key Drugs', receptorProfiles: 'Receptor Profiles',
      management: 'Management', adverseEffects: 'Adverse Effects', contraindications: 'Contraindications',
      pharmacokinetics: 'Pharmacokinetics', nursingConsiderations: 'Nursing Considerations',
      keyPoints: 'Key Points', anatomy: 'Anatomy', physiology: 'Physiology', assessment: 'Assessment'
    };

    // Show ordered sections first, then any remaining
    var shown = new Set();
    sectionOrder.forEach(function (key) {
      if (note.sections[key]) {
        html += '<div class="note-section" id="section-' + key + '">' +
          '<div class="note-section-title">' + (sectionLabels[key] || key) + '</div>' +
          '<div class="note-section-body">' + formatSection(note.sections[key]) + '</div></div>';
        shown.add(key);
      }
    });
    Object.keys(note.sections).forEach(function (key) {
      if (!shown.has(key)) {
        html += '<div class="note-section" id="section-' + key + '">' +
          '<div class="note-section-title">' + key.replace(/-/g, ' ') + '</div>' +
          '<div class="note-section-body">' + formatSection(note.sections[key]) + '</div></div>';
      }
    });

    // Clinical Pearls
    if (note.clinicalPearls && note.clinicalPearls.length > 0) {
      html += '<div class="note-section"><div class="note-section-title">Clinical Pearls</div>';
      note.clinicalPearls.forEach(function (p) {
        html += '<div class="note-pearl">' + formatSection(p) + '</div>';
      });
      html += '</div>';
    }

    // Related notes
    var related = DB.graph[noteId] || [];
    if (related.length > 0) {
      html += '<div class="note-section"><div class="note-section-title">Related Notes</div><div class="note-links">';
      related.forEach(function (rid) {
        if (DB.notes[rid]) {
          html += '<button class="note-link-chip" onclick="CKB.openNote(\'' + rid + '\')">' + escapeHtml(DB.notes[rid].title) + '</button>';
        }
      });
      html += '</div></div>';
    }

    document.getElementById('note-content').innerHTML = html;
    showView('note');
    // Scroll to the target section, or top if no section specified
    if (scrollToSection) {
      setTimeout(function () {
        var el = document.getElementById('section-' + scrollToSection);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          // Brief highlight to show where you landed
          el.style.background = 'var(--accent-bg, rgba(59,130,246,0.1))';
          setTimeout(function () { el.style.background = ''; }, 2000);
        }
      }, 50);
    } else {
      document.getElementById('main').scrollTop = 0;
    }
  }

  // ==================== DAILY QUIPS ====================
  var QUIPS = [
    "Your patients don't know how lucky they are.",
    "That lactate isn't going to trend itself.",
    "Somewhere, a med student is struggling with what you already know.",
    "You didn't survive nursing school to not know this stuff.",
    "15 minutes now, fewer blank stares at the whiteboard later.",
    "Be the nurse the night shift brags about.",
    "Every expert was once a beginner who didn't quit.",
    "The only bad study session is the one you skipped.",
    "Future you is going to crush that next code blue.",
    "You're not studying. You're sharpening weapons.",
    "Somewhere a attending is about to be impressed.",
    "Your brain called. It wants more pathophys.",
    "The raccoon believes in you. Don't let the raccoon down.",
    "One more session closer to knowing it cold.",
    "Think of this as pre-gaming for your next shift.",
    "Your stethoscope is judging you. Better study.",
    "Neurons that fire together wire together. Let's go.",
    "You know more than you think. Let's prove it.",
    "The ED doesn't care what you forgot. So don't forget it.",
    "Building clinical intuition, one scenario at a time.",
    "You showed up. That's already more than most.",
    "Your knowledge base has 234 notes. Your brain should too.",
    "Competence is a habit, not a talent.",
    "Less panic at the bedside starts right here.",
    "Today's session is tomorrow's instinct.",
    "Real learning feels uncomfortable. Lean in.",
    "You're not just memorizing. You're becoming dangerous.",
    "The sepsis clock is always ticking. Are you ready?",
    "Pharmacology won't learn itself. Unfortunately.",
    "Channel the energy of a nurse who just got a perfect IV stick.",
  ];

  function getDailyQuip() {
    // Use the date as seed so the quip changes daily but stays consistent throughout the day
    var today = new Date();
    var seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
    return QUIPS[seed % QUIPS.length];
  }

  // ==================== HELPERS ====================
  function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
  }

  function formatSection(text) {
    if (!text) return '';
    // Escape HTML first
    var escaped = escapeHtml(text);
    // Convert markdown bold
    escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Convert markdown italic
    escaped = escaped.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Convert markdown tables to simple display
    if (escaped.indexOf('|') !== -1) {
      var lines = escaped.split('\n');
      var inTable = false;
      var tableHtml = '';
      var result = [];
      lines.forEach(function (line) {
        if (line.trim().match(/^\|.*\|$/)) {
          if (line.trim().match(/^\|[\s-|]+\|$/)) return; // separator row
          if (!inTable) {
            inTable = true;
            tableHtml = '<table style="width:100%;font-size:13px;border-collapse:collapse;margin:8px 0">';
          }
          var cells = line.split('|').filter(function (c) { return c.trim(); });
          tableHtml += '<tr>';
          cells.forEach(function (c) {
            tableHtml += '<td style="padding:4px 8px;border-bottom:1px solid var(--border)">' + c.trim() + '</td>';
          });
          tableHtml += '</tr>';
        } else {
          if (inTable) {
            tableHtml += '</table>';
            result.push(tableHtml);
            inTable = false;
            tableHtml = '';
          }
          result.push(line);
        }
      });
      if (inTable) {
        tableHtml += '</table>';
        result.push(tableHtml);
      }
      escaped = result.join('\n');
    }
    // Convert newlines to breaks
    escaped = escaped.replace(/\n/g, '<br>');
    return escaped;
  }

  // ==================== PUBLIC API ====================
  window.CKB = {
    showView: showView,
    openNote: function(noteId, sectionKey) { openNote(noteId, sectionKey); },
    goBack: function () {
      showView(previousView || 'home');
    },
    setBrowseFilter: function (f) {
      browseFilter = f;
      renderBrowse();
    },
    reveal: function (key) {
      if (session.scenarioRevealed[key]) return;
      session.scenarioRevealed[key] = true;
      renderScenario();
    },
    revealPharm: function () {
      session.pharmRevealed = true;
      renderPharmFlash();
    },
    revealConcept: function () {
      session.conceptRevealed = true;
      var note = DB.notes[session.conceptId];
      var card = document.getElementById('concept-card');
      var actions = document.getElementById('concept-actions');
      renderConceptCard(note, card, actions);
    },
    revealPearl: function () {
      session['pearl_' + session.pearlIndex + '_revealed'] = true;
      renderPearlCard();
    },
    rateStep: function (stepKey, rating) {
      session.ratings[stepKey] = rating;
      session.scenarioStep++;
      if (session.scenarioStep <= 6) {
        renderScenario();
        document.getElementById('main').scrollTop = 0;
      }
    },
    rateScenario: function (confidence) {
      recordView(session.conditionId, confidence);
      // Move to pharm flash
      session.pharmRevealed = false;
      renderPharmFlash();
    },
    ratePharm: function (confidence) {
      recordView(session.pharmId, confidence);
      goToConceptCheck();
    },
    rateConcept: function (confidence) {
      recordView(session.conceptId, confidence);
      goToPearls();
    },
    nextPearl: function () {
      session.pearlIndex++;
      if (session.pearlIndex >= session.pearls.length) {
        finishSession();
      } else {
        renderPearlCard();
        document.getElementById('main').scrollTop = 0;
      }
    },
    nextStep: function () {
      session.scenarioStep++;
      renderScenario();
      document.getElementById('main').scrollTop = 0;
    },
    prevStep: function () {
      if (session.scenarioStep > 0) {
        session.scenarioStep--;
        renderScenario();
        document.getElementById('main').scrollTop = 0;
      }
    },
    backToScenario: function () {
      // Go back to last scenario step (pearls/step 6)
      session.scenarioStep = 6;
      renderScenario();
      showView('scenario');
      document.getElementById('main').scrollTop = 0;
    },
    backToPharm: function () {
      renderPharmFlash();
      document.getElementById('main').scrollTop = 0;
    },
    backToConcept: function () {
      var note = DB.notes[session.conceptId];
      if (note) {
        var card = document.getElementById('concept-card');
        var actions = document.getElementById('concept-actions');
        renderConceptCard(note, card, actions);
        showView('concept');
        document.getElementById('main').scrollTop = 0;
      }
    },
    prevPearl: function () {
      if (session.pearlIndex > 0) {
        session.pearlIndex--;
        renderPearlCard();
        document.getElementById('main').scrollTop = 0;
      }
    },
  };

  // ==================== BOOT ====================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
