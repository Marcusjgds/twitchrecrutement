(() => {
  const stepIdentity = document.getElementById("step-identity");
  const stepQuiz = document.getElementById("step-quiz");
  const stepResult = document.getElementById("step-result");
  const cheatOverlay = document.getElementById("cheat-overlay");

  const startBtn = document.getElementById("start-btn");
  const pseudoInput = document.getElementById("pseudo");
  const discordIdInput = document.getElementById("discordId");

  const asciiBar = document.getElementById("ascii-bar");
  const progressLabel = document.getElementById("progress-label");
  const progressPct = document.getElementById("progress-pct");
  const qIndex = document.getElementById("q-index");
  const qText = document.getElementById("q-text");
  const optionsEl = document.getElementById("options");
  const nextBtn = document.getElementById("next-btn");

  const position = sessionStorage.getItem("recruit_position") || "Modérateur Discord";

  let state = null; // { sessionId, questions, current, answers, selected, started }
  let cheatTriggered = false;

  // ---------------------------------------------------------------------
  // Blocage si cooldown actif (déjà tenté récemment)
  // ---------------------------------------------------------------------
  fetch("/api/status").then(r => r.json()).then(data => {
    if (data.blocked) {
      startBtn.disabled = true;
      const box = document.createElement("div");
      box.className = "warning-box";
      box.style.borderColor = "#4a1717";
      box.style.color = "#f2a3a3";
      box.style.background = "rgba(237,66,69,0.06)";
      function fmt(ms){
        const h = Math.floor(ms/3600000), m = Math.floor((ms%3600000)/60000), s = Math.floor((ms%60000)/1000);
        return `${h}h ${m}m ${s}s`;
      }
      let remaining = data.remainingMs;
      function update(){
        remaining -= 1000;
        if (remaining <= 0){ startBtn.disabled = false; box.remove(); clearInterval(t); return; }
        box.textContent = `⛔ Nouvelle tentative possible dans ${fmt(remaining)}.`;
      }
      document.querySelector("#step-identity .panel").appendChild(box);
      update();
      const t = setInterval(update, 1000);
    }
  }).catch(() => {});

  // ---------------------------------------------------------------------
  // Démarrage du test
  // ---------------------------------------------------------------------
  startBtn.addEventListener("click", async () => {
    const pseudo = pseudoInput.value.trim();
    if (pseudo.length < 2) {
      pseudoInput.style.borderColor = "var(--ko)";
      pseudoInput.focus();
      return;
    }
    startBtn.disabled = true;
    startBtn.textContent = "Chargement...";

    try {
      const res = await fetch("/api/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pseudo, discordId: discordIdInput.value.trim(), position }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.error === "cooldown") {
          alert("Tu ne peux pas encore repasser le test. Reviens plus tard.");
          window.location.href = "/";
          return;
        }
        alert("Une erreur est survenue, réessaie.");
        startBtn.disabled = false;
        startBtn.textContent = "Commencer le test →";
        return;
      }

      state = {
        sessionId: data.sessionId,
        questions: data.questions,
        total: data.totalQuestions,
        current: 0,
        answers: {},
        selected: null,
      };

      stepIdentity.style.display = "none";
      stepQuiz.style.display = "block";
      renderQuestion();
      armAntiCheat();
    } catch (e) {
      alert("Impossible de contacter le serveur. Réessaie.");
      startBtn.disabled = false;
      startBtn.textContent = "Commencer le test →";
    }
  });

  // ---------------------------------------------------------------------
  // Affichage d'une question + barre ASCII
  // ---------------------------------------------------------------------
  function renderProgress() {
    const total = state.total;
    const done = state.current;
    const width = 24;
    const filled = Math.round((done / total) * width);
    const bar = "█".repeat(filled) + "░".repeat(width - filled);
    asciiBar.innerHTML = `[<span class="fill">${bar.slice(0, filled)}</span><span class="empty">${bar.slice(filled)}</span>] ${Math.round((done/total)*100)}%`;
    progressLabel.textContent = `QUESTION ${done + 1} / ${total}`;
    progressPct.textContent = `${Math.round((done / total) * 100)}%`;
  }

  function renderQuestion() {
    const q = state.questions[state.current];
    state.selected = null;
    nextBtn.disabled = true;
    nextBtn.textContent = state.current === state.total - 1 ? "Terminer le test" : "Suivant →";

    renderProgress();
    qIndex.textContent = `Q${String(state.current + 1).padStart(3, "0")}`;
    qText.textContent = q.text;

    optionsEl.innerHTML = "";
    const letters = ["A", "B", "C", "D"];
    q.options.forEach((opt, i) => {
      const div = document.createElement("div");
      div.className = "option";
      div.dataset.index = i;
      div.innerHTML = `<span class="letter">${letters[i]}</span><span>${opt}</span>`;
      div.addEventListener("click", () => {
        optionsEl.querySelectorAll(".option").forEach(o => o.classList.remove("selected"));
        div.classList.add("selected");
        state.selected = i;
        nextBtn.disabled = false;
      });
      optionsEl.appendChild(div);
    });
  }

  nextBtn.addEventListener("click", () => {
    if (state.selected === null) return;
    const q = state.questions[state.current];
    state.answers[q.id] = state.selected;

    if (state.current < state.total - 1) {
      state.current++;
      renderQuestion();
    } else {
      finishQuiz();
    }
  });

  // ---------------------------------------------------------------------
  // Soumission finale
  // ---------------------------------------------------------------------
  async function finishQuiz() {
    disarmAntiCheat();
    stepQuiz.style.display = "none";

    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: state.sessionId, answers: state.answers }),
      });
      const data = await res.json();
      showResult(data.passed, data.score, data.total);
    } catch (e) {
      stepResult.style.display = "block";
      document.getElementById("result-icon").textContent = "⚠";
      document.getElementById("result-title").textContent = "Erreur d'envoi";
      document.getElementById("result-title").className = "result-title ko";
      document.getElementById("result-score").textContent = "";
      document.getElementById("result-msg").textContent = "Le résultat n'a pas pu être transmis. Contacte le staff directement.";
    }
  }

  function showResult(passed, score, total) {
    stepResult.style.display = "block";
    document.getElementById("result-icon").textContent = passed ? "✅" : "❌";
    const title = document.getElementById("result-title");
    title.textContent = passed ? "Candidature acceptée" : "Candidature refusée";
    title.className = "result-title " + (passed ? "ok" : "ko");
    document.getElementById("result-score").textContent = `Score : ${score} / ${total}`;
    document.getElementById("result-msg").textContent = passed
      ? "Bravo ! Ton résultat a été transmis à l'équipe. Tu seras contacté sur Discord prochainement."
      : "Ton score est insuffisant. Ton résultat a été transmis à l'équipe. Tu pourras retenter ta chance dans 24h.";
  }

  // ---------------------------------------------------------------------
  // Anti-triche : sortie de fenêtre / changement d'onglet = échec direct
  // ---------------------------------------------------------------------
  function onBlur() { triggerCheatFail(); }
  function onVisibility() { if (document.hidden) triggerCheatFail(); }
  function onMouseLeave(e) { if (e.clientY <= 0) triggerCheatFail(); }

  function armAntiCheat() {
    cheatTriggered = false;
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("mouseleave", onMouseLeave);
  }

  function disarmAntiCheat() {
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("mouseleave", onMouseLeave);
  }

  function triggerCheatFail() {
    if (cheatTriggered || !state) return;
    cheatTriggered = true;
    disarmAntiCheat();

    // Envoi fiable même si la page se ferme
    const payload = JSON.stringify({ sessionId: state.sessionId });
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon("/api/abandon", blob);
    } else {
      fetch("/api/abandon", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true });
    }

    stepQuiz.style.display = "none";
    cheatOverlay.style.display = "flex";
  }
})();
