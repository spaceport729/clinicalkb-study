/* ClinicalKB Study v2 — 6-Mode Study App */

(function () {
  'use strict';

  var DB = null;
  var STUDY = null;
  var progress = {};
  var searchIndex = {};
  var currentView = 'home';
  var previousView = 'home';
  var browseFilter = 'All';
  var browseSearch = '';
  var todaySelections = null;
  var codeState = null;

  var STORAGE_KEY = 'clinicalkb-progress';
  var SELECTIONS_KEY = 'clinicalkb-selections-v2';
  var STREAK_KEY = 'clinicalkb-streak';
  var DARK_KEY = 'clinicalkb-dark';
  var COOLDOWN_DAYS = 3;

  // ==================== INIT ====================
  async function init() {
    loadProgress();
    loadDarkMode();
    try {
      var resp = await fetch('data.json');
      DB = await resp.json();
      var resp2 = await fetch('study.json');
      STUDY = await resp2.json();
      buildSearchIndex();
      pickTodaySelections();
      renderHome();
      setupNav();
      setupDarkToggle();
    } catch (e) {
      document.getElementById('main').innerHTML =
        '<div style="padding:40px 20px;text-align:center">' +
        '<p style="font-size:16px;font-weight:600">Could not load data</p>' +
        '<p style="color:var(--text-muted);margin-top:8px">' + escapeHtml(e.message) + '</p></div>';
    }
  }

  // ==================== STORAGE ====================
  function loadProgress() {
    try { progress = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch (e) { progress = {}; }
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
    var p = getNoteProgress(noteId);
    p.lastSeen = todayStr();
    p.timesSeen++;
    if (confidence) {
      p.streak = (confidence === 'solid' && p.confidence === 'solid') ? p.streak + 1 :
                 (confidence === 'solid') ? 1 : 0;
      p.confidence = confidence;
    }
    saveProgress();
  }

  function markSeen(noteId) {
    if (!noteId) return;
    var p = getNoteProgress(noteId);
    if (p.lastSeen !== todayStr()) {
      p.lastSeen = todayStr();
      p.timesSeen++;
      saveProgress();
    }
  }

  function todayStr() { return new Date().toISOString().slice(0, 10); }

  function getStreak() {
    try {
      var data = JSON.parse(localStorage.getItem(STREAK_KEY)) || { count: 0, lastDate: null };
      var today = todayStr();
      var yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      if (data.lastDate === today) return data;
      if (data.lastDate === yesterday) return data;
      if (data.lastDate && data.lastDate < yesterday) return { count: 0, lastDate: data.lastDate };
      return data;
    } catch (e) { return { count: 0, lastDate: null }; }
  }

  function bumpStreak() {
    var today = todayStr();
    var streak = getStreak();
    var yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (streak.lastDate === today) return streak;
    streak.count = (streak.lastDate === yesterday) ? streak.count + 1 : 1;
    streak.lastDate = today;
    localStorage.setItem(STREAK_KEY, JSON.stringify(streak));
    return streak;
  }

  // ==================== DARK MODE ====================
  function loadDarkMode() {
    var dark = localStorage.getItem(DARK_KEY);
    if (dark === 'true' || (!dark && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.body.classList.add('dark');
    }
  }

  function setupDarkToggle() {
    document.getElementById('dark-toggle').addEventListener('click', function () {
      document.body.classList.toggle('dark');
      localStorage.setItem(DARK_KEY, document.body.classList.contains('dark'));
      updateDarkIcon();
    });
    updateDarkIcon();
  }

  function updateDarkIcon() {
    document.getElementById('dark-icon').textContent = document.body.classList.contains('dark') ? '☀' : '☾';
  }

  // ==================== NAVIGATION ====================
  function setupNav() {
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { showView(btn.dataset.view); });
    });
  }

  function showView(viewName) {
    previousView = currentView;
    currentView = viewName;
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    var el = document.getElementById('view-' + viewName);
    if (el) el.classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === viewName);
    });

    var titles = {
      home: 'ClinicalKB Study', presentation: 'Presentation', condition: 'Condition',
      anatomy: 'A&P', medclass: 'Med Class', principle: 'Principle', code: 'Code',
      progress: 'Progress', browse: 'Browse', note: 'Note Detail'
    };
    document.getElementById('topbar-title').textContent = titles[viewName] || 'ClinicalKB Study';

    var backBtn = document.getElementById('topbar-back');
    if (backBtn) backBtn.style.display = (viewName === 'note') ? 'block' : 'none';

    if (viewName === 'home') renderHome();
    if (viewName === 'progress') renderDashboard();
    if (viewName === 'browse') renderBrowse();

    document.getElementById('main').scrollTop = 0;
  }

  // ==================== SPACED REPETITION ====================
  function getDaySeed(salt) {
    var today = new Date();
    var base = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
    var h = base;
    if (salt) {
      for (var i = 0; i < salt.length; i++) {
        h = ((h << 5) - h + salt.charCodeAt(i)) | 0;
      }
    }
    return Math.abs(h);
  }

  function seededShuffle(arr, seed) {
    var s = seed;
    function next() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
    var copy = arr.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(next() * (i + 1));
      var tmp = copy[i]; copy[i] = copy[j]; copy[j] = tmp;
    }
    return copy;
  }

  function selectFromPool(pool, salt) {
    if (!pool || pool.length === 0) return null;
    var scored = pool.map(function (item) {
      var id = item.id || item;
      var p = progress[id] || {};
      var daysSince = p.lastSeen ? Math.floor((Date.now() - new Date(p.lastSeen).getTime()) / 86400000) : 999;
      var score = daysSince;
      if (!p.lastSeen) score += 100;
      if (p.confidence === 'needs-review') score += 20;
      if (p.confidence === 'study-more') score += 40;
      if (daysSince < COOLDOWN_DAYS) score = -1;
      return { item: item, score: score };
    });
    var eligible = scored.filter(function (s) { return s.score > 0; });
    if (eligible.length === 0) eligible = scored;
    eligible.sort(function (a, b) { return b.score - a.score; });
    var top = eligible.slice(0, Math.min(10, eligible.length));
    var picked = top[getDaySeed(salt) % top.length];
    return picked.item;
  }

  // ==================== TODAY'S SELECTIONS ====================
  function pickTodaySelections() {
    try {
      var saved = JSON.parse(localStorage.getItem(SELECTIONS_KEY));
      if (saved && saved.date === todayStr()) { todaySelections = saved; return; }
    } catch (e) {}

    var condition = selectFromPool(STUDY.conditions, 'condition');
    var anatomy = condition ? STUDY.anatomy.find(function (a) { return a.id === condition.system; }) : STUDY.anatomy[0];
    var medclass = condition ? STUDY.medications.find(function (m) { return m.id === condition.medClass; }) : STUDY.medications[0];
    var presentation = selectFromPool(STUDY.presentations, 'presentation');
    var principle = selectFromPool(STUDY.principles, 'principle');
    var code = selectFromPool(STUDY.codes, 'code');

    todaySelections = {
      date: todayStr(),
      conditionId: condition ? condition.id : null,
      anatomyId: anatomy ? anatomy.id : null,
      medclassId: medclass ? medclass.id : null,
      presentationId: presentation ? presentation.id : null,
      principleId: principle ? principle.id : null,
      codeId: code ? code.id : null
    };
    localStorage.setItem(SELECTIONS_KEY, JSON.stringify(todaySelections));
  }

  function getStudyItem(pool, id) {
    if (!pool || !id) return null;
    return pool.find(function (item) { return item.id === id; }) || null;
  }

  // ==================== HOME ====================
  function renderHome() {
    if (!DB || !STUDY) return;

    var streak = getStreak();
    var totalStudy = STUDY.conditions.length + STUDY.presentations.length + STUDY.principles.length + STUDY.codes.length;
    var seenCount = 0;
    [STUDY.conditions, STUDY.presentations, STUDY.principles, STUDY.codes].forEach(function (pool) {
      pool.forEach(function (item) { if (progress[item.id] && progress[item.id].lastSeen) seenCount++; });
    });

    var statsHtml = '<div class="home-stats-compact">';
    statsHtml += '<span class="home-stat">' + streak.count + ' day streak</span>';
    statsHtml += '<span class="home-stat-sep">&middot;</span>';
    statsHtml += '<span class="home-stat">' + seenCount + '/' + totalStudy + ' studied</span>';
    statsHtml += '</div>';
    document.getElementById('home-stats-row').innerHTML = statsHtml;

    var condition = getStudyItem(STUDY.conditions, todaySelections.conditionId);
    var anatomy = getStudyItem(STUDY.anatomy, todaySelections.anatomyId);
    var medclass = getStudyItem(STUDY.medications, todaySelections.medclassId);
    var presentation = getStudyItem(STUDY.presentations, todaySelections.presentationId);
    var principle = getStudyItem(STUDY.principles, todaySelections.principleId);
    var code = getStudyItem(STUDY.codes, todaySelections.codeId);

    var modes = [
      { key: 'presentation', label: 'Presentation', sub: presentation ? presentation.chiefComplaint : 'None available', color: 'var(--accent)', icon: '&#128203;' },
      { key: 'condition', label: 'Condition', sub: condition ? condition.title : 'None available', color: 'var(--red)', icon: '&#129657;' },
      { key: 'anatomy', label: 'A&P', sub: anatomy ? anatomy.title : 'None available', color: 'var(--green)', icon: '&#129516;', trio: true },
      { key: 'medclass', label: 'Med Class', sub: medclass ? medclass.title : 'None available', color: 'var(--green)', icon: '&#128138;', trio: true },
      { key: 'principle', label: 'Principle', sub: principle ? principle.title : 'None available', color: 'var(--amber)', icon: '&#9889;' },
      { key: 'code', label: 'Code', sub: code ? code.title : 'None available', color: 'var(--red)', icon: '&#9888;' }
    ];

    var gridHtml = '';
    modes.forEach(function (m, idx) {
      var trioClass = m.trio ? ' home-card-trio' : '';
      var done = progress[todaySelections[m.key + 'Id']];
      var doneToday = done && done.lastSeen === todayStr();
      var checkmark = doneToday ? '<span class="home-card-check">&#10003;</span>' : '';
      gridHtml += '<button class="home-card' + trioClass + (doneToday ? ' home-card-done' : '') + '" onclick="CKB.startMode(\'' + m.key + '\')">' +
        checkmark +
        '<div class="home-card-icon" style="color:' + m.color + '">' + m.icon + '</div>' +
        '<div class="home-card-label">' + m.label + '</div>' +
        '<div class="home-card-sub">' + escapeHtml(m.sub) + '</div>' +
        '</button>';
    });

    document.getElementById('home-grid').innerHTML = gridHtml;
  }

  // ==================== PRESENTATION MODE ====================
  function renderPresentation() {
    var item = getStudyItem(STUDY.presentations, todaySelections.presentationId);
    if (!item) { document.getElementById('presentation-content').innerHTML = '<p style="padding:20px;color:var(--text-muted)">No presentations authored yet.</p>'; return; }

    var html = '<div class="mode-header presentation">' +
      '<div class="mode-label">PRESENTATION</div>' +
      '<div class="mode-title">' + escapeHtml(item.chiefComplaint) + '</div>' +
      '</div>';

    html += '<div class="arrival-card">' +
      '<div class="arrival-label">ARRIVAL</div>' +
      '<div class="arrival-text">' + escapeHtml(item.arrival) + '</div>' +
      '</div>';

    html += '<div class="diff-label">DIFFERENTIAL</div>';

    item.differentials.forEach(function (diff, idx) {
      var expanded = document.querySelector('[data-diff="' + idx + '"].diff-expanded');
      html += '<div class="diff-card" data-diff="' + idx + '">' +
        '<button class="diff-header" onclick="CKB.toggleDiff(' + idx + ')">' +
        '<span class="diff-name">' + escapeHtml(diff.diagnosis) + '</span>' +
        '<span class="diff-arrow" id="diff-arrow-' + idx + '">&#9654;</span>' +
        '</button>' +
        '<div class="diff-body" id="diff-body-' + idx + '" style="display:none">';

      html += '<div class="diff-section"><div class="diff-section-label">DISTINGUISHING FEATURES</div>' +
        '<p class="diff-text">' + escapeHtml(diff.distinguishing) + '</p></div>';

      html += '<div class="diff-section"><div class="diff-section-label">DIAGNOSTICS</div>';
      diff.diagnostics.forEach(function (dx) {
        html += '<div class="dx-row">' +
          '<div class="dx-test">' + escapeHtml(dx.test) + '</div>' +
          '<div class="dx-looking">' + escapeHtml(dx.lookingFor) + '</div>' +
          (dx.noteId && DB.notes[dx.noteId] ? '<button class="note-link-chip" onclick="CKB.openNote(\'' + dx.noteId + '\')">' + escapeHtml(DB.notes[dx.noteId].title) + '</button>' : '') +
          '</div>';
      });
      html += '</div>';

      html += '<div class="diff-section"><div class="diff-section-label">TREATMENTS</div>';
      diff.treatments.forEach(function (tx) {
        var name = tx.med || tx.intervention;
        html += '<div class="tx-row">' +
          '<div class="tx-name">' + escapeHtml(name) + '</div>' +
          '<div class="tx-why">' + escapeHtml(tx.why) + '</div>' +
          (tx.noteId && DB.notes[tx.noteId] ? '<button class="note-link-chip" onclick="CKB.openNote(\'' + tx.noteId + '\')">' + escapeHtml(DB.notes[tx.noteId].title) + '</button>' : '') +
          '</div>';
      });
      html += '</div>';

      if (diff.conditionId && DB.notes[diff.conditionId]) {
        html += '<button class="note-link-chip" style="margin-top:8px" onclick="CKB.openNote(\'' + diff.conditionId + '\')">Full note: ' + escapeHtml(DB.notes[diff.conditionId].title) + ' &rarr;</button>';
      }

      html += '</div></div>';
    });

    html += '<div class="mode-nav"><button class="step-nav-btn" onclick="CKB.showView(\'home\')">&larr; Home</button></div>';

    document.getElementById('presentation-content').innerHTML = html;
    showView('presentation');
  }

  // ==================== CONDITION MODE ====================
  function renderCondition() {
    var item = getStudyItem(STUDY.conditions, todaySelections.conditionId);
    if (!item) { document.getElementById('condition-content').innerHTML = '<p style="padding:20px;color:var(--text-muted)">No conditions authored yet.</p>'; return; }

    var sections = [
      { key: 'overview', label: 'Overview' },
      { key: 'pathophysiology', label: 'Pathophysiology' },
      { key: 'keyFeatures', label: 'Key Features' },
      { key: 'management', label: 'Management' },
      { key: 'nursingPriorities', label: 'Nursing Priorities' }
    ];

    var html = '<div class="mode-header condition">' +
      '<div class="mode-label">CONDITION</div>' +
      '<div class="mode-title">' + escapeHtml(item.title) + '</div>' +
      '</div>';

    sections.forEach(function (sec) {
      if (!item[sec.key]) return;
      html += '<div class="reveal-section">' +
        '<button class="reveal-header" onclick="CKB.toggleReveal(this)">' +
        '<span>' + sec.label + '</span><span class="reveal-arrow">&#9654;</span></button>' +
        '<div class="reveal-body" style="display:none">' + formatSection(item[sec.key]) + '</div></div>';
    });

    if (item.pearls && item.pearls.length > 0) {
      html += '<div class="reveal-section">' +
        '<button class="reveal-header" onclick="CKB.toggleReveal(this)">' +
        '<span>Clinical Pearls</span><span class="reveal-arrow">&#9654;</span></button>' +
        '<div class="reveal-body" style="display:none">';
      item.pearls.forEach(function (p) {
        html += '<div class="note-pearl">' + formatSection(p) + '</div>';
      });
      html += '</div></div>';
    }

    if (DB.notes[item.id]) {
      html += '<button class="note-link-chip" style="margin-top:12px" onclick="CKB.openNote(\'' + item.id + '\')">Full vault note &rarr;</button>';
    }

    html += renderModeRating('condition', item.id);
    html += '<div class="mode-nav"><button class="step-nav-btn" onclick="CKB.showView(\'home\')">&larr; Home</button></div>';

    document.getElementById('condition-content').innerHTML = html;
    showView('condition');
  }

  // ==================== A&P MODE ====================
  function renderAnatomy() {
    var item = getStudyItem(STUDY.anatomy, todaySelections.anatomyId);
    if (!item) { document.getElementById('anatomy-content').innerHTML = '<p style="padding:20px;color:var(--text-muted)">No A&P entries authored yet.</p>'; return; }

    var condition = getStudyItem(STUDY.conditions, todaySelections.conditionId);

    var sections = [
      { key: 'keyStructures', label: 'Key Structures' },
      { key: 'normalPhysiology', label: 'Normal Physiology' },
      { key: 'clinicalAssessment', label: 'Clinical Assessment' },
      { key: 'labValues', label: 'Lab Values' },
      { key: 'clinicalConnection', label: condition ? 'Connection: ' + condition.title : 'Clinical Connection' }
    ];

    var html = '<div class="mode-header anatomy">' +
      '<div class="mode-label">A&P</div>' +
      '<div class="mode-title">' + escapeHtml(item.title) + '</div>' +
      (condition ? '<div class="mode-subtitle">Linked to today\'s condition: ' + escapeHtml(condition.title) + '</div>' : '') +
      '</div>';

    sections.forEach(function (sec) {
      if (!item[sec.key]) return;
      html += '<div class="reveal-section">' +
        '<button class="reveal-header" onclick="CKB.toggleReveal(this)">' +
        '<span>' + sec.label + '</span><span class="reveal-arrow">&#9654;</span></button>' +
        '<div class="reveal-body" style="display:none">' + formatSection(item[sec.key]) + '</div></div>';
    });

    if (DB.notes[item.id]) {
      html += '<button class="note-link-chip" style="margin-top:12px" onclick="CKB.openNote(\'' + item.id + '\')">Full vault note &rarr;</button>';
    }

    html += renderModeRating('anatomy', item.id);
    html += '<div class="mode-nav"><button class="step-nav-btn" onclick="CKB.showView(\'home\')">&larr; Home</button></div>';

    document.getElementById('anatomy-content').innerHTML = html;
    showView('anatomy');
  }

  // ==================== MED CLASS MODE ====================
  function renderMedClass() {
    var item = getStudyItem(STUDY.medications, todaySelections.medclassId);
    if (!item) { document.getElementById('medclass-content').innerHTML = '<p style="padding:20px;color:var(--text-muted)">No med classes authored yet.</p>'; return; }

    var condition = getStudyItem(STUDY.conditions, todaySelections.conditionId);

    var html = '<div class="mode-header medclass">' +
      '<div class="mode-label">MED CLASS</div>' +
      '<div class="mode-title">' + escapeHtml(item.title) + '</div>' +
      (condition ? '<div class="mode-subtitle">Linked to today\'s condition: ' + escapeHtml(condition.title) + '</div>' : '') +
      '</div>';

    // MOA
    html += '<div class="reveal-section">' +
      '<button class="reveal-header" onclick="CKB.toggleReveal(this)">' +
      '<span>Mechanism of Action</span><span class="reveal-arrow">&#9654;</span></button>' +
      '<div class="reveal-body" style="display:none">' + formatSection(item.moa) + '</div></div>';

    // FDA Uses
    if (item.fdaUses && item.fdaUses.length > 0) {
      html += '<div class="reveal-section">' +
        '<button class="reveal-header" onclick="CKB.toggleReveal(this)">' +
        '<span>FDA-Approved Uses</span><span class="reveal-arrow">&#9654;</span></button>' +
        '<div class="reveal-body" style="display:none"><ul class="md-ul">';
      item.fdaUses.forEach(function (u) { html += '<li>' + escapeHtml(u) + '</li>'; });
      html += '</ul></div></div>';
    }

    // Non-FDA Uses
    if (item.nonFdaUses && item.nonFdaUses.length > 0) {
      html += '<div class="reveal-section">' +
        '<button class="reveal-header" onclick="CKB.toggleReveal(this)">' +
        '<span>Off-Label / Non-FDA Uses</span><span class="reveal-arrow">&#9654;</span></button>' +
        '<div class="reveal-body" style="display:none"><ul class="md-ul">';
      item.nonFdaUses.forEach(function (u) { html += '<li>' + escapeHtml(u) + '</li>'; });
      html += '</ul></div></div>';
    }

    // ED Drugs
    if (item.edDrugs && item.edDrugs.length > 0) {
      html += '<div class="reveal-section">' +
        '<button class="reveal-header" onclick="CKB.toggleReveal(this)">' +
        '<span>ED Drugs You\'ll Use</span><span class="reveal-arrow">&#9654;</span></button>' +
        '<div class="reveal-body" style="display:none">';
      item.edDrugs.forEach(function (drug) {
        html += '<div class="drug-card">' +
          '<div class="drug-name">' + escapeHtml(drug.name) + '</div>' +
          '<div class="drug-dose">' + escapeHtml(drug.dose) + '</div>' +
          '<div class="drug-why">' + escapeHtml(drug.why) + '</div>' +
          '</div>';
      });
      html += '</div></div>';
    }

    // Adverse Effects
    if (item.adverseEffects) {
      html += '<div class="reveal-section">' +
        '<button class="reveal-header" onclick="CKB.toggleReveal(this)">' +
        '<span>Adverse Effects</span><span class="reveal-arrow">&#9654;</span></button>' +
        '<div class="reveal-body" style="display:none">' + formatSection(item.adverseEffects) + '</div></div>';
    }

    // Nursing Considerations
    if (item.nursingConsiderations) {
      html += '<div class="reveal-section">' +
        '<button class="reveal-header" onclick="CKB.toggleReveal(this)">' +
        '<span>Nursing Considerations</span><span class="reveal-arrow">&#9654;</span></button>' +
        '<div class="reveal-body" style="display:none">' + formatSection(item.nursingConsiderations) + '</div></div>';
    }

    if (DB.notes[item.id]) {
      html += '<button class="note-link-chip" style="margin-top:12px" onclick="CKB.openNote(\'' + item.id + '\')">Full vault note &rarr;</button>';
    }

    html += renderModeRating('medclass', item.id);
    html += '<div class="mode-nav"><button class="step-nav-btn" onclick="CKB.showView(\'home\')">&larr; Home</button></div>';

    document.getElementById('medclass-content').innerHTML = html;
    showView('medclass');
  }

  // ==================== PRINCIPLE MODE ====================
  function renderPrinciple() {
    var item = getStudyItem(STUDY.principles, todaySelections.principleId);
    if (!item) { document.getElementById('principle-content').innerHTML = '<p style="padding:20px;color:var(--text-muted)">No principles authored yet.</p>'; return; }

    var sections = [
      { key: 'theCore', label: 'The Core Idea' },
      { key: 'howItWorks', label: 'How It Works' },
      { key: 'clinicalConnection', label: 'Clinical Connection' },
      { key: 'atTheBedside', label: 'At the Bedside' }
    ];

    var html = '<div class="mode-header principle">' +
      '<div class="mode-label">PRINCIPLE</div>' +
      '<div class="mode-title">' + escapeHtml(item.title) + '</div>' +
      '</div>';

    sections.forEach(function (sec) {
      if (!item[sec.key]) return;
      html += '<div class="reveal-section">' +
        '<button class="reveal-header" onclick="CKB.toggleReveal(this)">' +
        '<span>' + sec.label + '</span><span class="reveal-arrow">&#9654;</span></button>' +
        '<div class="reveal-body" style="display:none">' + formatSection(item[sec.key]) + '</div></div>';
    });

    // Linked conditions and meds
    var chips = [];
    (item.linkedConditions || []).forEach(function (id) {
      if (DB.notes[id]) chips.push({ id: id, title: DB.notes[id].title, color: '' });
    });
    (item.linkedMeds || []).forEach(function (id) {
      if (DB.notes[id]) chips.push({ id: id, title: DB.notes[id].title, color: 'style="border-color:var(--green);color:var(--green)"' });
    });
    if (chips.length > 0) {
      html += '<div style="margin-top:16px"><div class="diff-section-label">CONNECTED NOTES</div><div class="note-links">';
      chips.forEach(function (c) {
        html += '<button class="note-link-chip" ' + c.color + ' onclick="CKB.openNote(\'' + c.id + '\')">' + escapeHtml(c.title) + '</button>';
      });
      html += '</div></div>';
    }

    if (DB.notes[item.id]) {
      html += '<button class="note-link-chip" style="margin-top:12px" onclick="CKB.openNote(\'' + item.id + '\')">Full vault note &rarr;</button>';
    }

    html += renderModeRating('principle', item.id);
    html += '<div class="mode-nav"><button class="step-nav-btn" onclick="CKB.showView(\'home\')">&larr; Home</button></div>';

    document.getElementById('principle-content').innerHTML = html;
    showView('principle');
  }

  // ==================== CODE MODE ====================
  function renderCode() {
    var item = getStudyItem(STUDY.codes, todaySelections.codeId);
    if (!item) { document.getElementById('code-content').innerHTML = '<p style="padding:20px;color:var(--text-muted)">No code scenarios authored yet.</p>'; return; }

    if (!codeState || codeState.id !== item.id) {
      codeState = { id: item.id, step: 0, answers: [], revealed: false };
    }

    var html = '<div class="mode-header code">' +
      '<div class="mode-label">CODE</div>' +
      '<div class="mode-title">' + escapeHtml(item.title) + '</div>' +
      '</div>';

    html += '<div class="code-scenario">' + escapeHtml(item.scenario) + '</div>';

    // Progress dots
    html += '<div class="scenario-progress">';
    item.steps.forEach(function (s, i) {
      var cls = i < codeState.step ? 'done' : (i === codeState.step ? 'current' : '');
      html += '<div class="progress-dot ' + cls + '"></div>';
    });
    html += '</div>';

    if (codeState.step >= item.steps.length) {
      // Complete
      var correct = codeState.answers.filter(function (a) { return a; }).length;
      html += '<div class="code-complete">' +
        '<div class="code-score">' + correct + '/' + item.steps.length + ' correct</div>' +
        '<p style="color:var(--text-muted);margin-top:8px">' +
        (correct === item.steps.length ? 'Perfect. You know this algorithm.' :
         correct >= item.steps.length * 0.6 ? 'Solid foundation. Review the ones you missed.' :
         'Keep drilling this one. The algorithm needs to be automatic.') + '</p>' +
        '</div>';
      html += renderModeRating('code', item.id);
      html += '<button class="btn-secondary" style="margin-top:12px" onclick="CKB.resetCode()">Try Again</button>';
    } else {
      var step = item.steps[codeState.step];
      html += '<div class="code-prompt">' + escapeHtml(step.prompt) + '</div>';

      step.options.forEach(function (opt, oi) {
        var answered = codeState.revealed;
        var selected = codeState.selectedOption === oi;
        var cls = 'code-option';
        if (answered) {
          if (opt.correct) cls += ' code-correct';
          else if (selected && !opt.correct) cls += ' code-wrong';
          else cls += ' code-dim';
        }
        html += '<button class="' + cls + '" ' +
          (answered ? '' : 'onclick="CKB.answerCode(' + oi + ')"') + '>' +
          escapeHtml(opt.text) + '</button>';

        if (answered && (selected || opt.correct)) {
          html += '<div class="code-feedback ' + (opt.correct ? 'correct' : 'wrong') + '">' + escapeHtml(opt.feedback) + '</div>';
        }
      });

      if (codeState.revealed) {
        html += '<button class="btn-primary" style="margin-top:16px" onclick="CKB.nextCodeStep()">Next &rarr;</button>';
      }
    }

    html += '<div class="mode-nav"><button class="step-nav-btn" onclick="CKB.showView(\'home\')">&larr; Home</button></div>';

    document.getElementById('code-content').innerHTML = html;
    showView('code');
  }

  // ==================== SHARED: RATING ====================
  function renderModeRating(mode, noteId) {
    if (!noteId) return '';
    var p = progress[noteId] || {};
    if (p.lastSeen === todayStr() && p.confidence) {
      return '<div class="rating-done">Rated: <strong>' + p.confidence.replace('-', ' ') + '</strong></div>';
    }
    return '<div class="rating-section">' +
      '<p class="rating-prompt">How confident do you feel?</p>' +
      '<div class="rating-row">' +
      '<button class="rating-btn green" onclick="CKB.rate(\'' + mode + '\',\'' + noteId + '\',\'solid\')">Solid</button>' +
      '<button class="rating-btn amber" onclick="CKB.rate(\'' + mode + '\',\'' + noteId + '\',\'needs-review\')">Review</button>' +
      '<button class="rating-btn red" onclick="CKB.rate(\'' + mode + '\',\'' + noteId + '\',\'study-more\')">Study More</button>' +
      '</div></div>';
  }

  // ==================== SEARCH INDEX ====================
  function buildSearchIndex() {
    Object.keys(DB.notes).forEach(function (id) {
      var note = DB.notes[id];
      var parts = [note.title.toLowerCase()];
      if (note.aliases) note.aliases.forEach(function (a) { parts.push(a.toLowerCase()); });
      Object.values(note.sections).forEach(function (s) { parts.push(s.toLowerCase()); });
      if (note.clinicalPearls) note.clinicalPearls.forEach(function (p) { parts.push(p.toLowerCase()); });
      searchIndex[id] = parts.join(' ');
    });
  }

  // ==================== BROWSE VIEW ====================
  function renderBrowse() {
    if (!DB) return;
    var controlsHtml = '<input type="text" class="browse-search" id="browse-search-input" placeholder="Search notes..." value="' + escapeHtml(browseSearch) + '">' +
      '<div class="browse-filters">';
    ['All', 'Conditions', 'Pharmacology', 'Concepts', 'Systems', 'Procedures', 'Diagnostics', 'Chief Complaints'].forEach(function (f) {
      controlsHtml += '<button class="filter-chip ' + (browseFilter === f ? 'active' : '') + '" onclick="CKB.setBrowseFilter(\'' + f + '\')">' + f + '</button>';
    });
    controlsHtml += '</div>';
    document.getElementById('browse-controls').innerHTML = controlsHtml;

    setTimeout(function () {
      var input = document.getElementById('browse-search-input');
      if (input) {
        input.oninput = function () { browseSearch = input.value; renderBrowseList(); };
      }
    }, 0);

    renderBrowseList();
  }

  function renderBrowseList() {
    var notes = Object.values(DB.notes);
    if (browseFilter !== 'All') {
      notes = notes.filter(function (n) { return n.category === browseFilter; });
    }
    if (browseSearch) {
      var q = browseSearch.toLowerCase();
      notes = notes.filter(function (n) {
        return searchIndex[n.id] && searchIndex[n.id].indexOf(q) !== -1;
      });
    }
    notes.sort(function (a, b) { return a.title.localeCompare(b.title); });

    var html = '';

    if (browseSearch && browseSearch.length >= 2 && STUDY && STUDY.drugs) {
      var q = browseSearch.toLowerCase();
      var matchedDrugs = STUDY.drugs.filter(function (d) {
        return d.name.toLowerCase().indexOf(q) !== -1 ||
               d.brand.toLowerCase().indexOf(q) !== -1;
      });
      if (matchedDrugs.length > 0) {
        matchedDrugs.forEach(function (drug) {
          html += '<div class="drug-lookup-card">' +
            '<div class="drug-lookup-header">' +
            '<div class="drug-lookup-name">' + escapeHtml(drug.name) + '</div>' +
            '<div class="drug-lookup-brand">' + escapeHtml(drug.brand) + '</div>' +
            '</div>' +
            '<div class="drug-lookup-class">' + escapeHtml(drug.class) + '</div>' +
            '<div class="drug-lookup-row"><span class="drug-lookup-label">Dose</span>' + escapeHtml(drug.dose) + '</div>' +
            '<div class="drug-lookup-row"><span class="drug-lookup-label">Route</span>' + escapeHtml(drug.route) + '</div>' +
            '<div class="drug-lookup-row"><span class="drug-lookup-label">Uses</span>' + escapeHtml(drug.uses) + '</div>' +
            '<div class="drug-lookup-points">' + escapeHtml(drug.keyPoints) + '</div>' +
            (drug.classNoteId && DB.notes[drug.classNoteId] ?
              '<button class="note-link-chip" onclick="CKB.openNote(\'' + drug.classNoteId + '\',null,\'' + escapeHtml(drug.name.toLowerCase()) + '\')">' + escapeHtml(DB.notes[drug.classNoteId].title) + ' &rarr;</button>' : '') +
            '</div>';
        });
      }
    }

    notes.forEach(function (note) {
      var p = progress[note.id] || {};
      var color = !p.confidence ? 'var(--border)' :
                  p.confidence === 'solid' ? 'var(--green)' :
                  p.confidence === 'needs-review' ? 'var(--amber)' : 'var(--red)';
      var searchArg = browseSearch ? ',null,\'' + escapeHtml(browseSearch.replace(/'/g, '')) + '\'' : '';
      html += '<div class="browse-item" onclick="CKB.openNote(\'' + note.id + '\'' + searchArg + ')">' +
        '<div><div class="browse-item-title">' + escapeHtml(note.title) + '</div>' +
        '<div class="browse-item-cat">' + note.category + '</div></div>' +
        '<div class="browse-item-confidence" style="background:' + color + '"></div></div>';
    });

    if (notes.length === 0 && html === '') {
      html = '<p style="text-align:center;color:var(--text-muted);padding:20px">No notes found</p>';
    }
    document.getElementById('browse-list').innerHTML = html;
  }

  // ==================== NOTE DETAIL VIEW ====================
  function openNote(noteId, scrollToSection, highlightTerm) {
    var note = DB.notes[noteId];
    if (!note) return;

    var html = '<div class="note-title">' + escapeHtml(note.title) + '</div>';
    var metaParts = [note.category];
    if (note.system) metaParts.push(note.system);
    if (note.drugClass) metaParts.push(note.drugClass);
    if (note.edTriage) metaParts.push(note.edTriage);
    html += '<div class="note-meta">' + escapeHtml(metaParts.join(' · ')) + '</div>';

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

    if (note.clinicalPearls && note.clinicalPearls.length > 0) {
      html += '<div class="note-section"><div class="note-section-title">Clinical Pearls</div>';
      note.clinicalPearls.forEach(function (p) {
        html += '<div class="note-pearl">' + formatSection(p) + '</div>';
      });
      html += '</div>';
    }

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

    if (scrollToSection) {
      setTimeout(function () {
        var el = document.getElementById('section-' + scrollToSection);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          el.style.background = 'var(--accent-bg, rgba(59,130,246,0.1))';
          setTimeout(function () { el.style.background = ''; }, 2000);
        }
      }, 50);
    } else if (highlightTerm && highlightTerm.length >= 3) {
      setTimeout(function () {
        var term = highlightTerm.toLowerCase();
        var container = document.getElementById('note-content');
        var marks = highlightText(container, term);
        if (marks.length > 0) {
          setTimeout(function () {
            marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 150);
        }
      }, 100);
    }
  }

  function highlightText(root, term) {
    var marks = [];
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      var idx = node.textContent.toLowerCase().indexOf(term);
      if (idx === -1) return;
      var span = document.createElement('span');
      var before = node.textContent.substring(0, idx);
      var match = node.textContent.substring(idx, idx + term.length);
      var after = node.textContent.substring(idx + term.length);
      var mark = document.createElement('mark');
      mark.className = 'search-highlight';
      mark.textContent = match;
      marks.push(mark);
      span.appendChild(document.createTextNode(before));
      span.appendChild(mark);
      span.appendChild(document.createTextNode(after));
      node.parentNode.replaceChild(span, node);
    });
    return marks;
  }

  // ==================== PROGRESS DASHBOARD ====================
  function renderDashboard() {
    if (!DB || !STUDY) return;
    var html = '<div class="dash-title">Your Progress</div>';

    var streak = getStreak();
    html += '<div class="dash-section"><div class="streak-display">' +
      '<div class="streak-number">' + streak.count + '</div>' +
      '<div class="streak-label">day study streak</div></div></div>';

    // Study mode coverage
    var pools = [
      { name: 'Presentations', items: STUDY.presentations },
      { name: 'Conditions', items: STUDY.conditions },
      { name: 'Principles', items: STUDY.principles },
      { name: 'Codes', items: STUDY.codes }
    ];
    html += '<div class="dash-section"><div class="dash-section-title">Study Coverage</div>';
    pools.forEach(function (pool) {
      var seen = pool.items.filter(function (item) { return progress[item.id] && progress[item.id].lastSeen; }).length;
      var pct = pool.items.length > 0 ? Math.round((seen / pool.items.length) * 100) : 0;
      var color = pct > 70 ? 'green' : pct > 30 ? 'amber' : 'blue';
      html += '<div class="progress-bar-container">' +
        '<div class="progress-bar-label"><span>' + pool.name + '</span><span>' + seen + '/' + pool.items.length + '</span></div>' +
        '<div class="progress-bar"><div class="progress-bar-fill ' + color + '" style="width:' + pct + '%"></div></div></div>';
    });
    html += '</div>';

    // Browse coverage
    html += '<div class="dash-section"><div class="dash-section-title">Vault Coverage (Browse)</div>';
    ['Conditions', 'Pharmacology', 'Concepts', 'Systems', 'Procedures'].forEach(function (cat) {
      var ids = DB.categories[cat] || [];
      var seen = ids.filter(function (id) { return progress[id] && progress[id].lastSeen; }).length;
      var pct = ids.length > 0 ? Math.round((seen / ids.length) * 100) : 0;
      var color = pct > 70 ? 'green' : pct > 30 ? 'amber' : 'blue';
      html += '<div class="progress-bar-container">' +
        '<div class="progress-bar-label"><span>' + cat + '</span><span>' + seen + '/' + ids.length + '</span></div>' +
        '<div class="progress-bar"><div class="progress-bar-fill ' + color + '" style="width:' + pct + '%"></div></div></div>';
    });
    html += '</div>';

    // Confidence
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

    document.getElementById('dashboard').innerHTML = html;
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
    var lines = text.split('\n');
    var out = [];
    var i = 0;

    function fmt(s) {
      s = escapeHtml(s);
      s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
      s = s.replace(/`([^`]+)`/g, '<code class="md-code">$1</code>');
      return s;
    }

    while (i < lines.length) {
      var line = lines[i];
      var trimmed = line.trim();
      if (trimmed === '') { i++; continue; }
      if (trimmed === '---' || trimmed === '***' || trimmed === '___') { out.push('<hr class="md-hr">'); i++; continue; }
      if (trimmed.startsWith('### ')) { out.push('<h4 class="md-h3">' + fmt(trimmed.slice(4)) + '</h4>'); i++; continue; }
      if (trimmed.startsWith('#### ')) { out.push('<h5 class="md-h4">' + fmt(trimmed.slice(5)) + '</h5>'); i++; continue; }

      if (trimmed.startsWith('> ')) {
        var bqLines = [];
        while (i < lines.length && lines[i].trim().startsWith('> ')) { bqLines.push(fmt(lines[i].trim().slice(2))); i++; }
        out.push('<blockquote class="md-bq">' + bqLines.join('<br>') + '</blockquote>');
        continue;
      }

      if (trimmed.match(/^\|.*\|$/)) {
        var tableRows = [];
        var pastSep = false;
        while (i < lines.length && lines[i].trim().match(/^\|.*\|$/)) {
          var row = lines[i].trim();
          if (row.match(/^\|[\s\-:|]+\|$/)) { pastSep = true; i++; continue; }
          var cells = row.split('|').filter(function (c) { return c.trim() !== ''; });
          var tag = !pastSep ? 'th' : 'td';
          var tr = '<tr>';
          cells.forEach(function (c) { tr += '<' + tag + '>' + fmt(c.trim()) + '</' + tag + '>'; });
          tableRows.push(tr + '</tr>');
          i++;
        }
        out.push('<table class="md-table">' + tableRows.join('') + '</table>');
        continue;
      }

      if (trimmed.match(/^[-*]\s/)) {
        var items = [];
        while (i < lines.length) {
          var bl = lines[i], bt = bl.trim();
          if (bt === '') break;
          var indent = bl.search(/\S/);
          var bm = bt.match(/^[-*]\s+(.*)/);
          if (bm) { items.push({ depth: indent >= 2 ? 1 : 0, html: fmt(bm[1]) }); }
          else if (indent >= 2 && items.length > 0) { items[items.length - 1].html += ' ' + fmt(bt); }
          else break;
          i++;
        }
        var ul = '<ul class="md-ul">';
        var inSub = false;
        items.forEach(function (item) {
          if (item.depth > 0 && !inSub) { ul += '<li><ul class="md-ul-nested">'; inSub = true; }
          else if (item.depth === 0 && inSub) { ul += '</ul></li>'; inSub = false; }
          ul += '<li>' + item.html + '</li>';
        });
        if (inSub) ul += '</ul></li>';
        out.push(ul + '</ul>');
        continue;
      }

      if (trimmed.match(/^\d+\.\s/)) {
        var ol = '<ol class="md-ol">';
        while (i < lines.length) {
          var nl = lines[i], nt = nl.trim();
          if (nt === '') break;
          var nm = nt.match(/^\d+\.\s+(.*)/);
          if (nm) { ol += '<li>' + fmt(nm[1]) + '</li>'; }
          else if (nl.search(/\S/) >= 2) {
            var subBm = nt.match(/^[-*]\s+(.*)/);
            if (subBm) { ol += '<ul class="md-ul-nested"><li>' + fmt(subBm[1]) + '</li></ul>'; }
            else break;
          } else break;
          i++;
        }
        out.push(ol + '</ol>');
        continue;
      }

      out.push('<p class="md-p">' + fmt(trimmed) + '</p>');
      i++;
    }
    return out.join('');
  }

  // ==================== PUBLIC API ====================
  window.CKB = {
    showView: showView,
    openNote: function (id, sec, hl) { openNote(id, sec, hl); },
    goBack: function () { showView(previousView || 'home'); },
    setBrowseFilter: function (f) { browseFilter = f; renderBrowse(); },

    startMode: function (mode) {
      switch (mode) {
        case 'presentation': renderPresentation(); break;
        case 'condition': renderCondition(); break;
        case 'anatomy': renderAnatomy(); break;
        case 'medclass': renderMedClass(); break;
        case 'principle': renderPrinciple(); break;
        case 'code': renderCode(); break;
      }
    },

    toggleDiff: function (idx) {
      var body = document.getElementById('diff-body-' + idx);
      var arrow = document.getElementById('diff-arrow-' + idx);
      if (!body) return;
      var showing = body.style.display !== 'none';
      body.style.display = showing ? 'none' : 'block';
      if (arrow) arrow.innerHTML = showing ? '&#9654;' : '&#9660;';
    },

    toggleReveal: function (btn) {
      var body = btn.nextElementSibling;
      var arrow = btn.querySelector('.reveal-arrow');
      if (!body) return;
      var showing = body.style.display !== 'none';
      body.style.display = showing ? 'none' : 'block';
      if (arrow) arrow.innerHTML = showing ? '&#9654;' : '&#9660;';
    },

    rate: function (mode, noteId, confidence) {
      recordView(noteId, confidence);
      bumpStreak();
      renderHome();
      // Re-render the current mode to show updated rating
      switch (mode) {
        case 'presentation': renderPresentation(); break;
        case 'condition': renderCondition(); break;
        case 'anatomy': renderAnatomy(); break;
        case 'medclass': renderMedClass(); break;
        case 'principle': renderPrinciple(); break;
        case 'code': renderCode(); break;
      }
    },

    answerCode: function (optIdx) {
      var item = getStudyItem(STUDY.codes, todaySelections.codeId);
      if (!item) return;
      var step = item.steps[codeState.step];
      codeState.selectedOption = optIdx;
      codeState.revealed = true;
      codeState.answers.push(step.options[optIdx].correct);
      renderCode();
    },

    nextCodeStep: function () {
      codeState.step++;
      codeState.revealed = false;
      codeState.selectedOption = null;
      renderCode();
    },

    resetCode: function () {
      codeState = null;
      renderCode();
    }
  };

  // ==================== BOOT ====================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
