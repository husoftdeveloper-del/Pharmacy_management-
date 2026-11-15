'use strict';
/* Renderer for the License Generator. It never touches the filesystem, the
   database or the private key — everything goes through window.generator.call. */

const $ = selector => document.querySelector(selector);

const state = {
  licenses: [],
  stats: { total: 0, unused: 0, assigned: 0, used: 0 },
  search: '',
  status: '',
  busy: false
};

let toastTimer = 0;

function toast(message, kind = 'ok') {
  const host = $('#toasts');
  const node = document.createElement('div');
  node.className = `toast${kind === 'error' ? ' error' : ''}`;
  const mark = document.createElement('span');
  mark.className = 'mark';
  const text = document.createElement('span');
  text.textContent = message;
  node.append(mark, text);
  host.append(node);
  setTimeout(() => node.remove(), 2600);
  clearTimeout(toastTimer);
}

function setError(message) {
  $('#generate-error').textContent = message || '';
}

function plain(serial) {
  return String(serial || '').replace(/[^0-9A-Z]/gi, '');
}

async function call(channel, payload) {
  return window.generator.call(channel, payload);
}

/* ---- Copying ---------------------------------------------------------- */
async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label} copied`);
  } catch {
    // Clipboard can be blocked on some Windows setups: fall back to a temp
    // textarea, still without touching anything but the DOM.
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.append(helper);
    helper.select();
    const done = document.execCommand('copy');
    helper.remove();
    toast(done ? `${label} copied` : 'Copy failed — select the text and press Ctrl+C', done ? 'ok' : 'error');
  }
}

/* ---- Rendering -------------------------------------------------------- */
function statusLabel(status) {
  return { unused: 'Unused', assigned: 'Assigned', used: 'Used' }[status] || 'Unused';
}

function pill(status) {
  const span = document.createElement('span');
  span.className = `status-pill${status === 'unused' ? '' : ` ${status}`}`;
  span.textContent = statusLabel(status);
  return span;
}

function iconButton(label, title, onClick, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `icon-btn${className ? ` ${className}` : ''}`;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function renderStats() {
  $('#stat-total').textContent = state.stats.total;
  $('#stat-unused').textContent = state.stats.unused;
  $('#stat-assigned').textContent = state.stats.assigned;
  $('#stat-used').textContent = state.stats.used;
}

function renderRows() {
  const body = $('#license-rows');
  body.replaceChildren();
  const term = state.search.trim().toLowerCase();
  const rows = state.licenses.filter(row => {
    if (state.status && row.status !== state.status) return false;
    if (!term) return true;
    return [row.serial, row.plain, row.product, row.assigned_to, row.note, row.planLabel]
      .filter(Boolean).some(value => String(value).toLowerCase().includes(term));
  });

  for (const row of rows) {
    const tr = document.createElement('tr');

    const serialCell = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'serial-cell';
    const code = document.createElement('code');
    code.textContent = row.formatted;
    code.title = row.formatted;
    wrap.append(code);
    wrap.append(iconButton('⧉', 'Copy serial key', () => copyText(row.formatted, 'Serial key')));
    serialCell.append(wrap);

    const product = document.createElement('td');
    product.textContent = row.product;
    product.title = row.product;

    const plan = document.createElement('td');
    const tag = document.createElement('span');
    tag.className = `plan-tag${row.planId === 'lifetime' ? ' lifetime' : ''}`;
    tag.textContent = row.planLabel;
    plan.append(tag);

    const issued = document.createElement('td');
    issued.className = 'muted';
    issued.textContent = String(row.issued_on || '').slice(0, 10);

    const expires = document.createElement('td');
    expires.className = 'muted';
    expires.textContent = row.expires_on || 'Never';

    const status = document.createElement('td');
    const select = document.createElement('select');
    select.className = `status-select${row.status === 'unused' ? '' : ` ${row.status}`}`;
    select.setAttribute('aria-label', `Status for ${row.formatted}`);
    for (const value of ['unused', 'assigned', 'used']) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = statusLabel(value);
      option.selected = row.status === value;
      select.append(option);
    }
    select.addEventListener('change', async () => {
      select.disabled = true;
      try {
        await call('setStatus', { id: row.id, status: select.value });
        toast(`Marked ${statusLabel(select.value).toLowerCase()}`);
        await refresh();
      } catch (error) {
        toast(error.message, 'error');
        await refresh();
      }
    });
    status.append(select);

    const customer = document.createElement('td');
    const input = document.createElement('input');
    input.className = 'customer-input';
    input.value = row.assigned_to || '';
    input.placeholder = 'Unassigned';
    input.maxLength = 120;
    input.setAttribute('aria-label', `Customer for ${row.formatted}`);
    const commit = async () => {
      if ((row.assigned_to || '') === input.value.trim()) return;
      try {
        await call('saveNote', { id: row.id, assignedTo: input.value.trim(), note: row.note || '' });
        await refresh();
      } catch (error) {
        toast(error.message, 'error');
      }
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') input.blur();
    });
    customer.append(input);

    const actions = document.createElement('td');
    const group = document.createElement('div');
    group.className = 'actions-cell';
    group.append(
      iconButton('⧉', 'Copy serial key', () => copyText(row.formatted, 'Serial key')),
      iconButton('↧', 'Save this serial as a text file', async () => {
        try {
          const saved = await call('export', { format: 'txt', ids: [row.id] });
          if (saved?.path) toast(`Saved to ${saved.path}`);
        } catch (error) {
          toast(error.message, 'error');
        }
      }),
      iconButton('✕', 'Delete this unused license', async () => {
        try {
          await call('removeLicense', { id: row.id });
          toast('License deleted');
          await refresh();
        } catch (error) {
          toast(error.message, 'error');
        }
      }, 'danger')
    );
    actions.append(group);

    tr.append(serialCell, product, plan, issued, expires, status, customer, actions);
    body.append(tr);
  }

  $('#empty-state').hidden = rows.length > 0;
}

async function refresh() {
  const data = await call('licenses', { search: '', status: '' });
  state.licenses = data.licenses;
  state.stats = data.stats;
  renderStats();
  renderRows();
}

/* ---- Status / keys ---------------------------------------------------- */
async function loadStatus() {
  const info = await call('status', {});
  $('#key-id').textContent = info.keyId;
  $('#app-version').textContent = info.version;
  $('#paths').textContent = `Data: ${info.userData}  ·  DB: ${info.database}`;
  $('#public-key').value = info.publicKey;
  $('#key-note').textContent = info.created
    ? `Created ${String(info.created).slice(0, 10)} · private key stays in ${info.keyFolder}`
    : 'A new key pair was just created on this computer.';
  return info;
}

/* ---- Generate --------------------------------------------------------- */
async function generate(event) {
  event.preventDefault();
  if (state.busy) return;
  setError('');
  const product = $('#product').value.trim();
  if (product.length < 2) {
    setError('Enter a product name (at least 2 characters).');
    $('#product').focus();
    return;
  }
  state.busy = true;
  $('#generate').disabled = true;
  try {
    const { license } = await call('generate', {
      product,
      plan: $('#plan').value,
      assignedTo: $('#assigned-to').value.trim(),
      note: $('#note').value.trim()
    });
    showResult(license);
    $('#note').value = '';
    await refresh();
    toast('Serial key generated');
  } catch (error) {
    setError(error.message);
    toast(error.message, 'error');
  } finally {
    state.busy = false;
    $('#generate').disabled = false;
  }
}

function showResult(license) {
  $('#result').hidden = false;
  $('#result-serial').value = license.formatted;
  const expiry = license.expires_on ? `expires ${license.expires_on}` : 'never expires';
  $('#result-meta').textContent = `${license.product} · ${license.planLabel} · ${expiry}`;
  const pillHost = $('#result-status');
  pillHost.className = `status-pill${license.status === 'unused' ? '' : ` ${license.status}`}`;
  pillHost.textContent = statusLabel(license.status);
  $('#result-serial').scrollTop = 0;
}

/* ---- Verify ----------------------------------------------------------- */
async function verify() {
  const out = $('#verify-out');
  const raw = $('#verify-input').value.trim();
  if (!raw) {
    out.className = 'verify-out bad';
    out.textContent = 'Paste a serial key first.';
    return;
  }
  try {
    const result = await call('verify', { serial: raw });
    if (result.valid) {
      out.className = 'verify-out good';
      out.textContent = `Genuine · ${result.product} · ${result.plan} · ${result.expires ? `expires ${result.expires}` : 'lifetime (never expires)'}`;
    } else {
      out.className = 'verify-out bad';
      out.textContent = `Not valid: ${result.reason}`;
    }
  } catch (error) {
    out.className = 'verify-out bad';
    out.textContent = error.message;
  }
}

/* ---- Wiring ----------------------------------------------------------- */
function wire() {
  $('#generate-form').addEventListener('submit', generate);
  $('#copy-serial').addEventListener('click', () => copyText($('#result-serial').value, 'Serial key'));
  $('#copy-plain').addEventListener('click', () => copyText(plain($('#result-serial').value), 'Serial key'));
  $('#copy-json').addEventListener('click', () => {
    const [productLine, planLine] = ['#result-meta', '#result-status'];
    copyText(JSON.stringify({
      serial: $('#result-serial').value,
      meta: $(productLine).textContent,
      status: $(planLine).textContent
    }, null, 2), 'License JSON');
  });
  $('#verify-button').addEventListener('click', verify);
  $('#verify-input').addEventListener('keydown', event => {
    if (event.key === 'Enter') verify();
  });

  $('#search').addEventListener('input', event => {
    state.search = event.target.value;
    renderRows();
  });
  $('#status-filter').addEventListener('change', event => {
    state.status = event.target.value;
    renderRows();
  });

  for (const [selector, format] of [['#export-csv', 'csv'], ['#export-json', 'json'], ['#export-txt', 'txt']]) {
    $(selector).addEventListener('click', async () => {
      try {
        const saved = await call('export', { format, ids: [] });
        if (saved?.path) toast(`Exported ${saved.count} license(s) to ${saved.path}`);
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  $('#open-folder').addEventListener('click', async () => {
    try {
      await call('openDataFolder', {});
    } catch (error) {
      toast(error.message, 'error');
    }
  });
  $('#copy-public').addEventListener('click', () => copyText($('#public-key').value, 'Public key'));
  $('#backup-keys').addEventListener('click', async () => {
    try {
      const saved = await call('backupKeys', {});
      if (saved?.path) toast(`Keys backed up to ${saved.path}`);
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

async function boot() {
  wire();
  try {
    await loadStatus();
    await refresh();
  } catch (error) {
    toast(error.message, 'error');
  }
  $('#product').focus();
}

document.addEventListener('DOMContentLoaded', boot);
