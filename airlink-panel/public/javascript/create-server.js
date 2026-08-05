(function () {
  function buildCustomSelect(container) {
    const select = document.getElementById(container.dataset.for);
    if (!select) return;

    const trigger  = document.createElement('div');
    trigger.className = 'cs-trigger';
    const label = document.createElement('span');
    label.className = 'cs-label';
    trigger.appendChild(label);

    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrow.setAttribute('viewBox', '0 0 24 24'); arrow.setAttribute('fill', 'none');
    arrow.setAttribute('stroke', 'currentColor'); arrow.setAttribute('stroke-width', '2');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
    p.setAttribute('d', 'M19 9l-7 7-7-7');
    arrow.appendChild(p); trigger.appendChild(arrow);

    const dropdown = document.createElement('div');
    dropdown.className = 'cs-dropdown';
    dropdown.style.display = 'none';

    container.appendChild(trigger);
    container.appendChild(dropdown);

    function syncLabel() {
      const sel = select.options[select.selectedIndex];
      if (sel && !sel.disabled && sel.value) {
        label.textContent = sel.text;
        label.classList.remove('cs-placeholder');
      } else {
        const ph = Array.from(select.options).find(o => o.disabled && o.selected);
        label.textContent = ph ? ph.text : 'Select…';
        label.classList.add('cs-placeholder');
      }
      Array.from(dropdown.children).forEach(item => {
        item.classList.toggle('selected', item.dataset.value === select.value);
      });
    }

    function syncFromSelect() {
      dropdown.innerHTML = '';
      Array.from(select.options).forEach(opt => {
        const item = document.createElement('div');
        item.className = 'cs-option' + (opt.disabled ? ' disabled' : '');
        item.textContent = opt.text;
        item.dataset.value = opt.value;
        if (!opt.disabled) {
          item.addEventListener('click', e => {
            e.stopPropagation();
            select.value = opt.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            syncLabel();
            close();
          });
        }
        dropdown.appendChild(item);
      });
      syncLabel();
    }

    function open() {
      document.querySelectorAll('.cs-dropdown').forEach(d => {
        if (d !== dropdown) { d.style.display = 'none'; d.parentElement.querySelector('.cs-trigger')?.classList.remove('open'); }
      });
      dropdown.style.display = 'block';
      trigger.classList.add('open');
      syncFromSelect();
    }

    function close() {
      dropdown.style.display = 'none';
      trigger.classList.remove('open');
    }

    trigger.addEventListener('click', e => {
      e.stopPropagation();
      dropdown.style.display === 'none' ? open() : close();
    });

    document.addEventListener('click', close);

    const obs = new MutationObserver(syncFromSelect);
    obs.observe(select, { childList: true, subtree: true, attributes: true });
    select.addEventListener('change', syncLabel);
    syncFromSelect();
  }

  document.querySelectorAll('.custom-select').forEach(buildCustomSelect);

  const softwareTypeSelect = document.getElementById('softwareType');
  const softwareVersionSelect = document.getElementById('softwareVersion');

  if (softwareTypeSelect && softwareVersionSelect) {
    softwareTypeSelect.addEventListener('change', async function () {
      const type = this.value || 'paper';
      try {
        const res = await fetch('/api/mcjars/versions/' + type);
        const data = await res.json();
        if (data && Array.isArray(data.versions) && data.versions.length > 0) {
          softwareVersionSelect.innerHTML = '';
          data.versions.forEach(ver => {
            const o = document.createElement('option');
            o.value = ver; o.textContent = ver;
            softwareVersionSelect.appendChild(o);
          });
          softwareVersionSelect.selectedIndex = 0;
          softwareVersionSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } catch (e) {
        console.error('Failed to load MCJars versions:', e);
      }
    });
  }

  document.querySelectorAll('.stepper-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      const step  = parseInt(btn.dataset.step || '1');
      const min   = parseInt(btn.dataset.min  || input.min  || '0');
      const max   = parseInt(btn.dataset.max  || input.max  || '999999');
      let val = parseInt(input.value) || 0;
      val = btn.dataset.action === 'inc' ? Math.min(max, val + step) : Math.max(min, val - step);
      input.value = val;
      input.dispatchEvent(new Event('input'));
    });
  });

  function syncUnit(displayId, unitId, hiddenId) {
    const display = document.getElementById(displayId);
    const unit    = document.getElementById(unitId);
    const hidden  = document.getElementById(hiddenId);
    if (!display || !unit || !hidden) return;
    function update() {
      hidden.value = Math.round(parseFloat(display.value || 0) * parseInt(unit.value));
    }
    display.addEventListener('input', update);
    unit.addEventListener('change', function() {
      const prevMult = this.value === '1024' ? 1 : 1024;
      const newMult  = parseInt(this.value);
      if (prevMult !== newMult) display.value = Math.round(parseFloat(display.value || 0) * prevMult / newMult) || 1;
      update();
    });
    update();
  }
  syncUnit('MemoryDisplay',  'MemoryUnit',  'Memory');
  syncUnit('StorageDisplay', 'StorageUnit', 'Storage');

  const overlay      = document.getElementById('confirmOverlay');
  const confirmTitle = document.getElementById('confirmTitle');
  const confirmBody  = document.getElementById('confirmBody');
  const confirmOk    = document.getElementById('confirmOk');
  const confirmCancel = document.getElementById('confirmCancel');
  let confirmResolve = null;

  function showConfirm(title, body) {
    return new Promise(resolve => {
      if (!overlay) return resolve(true);
      confirmTitle.textContent = title;
      confirmBody.textContent  = body;
      overlay.classList.add('open');
      confirmResolve = resolve;
    });
  }

  if (confirmOk) confirmOk.addEventListener('click', () => { overlay.classList.remove('open'); if (confirmResolve) confirmResolve(true); });
  if (confirmCancel) confirmCancel.addEventListener('click', () => { overlay.classList.remove('open'); if (confirmResolve) confirmResolve(false); });
  if (overlay) overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.classList.remove('open'); if (confirmResolve) confirmResolve(false); } });

  const createBtn = document.getElementById('createBtn');
  if (createBtn) {
    createBtn.addEventListener('click', async function () {
      const btn     = this;
      const errBox  = document.getElementById('errorMsg');
      const errText = document.getElementById('errorText');
      if (errBox) errBox.classList.add('hidden');

      const name            = document.getElementById('serverName')?.value.trim();
      const description     = document.getElementById('serverDescription')?.value.trim();
      const nodeId          = document.getElementById('nodeId')?.value;
      const softwareType    = document.getElementById('softwareType')?.value || 'paper';
      const softwareVersion = document.getElementById('softwareVersion')?.value || '1.21.4';
      const javaVersion     = document.getElementById('javaVersion')?.value || '21';
      const Memory          = parseInt(document.getElementById('Memory')?.value || '1024');
      const Cpu             = parseInt(document.getElementById('Cpu')?.value || '100');
      const Storage         = parseInt(document.getElementById('Storage')?.value || '5120');

      if (!name) {
        if (errText) errText.textContent = 'Server name is required.';
        if (errBox) errBox.classList.remove('hidden');
        document.getElementById('serverName')?.focus();
        return;
      }
      if (!nodeId) {
        if (errText) errText.textContent = 'Select a node.';
        if (errBox) errBox.classList.remove('hidden');
        return;
      }

      const payload = { name, description, nodeId, softwareType, softwareVersion, javaVersion, Memory, Cpu, Storage };

      const ok = await showConfirm(
        'Create server?',
        `"${name}" will be created and queued for deployment via Kinetictyl Agent.`
      );
      if (!ok) return;

      const origText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Creating...';

      try {
        const r = await fetch('/user/create-server', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const d = await r.json();
        if (d.success) {
          window.location.href = '/server/' + d.serverUUID;
        } else {
          btn.disabled = false;
          btn.textContent = origText;
          if (errText) errText.textContent = d.error || 'Something went wrong.';
          if (errBox) errBox.classList.remove('hidden');
        }
      } catch {
        btn.disabled = false;
        btn.textContent = origText;
        if (errText) errText.textContent = 'Network error. Try again.';
        if (errBox) errBox.classList.remove('hidden');
      }
    });
  }
})();
