(() => {
  const historyTable = document.querySelector('#historyTable tbody');
  const seedInput = document.getElementById('seedInput');
  const seedSearchBtn = document.getElementById('seedSearchBtn');
  const metaArea = document.getElementById('metaArea');
  const replayBoard = document.getElementById('replayBoard');

  const fmtTime = (ts) => {
    if (!ts) return '-';
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const fetchJSON = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  };

  const loadHistory = async () => {
    try {
      const data = await fetchJSON('/api/horse/history?limit=200');
      historyTable.innerHTML = '';
      (data.history || []).forEach((row) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${row.id}</td>
          <td>${row.seed ?? '-'}</td>
          <td>${row.winner_id || '-'} / ${row.bet_choice || '-'}</td>
          <td>${row.bet_amount || 0} / ${row.result}</td>
          <td>${fmtTime(row.timestamp)}</td>
        `;
        tr.onclick = () => loadReplayById(row.id);
        historyTable.appendChild(tr);
      });
    } catch (err) {
      console.error(err);
    }
  };

  const showMeta = (payload) => {
    const d = payload.detail || {};
    metaArea.innerHTML = `
      <div><strong>Game ID:</strong> ${payload.id}</div>
      <div><strong>Seed:</strong> ${payload.seed}</div>
      <div><strong>Winner:</strong> ${d.winner_id || '-'}</div>
      <div><strong>Picked:</strong> ${d.bet_choice || '-'}</div>
      <div><strong>Bet:</strong> ${payload.bet_amount} / Result: ${payload.result} / Payout: ${payload.payout_amount}</div>
      <div><strong>Session:</strong> ${d.session_id || '-'}</div>
      <div><strong>Finish times:</strong> ${d.finish_times ? JSON.stringify(d.finish_times) : '-'}</div>
    `;
  };

  const renderReplay = (detail) => {
    const horses = detail.horses || [];
    const timeline = detail.timeline || [];
    const events = detail.events || [];
    const winnerId = detail.winner_id;
    const pickedId = detail.bet_choice;
    const trackLenUnits = detail.track_length || 1000;
    const laps = detail.laps || 1;
    const finishDist = trackLenUnits * laps;

    replayBoard.innerHTML = `
      <div class="horse-race-wrap">
        <div class="small text-white mb-2">시드 ${detail.race_seed || '-'} / 우승 ${winnerId || '-'} / 선택 ${pickedId || '-'}</div>
        <div class="horse-track mb-1" id="verify-track"></div>
        <div class="mt-3">
          <h6 class="fw-bold mb-2">실시간 로그</h6>
          <div id="raceLog" class="small text-white" style="max-height: 180px; overflow-y: auto; background: #0b172a; border: 1px solid #1f2937; padding: 8px; border-radius: 6px;">
            ${events.length ? "" : "로그 없음"}
          </div>
        </div>
      </div>
    `;
    const trackEl = document.getElementById('verify-track');
    const logEl = document.getElementById('raceLog');
    if (!trackEl) return;
    const trackW = trackEl.clientWidth;
    const trackH = trackEl.clientHeight;
    const runnerW = 64;
    const runnerH = 32;
    const outerR = trackH / 2;
    const innerInset = 26;
    const laneR = outerR - (outerR - (trackH - innerInset * 2) / 2) / 2;
    const leftCenterX = outerR;
    const rightCenterX = trackW - outerR;
    const straightLen = Math.max(40, rightCenterX - leftCenterX);
    const arcHalf = laneR * Math.PI;
    const totalLen = straightLen * 2 + arcHalf * 2;

    horses.forEach((h) => {
      const div = document.createElement('div');
      div.className = 'horse-runner';
      if (h.id === winnerId) div.classList.add('winner');
      if (h.id === pickedId) div.classList.add('picked-horse');
      div.dataset.horse = h.id;
      div.textContent = h.name || h.id;
      trackEl.appendChild(div);
    });
    const runnersById = new Map(Array.from(trackEl.querySelectorAll('.horse-runner')).map((el) => [el.dataset.horse, el]));
    const horseNameById = new Map(horses.map((h) => [h.id, h.name || h.id]));
    const sortedEvents = events
      .filter((ev) => ev.kind !== 'SLIP')
      .map((ev) => ({ ...ev }))
      .sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
    let nextEventIdx = 0;

    const formatEventText = (ev) => {
      const time = Number.isFinite(ev.t) ? ev.t.toFixed(2) : (ev.t ?? '-');
      const horseName = horseNameById.get(ev.horse_id) || ev.horse_id || '-';
      const note = ev.note || ev.kind || 'event';
      const mag = Number.isFinite(ev.mag) ? ` (${ev.mag.toFixed(3)})` : '';
      return `[${time}s] ${horseName} ${note}${mag}`;
    };

    const appendEventLog = (ev) => {
      if (!logEl) return;
      const line = document.createElement('div');
      line.textContent = formatEventText(ev);
      logEl.appendChild(line);
    };

    const flushEventLog = (simT) => {
      if (!logEl || !sortedEvents.length) return;
      const threshold = simT + 1e-6;
      while (nextEventIdx < sortedEvents.length && (sortedEvents[nextEventIdx].t ?? 0) <= threshold) {
        appendEventLog(sortedEvents[nextEventIdx]);
        nextEventIdx += 1;
      }
      logEl.scrollTop = logEl.scrollHeight;
    };

    const pointAt = (distRaw) => {
      let d = distRaw % totalLen;
      if (d <= straightLen) return { x: leftCenterX + d, y: trackH / 2 - laneR, heading: 0 };
      d -= straightLen;
      if (d <= arcHalf) {
        const a = -Math.PI / 2 + (d / arcHalf) * Math.PI;
        const heading = a + Math.PI / 2;
        return { x: rightCenterX + laneR * Math.cos(a), y: trackH / 2 + laneR * Math.sin(a), heading };
      }
      d -= arcHalf;
      if (d <= straightLen) return { x: rightCenterX - d, y: trackH / 2 + laneR, heading: Math.PI };
      d -= straightLen;
      const a = Math.PI / 2 + (d / arcHalf) * Math.PI;
      const heading = a + Math.PI / 2;
      return { x: leftCenterX + laneR * Math.cos(a), y: trackH / 2 + laneR * Math.sin(a), heading };
    };

    const renderPositions = (positions) => {
      positions.forEach((pos, idx) => {
        const horse = horses[idx];
        const el = horse ? runnersById.get(horse.id) : null;
        if (!horse || !el) return;
        const lapFrac = ((pos % trackLenUnits) / trackLenUnits) * totalLen;
        const p = pointAt(lapFrac);
        el.style.transform = `translate(${p.x - runnerW / 2}px, ${p.y - runnerH / 2}px) rotate(${p.heading || 0}rad)`;
      });
    };

    if (!timeline.length) {
      renderPositions(horses.map(() => finishDist));
      flushEventLog(Number.POSITIVE_INFINITY);
      return;
    }
    const start = performance.now();
    const lastT = timeline[timeline.length - 1].t || 0;

    const step = (now) => {
      const elapsed = (now - start) / 1000;
      const simT = Math.min(lastT, elapsed * 4); // 재생 4x
      let prev = timeline[0];
      let next = timeline[timeline.length - 1];
      for (let i = 1; i < timeline.length; i += 1) {
        if (timeline[i].t >= simT) {
          next = timeline[i];
          prev = timeline[i - 1];
          break;
        }
      }
      const span = Math.max(0.0001, next.t - prev.t);
      const k = Math.min(1, Math.max(0, (simT - prev.t) / span));
      const interp = prev.positions.map((p, idx) => {
        const n = next.positions[idx] ?? p;
        return p + (n - p) * k;
      });
      renderPositions(interp);
      flushEventLog(simT);
      if (simT >= lastT - 1e-3) {
        renderPositions(next.positions || interp);
        flushEventLog(lastT + 1);
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const loadReplayById = async (id) => {
    try {
      const data = await fetchJSON(`/api/horse/replay/${id}`);
      showMeta(data);
      renderReplay(data.detail || {});
    } catch (err) {
      console.error(err);
      alert(err.message || err);
    }
  };

  const loadReplayBySeed = async () => {
    const seed = (seedInput.value || '').trim();
    if (!seed) return;
    try {
      const data = await fetchJSON(`/api/horse/replay/by-seed/${encodeURIComponent(seed)}`);
      showMeta(data);
      renderReplay(data.detail || {});
    } catch (err) {
      console.error(err);
      alert(err.message || err);
    }
  };

  if (seedSearchBtn) seedSearchBtn.onclick = loadReplayBySeed;

  loadHistory();
})();
