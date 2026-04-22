// ─── STATE ────────────────────────────────────────────────────────────────────
const state = {
  customers: [],
  custIndex: -1,
  selectedPhone: null,
  currentTab: 'calllog',
  editMode: null,   // 'add' | 'edit'
  subEditMode: null,
  subSelected: null,  // selected row data for each tab
  lookup: { city:[], engineer:[], industry:[], swname:[], serviceday:[], servicehr:[] },
  settingsTab: 'city',
  settingsSelected: {}   // { city: null, engineer: null, ... }
};

// ─── API HELPERS ──────────────────────────────────────────────────────────────
async function api(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}
const GET  = url        => api('GET',    url);
const POST = (url, b)   => api('POST',   url, b);
const PUT  = (url, b)   => api('PUT',    url, b);
const DEL  = url        => api('DELETE', url);

// ─── INIT ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  loadLookups();
  loadCustomers();
  updateClock();
  setInterval(updateClock, 1000);
});

function updateClock() {
  const now = new Date();
  document.getElementById('sb-time').textContent =
    now.toLocaleDateString() + '  ' + now.toLocaleTimeString();
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + String(d.getDate()).padStart(2,'0');
}
function timeStr() {
  const d = new Date();
  return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}

function setStatus(msg, isErr) {
  const el = document.getElementById('sb-msg');
  el.textContent = msg;
  el.style.color = isErr ? 'red' : '';
}

// ─── LOOKUPS ──────────────────────────────────────────────────────────────────
async function loadLookups() {
  const tables = ['city','engineer','industry','swname','serviceday','servicehr'];
  await Promise.all(tables.map(async t => {
    try {
      state.lookup[t] = await GET(`/api/lookup/${t}`);
    } catch(e) {}
  }));
  populateLookupDropdowns();
}

function populateLookupDropdowns() {
  // Industry in customer modal
  fillSelect('m-Industry', state.lookup.industry, 'Industry', '', '-- Select --');
  // ServiceDay/HR in customer modal
  fillSelect('m-ServiceDay', state.lookup.serviceday, 'ServiceDay', '', '-- Select --');
  fillSelect('m-ServiceHR', state.lookup.servicehr, 'ServiceHR', '', '-- Select --');
  // HandleBy in calllog / swfix / hwrma
  fillSelect('cl-HandleBy', state.lookup.engineer, 'Engineer', '', '-- Select --');
  fillSelect('sf-HandleBy', state.lookup.engineer, 'Engineer', '', '-- Select --');
  fillSelect('rma-HandleBy', state.lookup.engineer, 'Engineer', '', '-- Select --');
  // Software in swfix
  fillSelect('sf-SoftwareName', state.lookup.swname, 'Software_Name', '', '-- Select --');
}

function fillSelect(id, arr, field, valueField, placeholder) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = placeholder ? `<option value="">${placeholder}</option>` : '';
  arr.forEach(r => {
    const val = valueField ? r[valueField] : r[field];
    const opt = document.createElement('option');
    opt.value = val !== undefined ? val : r[field];
    opt.textContent = r[field];
    sel.appendChild(opt);
  });
  sel.value = cur;
}

// ─── CUSTOMER LIST ────────────────────────────────────────────────────────────
async function loadCustomers() {
  try {
    setStatus('Loading customers...');
    const name  = document.getElementById('srch-name').value.trim();
    const phone = document.getElementById('srch-phone').value.trim();
    let url = '/api/customers';
    const params = [];
    if (name)  params.push('name='  + encodeURIComponent(name));
    if (phone) params.push('phone=' + encodeURIComponent(phone));
    if (params.length) url += '?' + params.join('&');
    state.customers = await GET(url);
    renderCustGrid();
    setStatus(`${state.customers.length} customer(s) found`);
    document.getElementById('sb-count').textContent = `Total: ${state.customers.length}`;
  } catch(e) {
    setStatus('Error loading customers: ' + e.message, true);
  }
}

function doSearch() { loadCustomers(); }
function clearSearch() {
  document.getElementById('srch-name').value = '';
  document.getElementById('srch-phone').value = '';
  loadCustomers();
}

function renderCustGrid() {
  const tbody = document.getElementById('cust-tbody');
  tbody.innerHTML = '';
  state.customers.forEach((c, i) => {
    const tr = document.createElement('tr');
    tr.dataset.index = i;
    tr.innerHTML = `<td>${esc(c.Phone_num)}</td><td>${esc(c.Cust_Name||'')}</td>`;
    tr.onclick = () => selectCustomer(i);
    tr.ondblclick = () => { selectCustomer(i); openCustModal('edit'); };
    tbody.appendChild(tr);
  });
  updateCustNav();
  if (state.custIndex >= 0 && state.custIndex < state.customers.length) {
    highlightCustRow(state.custIndex);
  }
}

function selectCustomer(index) {
  state.custIndex = index;
  state.selectedPhone = state.customers[index]?.Phone_num;
  highlightCustRow(index);
  updateCustNav();
  document.getElementById('btn-edit-cust').disabled = false;
  document.getElementById('btn-del-cust').disabled = false;
  loadCustomerDetail(state.selectedPhone);
}

function highlightCustRow(index) {
  document.querySelectorAll('#cust-tbody tr').forEach(r => r.classList.remove('selected'));
  const row = document.querySelector(`#cust-tbody tr[data-index="${index}"]`);
  if (row) { row.classList.add('selected'); row.scrollIntoView({ block: 'nearest' }); }
}

function updateCustNav() {
  const total = state.customers.length;
  const pos   = state.custIndex >= 0 ? state.custIndex + 1 : 0;
  document.getElementById('cust-status').textContent = total ? `Record: ${pos} of ${total}` : 'No records';
}

function custNav(dir) {
  if (!state.customers.length) return;
  let i = state.custIndex;
  if (dir === 'first') i = 0;
  else if (dir === 'last') i = state.customers.length - 1;
  else if (dir === 'prev') i = Math.max(0, i - 1);
  else if (dir === 'next') i = Math.min(state.customers.length - 1, i + 1);
  selectCustomer(i);
}

async function loadCustomerDetail(phone) {
  try {
    const cust = await GET(`/api/customers/${encodeURIComponent(phone)}`);
    showCustomerFields(cust);
    switchTab('custinfo');
  } catch(e) {
    setStatus('Error: ' + e.message, true);
  }
}

function showCustomerFields(cust) {
  document.getElementById('no-selection').style.display = 'none';
  document.getElementById('sub-tabs').style.display = 'flex';
  const fields = ['Phone_num','Ext1','Cust_Name','Street','City','Province',
    'Contract_Service','Contact_Person','Postal_Code','Fax','Industry',
    'Installation_Date','Phone2','EMail','Remote_Access',
    'Warranty_Expiry_DateHW','Warranty_Expiry_DateSF','ServiceDay','ServiceHR',
    'AnyDesk','RustDesk','InstallationSummary'];
  fields.forEach(f => {
    const el = document.getElementById('d-' + f);
    if (el) el.value = cust[f] || '';
  });
}

// ─── CUSTOMER CRUD ────────────────────────────────────────────────────────────
function openCustModal(mode) {
  state.editMode = mode;
  document.getElementById('modal-cust-title').textContent = mode === 'add' ? 'Add Customer' : 'Edit Customer';

  // Repopulate dropdowns in case lookups changed
  fillSelect('m-Industry', state.lookup.industry, 'Industry', '', '-- Select --');
  fillSelect('m-ServiceDay', state.lookup.serviceday, 'ServiceDay', '', '-- Select --');
  fillSelect('m-ServiceHR', state.lookup.servicehr, 'ServiceHR', '', '-- Select --');

  const custFields = ['Phone_num','Ext1','Cust_Name','Street','City','Province',
    'Contract_Service','Contact_Person','Postal_Code','Fax','Industry',
    'Installation_Date','Last_Modified_Date','Phone2','EMail','Remote_Access',
    'Warranty_Expiry_DateHW','Warranty_Expiry_DateSF','ServiceDay','ServiceHR',
    'CreditCardType','CreditCardNum','CreditCardHolder','CreditCardExpDate',
    'InstallationSummary','URLAddress','AnyDesk','RustDesk'];

  if (mode === 'add') {
    custFields.forEach(f => { const el = document.getElementById('m-'+f); if (el) el.value = ''; });
    document.getElementById('m-Phone_num').readOnly = false;
  } else {
    if (!state.selectedPhone) return alert('Please select a customer first.');
    const cust = state.customers[state.custIndex];
    custFields.forEach(f => {
      const el = document.getElementById('m-'+f);
      if (el) el.value = cust[f] || '';
    });
    // Reload full record to populate all fields including dropdowns
    GET(`/api/customers/${encodeURIComponent(state.selectedPhone)}`).then(full => {
      custFields.forEach(f => { const el = document.getElementById('m-'+f); if (el) el.value = full[f] || ''; });
    });
    document.getElementById('m-Phone_num').readOnly = true;
  }
  showModal('modal-cust');
}

function getCustFormData() {
  const fields = ['Phone_num','Ext1','Cust_Name','Street','City','Province',
    'Contract_Service','Contact_Person','Postal_Code','Fax','Industry',
    'Installation_Date','Last_Modified_Date','Phone2','EMail','Remote_Access',
    'Warranty_Expiry_DateHW','Warranty_Expiry_DateSF','ServiceDay','ServiceHR',
    'CreditCardType','CreditCardNum','CreditCardHolder','CreditCardExpDate',
    'InstallationSummary','URLAddress','AnyDesk','RustDesk'];
  const d = {};
  fields.forEach(f => { const el = document.getElementById('m-'+f); if (el) d[f] = el.value; });
  d.Last_Modified_Date = todayStr();
  return d;
}

async function saveCust() {
  try {
    const d = getCustFormData();
    if (!d.Phone_num) return alert('Phone number is required.');
    if (state.editMode === 'add') {
      await POST('/api/customers', d);
      setStatus('Customer added.');
    } else {
      await PUT(`/api/customers/${encodeURIComponent(state.selectedPhone)}`, d);
      setStatus('Customer updated.');
    }
    closeModal('modal-cust');
    await loadCustomers();
    // Re-select the customer
    const idx = state.customers.findIndex(c => c.Phone_num === d.Phone_num);
    if (idx >= 0) selectCustomer(idx);
  } catch(e) {
    alert('Error: ' + e.message);
  }
}

async function deleteCustomer() {
  if (!state.selectedPhone) return;
  const cust = state.customers[state.custIndex];
  if (!confirm(`Delete customer "${cust.Cust_Name}" (${cust.Phone_num})?`)) return;
  try {
    await DEL(`/api/customers/${encodeURIComponent(state.selectedPhone)}`);
    setStatus('Customer deleted.');
    state.selectedPhone = null;
    state.custIndex = -1;
    document.getElementById('sub-tabs').style.display = 'none';
    document.getElementById('no-selection').style.display = 'flex';
    document.getElementById('btn-edit-cust').disabled = true;
    document.getElementById('btn-del-cust').disabled = true;
    await loadCustomers();
  } catch(e) {
    alert('Error: ' + e.message);
  }
}

// ─── TABS ─────────────────────────────────────────────────────────────────────
function switchTab(tab) {
  state.currentTab = tab;
  state.subSelected = null;
  const tabNames = ['custinfo','calllog','hardware','swfix','hwrma'];
  document.querySelectorAll('#sub-tabs .tab-bar .tab').forEach((el, i) => {
    el.classList.toggle('active', tabNames[i] === tab);
  });
  document.querySelectorAll('#sub-tabs .tab-content').forEach(el => {
    el.classList.remove('active');
    el.style.display = 'none';
  });
  const tc = document.getElementById('tab-' + tab);
  if (tc) { tc.classList.add('active'); tc.style.display = 'flex'; }
  loadTab(tab);
}

async function loadTab(tab) {
  if (!state.selectedPhone) return;
  try {
    switch(tab) {
      case 'custinfo': break; // fields already populated by showCustomerFields
      case 'calllog':  renderCallLog(await GET(`/api/calllog?phone=${enc(state.selectedPhone)}`)); break;
      case 'hardware': renderHardware(await GET(`/api/hardware?phone=${enc(state.selectedPhone)}`)); break;
      case 'swfix': {
        const f = document.getElementById('swfix-status-filter')?.value || '';
        const url = `/api/swfix?phone=${enc(state.selectedPhone)}` + (f ? `&status=${enc(f)}` : '');
        renderSWFix(await GET(url)); break;
      }
      case 'hwrma': {
        const f = document.getElementById('hwrma-status-filter')?.value || '';
        const url = `/api/hwrma?phone=${enc(state.selectedPhone)}` + (f ? `&status=${enc(f)}` : '');
        renderHWRMA(await GET(url)); break;
      }
    }
  } catch(e) {
    setStatus('Error loading ' + tab + ': ' + e.message, true);
  }
}

function enc(s) { return encodeURIComponent(s || ''); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ─── REMOTE ACCESS ────────────────────────────────────────────────────────────
function openRemote(type) {
  const address = document.getElementById('d-' + (type === 'rustdesk' ? 'RustDesk' : 'AnyDesk')).value.trim();
  if (!address) return alert('No ' + (type === 'rustdesk' ? 'RustDesk' : 'AnyDesk') + ' address set for this customer.');
  const proto = type === 'rustdesk' ? 'trdesk' : 'anydesk';
  window.location.href = `${proto}://${address}`;
}

// ─── RMA PRINT ────────────────────────────────────────────────────────────────
async function printRMA() {
  const r = {
    RMANo:          gv('rma-RMANo'),
    IssueDate:      gv('rma-IssueDate'),
    Status:         gv('rma-Status'),
    DeviceName:     gv('rma-DeviceName'),
    HandleBy:       gv('rma-HandleBy'),
    cAction:        gv('rma-cAction'),
    OldSN:          gv('rma-OldSN'),
    NewSN:          gv('rma-NewSN'),
    Problem:        gv('rma-Problem'),
    Remark:         gv('rma-Remark'),
  };

  // Fetch full customer record for address fields
  let cust = state.customers[state.custIndex] || {};
  try {
    if (state.selectedPhone) {
      cust = await GET(`/api/customers/${encodeURIComponent(state.selectedPhone)}`);
    }
  } catch(e) {}

  const addrLine2 = [cust.City, cust.Province].filter(Boolean).join(', ');
  const nl = (s) => (s||'').replace(/\n/g,'<br>');
  const e  = (s) => esc(s||'');

  let blobUrl;
  try {
    const res = await fetch('/printrma.html');
    if (!res.ok) throw new Error('Could not load print template');
    let html = await res.text();

    html = html.replace(/\{\{RMANo\}\}/g, e(r.RMANo))
               .replace(/\{\{Cust_Name\}\}/g, e(cust.Cust_Name))
               .replace(/\{\{Street\}\}/g, e(cust.Street))
               .replace(/\{\{addrLine2\}\}/g, e(addrLine2))
               .replace(/\{\{Postal_Code\}\}/g, e(cust.Postal_Code))
               .replace(/\{\{DeviceName\}\}/g, e(r.DeviceName))
               .replace(/\{\{Problem\}\}/g, nl(r.Problem))
               .replace(/\{\{cAction\}\}/g, e(r.cAction))
               .replace(/\{\{OldSN\}\}/g, e(r.OldSN))
               .replace(/\{\{NewSN\}\}/g, e(r.NewSN))
               .replace(/\{\{Remark\}\}/g, nl(r.Remark))
               .replace(/\{\{IssueDate\}\}/g, e(r.IssueDate));

    blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const w = window.open(blobUrl, '_blank', 'width=780,height=960');
    if (!w) { alert('Please allow popups for this site to print RMA.'); return; }
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  } catch (err) {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    alert('Error loading RMA print template: ' + err.message);
  }
}

// ─── CALLLOG ──────────────────────────────────────────────────────────────────
function renderCallLog(rows) {
  const tbody = document.getElementById('tbody-calllog');
  tbody.innerHTML = '';
  rows.forEach((r,i) => {
    const tr = document.createElement('tr');
    tr.dataset.index = i;
    tr.innerHTML = `<td>${esc(r.SeqNo)}</td><td>${esc(r.CallDate)}</td><td>${esc(r.CallTime)}</td>
      <td>${esc(r.ServHour)}</td><td>${esc(r.Subject)}</td><td>${esc(r.Via)}</td>
      <td>${statusBadge(r.Status)}</td><td>${esc(r.Response)}</td>`;
    tr.onclick = () => selectSubRow('calllog', i, rows[i], tr);
    tbody.appendChild(tr);
  });
  window._calllogRows = rows;
}

function statusBadge(s) {
  const color = (s==='Open'||s==='NG') ? '#cc3300' : (s==='Close'||s==='OK') ? '#006600' : '#666600';
  return s ? `<span style="color:#fff;background:${color};padding:0 3px;border-radius:2px;font-size:9px">${esc(s)}</span>` : '';
}

// ─── HARDWARE ─────────────────────────────────────────────────────────────────
function renderHardware(rows) {
  const tbody = document.getElementById('tbody-hardware');
  tbody.innerHTML = '';
  rows.forEach((r,i) => {
    const tr = document.createElement('tr');
    tr.dataset.index = i;
    tr.innerHTML = `<td>${esc(r.SeqNo)}</td><td>${esc(r.Device_Name)}</td><td>${esc(r.CPU)}</td>
      <td>${esc(r.Memory)}</td><td>${esc(r.HDD)}</td><td>${esc(r.MotherBoard)}</td>
      <td>${esc(r.Monitor)}</td><td>${esc(r.Printer)}</td>`;
    tr.onclick = () => selectSubRow('hardware', i, rows[i], tr);
    tbody.appendChild(tr);
  });
  window._hardwareRows = rows;
}

// ─── SWFIX ────────────────────────────────────────────────────────────────────
function renderSWFix(rows) {
  const tbody = document.getElementById('tbody-swfix');
  tbody.innerHTML = '';
  rows.forEach((r,i) => {
    const tr = document.createElement('tr');
    tr.dataset.index = i;
    tr.innerHTML = `<td>${esc(r.CaseNum)}</td><td>${esc(r.IssueDate)}</td><td>${esc(r.SoftwareName)}</td>
      <td>${esc(r.Version)}</td><td>${esc(r.Problem)}</td><td>${esc(r.HandleBy)}</td>
      <td>${statusBadge(r.Status)}</td>`;
    tr.onclick = () => selectSubRow('swfix', i, rows[i], tr);
    tbody.appendChild(tr);
  });
  window._swfixRows = rows;
}

// ─── HWRMA ────────────────────────────────────────────────────────────────────
function renderHWRMA(rows) {
  const tbody = document.getElementById('tbody-hwrma');
  tbody.innerHTML = '';
  rows.forEach((r,i) => {
    const tr = document.createElement('tr');
    tr.dataset.index = i;
    tr.innerHTML = `<td>${esc(r.RMANo)}</td><td>${esc(r.IssueDate)}</td><td>${esc(r.DeviceName)}</td>
      <td>${esc(r.Problem)}</td><td>${esc(r.HandleBy)}</td><td>${esc(r.ShipDate)}</td>
      <td>${esc(r.ReturnDate)}</td><td>${statusBadge(r.Status)}</td>`;
    tr.onclick = () => selectSubRow('hwrma', i, rows[i], tr);
    tr.ondblclick = () => { selectSubRow('hwrma', i, rows[i], tr); openSubModal('hwrma', 'edit'); };
    tbody.appendChild(tr);
  });
  window._hwrmaRows = rows;
}

// ─── NOTES ────────────────────────────────────────────────────────────────────
function renderNotes(rows) {
  const tbody = document.getElementById('tbody-notes');
  tbody.innerHTML = '';
  rows.forEach((r,i) => {
    const tr = document.createElement('tr');
    tr.dataset.index = i;
    const preview = (r.Notes||'').substring(0,100).replace(/\n/g,' ');
    tr.innerHTML = `<td style="white-space:nowrap">${esc(r.UpdTime)}</td><td>${esc(preview)}</td>`;
    tr.onclick = () => selectSubRow('notes', i, rows[i], tr);
    tr.ondblclick = () => { selectSubRow('notes', i, rows[i], tr); openSubModal('notes', 'edit'); };
    tbody.appendChild(tr);
  });
  window._notesRows = rows;
}

async function loadNotesWindow() {
  try {
    state.subSelected = null;
    renderNotes(await GET('/api/notes'));
  } catch(e) {
    setStatus('Error loading notes: ' + e.message, true);
  }
}

async function openNotesWindow() {
  await loadNotesWindow();
  showModal('modal-notes-window');
}

// ─── SUB ROW SELECTION ────────────────────────────────────────────────────────
function selectSubRow(tab, index, rowData, trEl) {
  document.querySelectorAll(`#tbody-${tab} tr`).forEach(r => r.classList.remove('selected'));
  trEl.classList.add('selected');
  state.subSelected = rowData;
}

// ─── SUB MODAL OPEN ───────────────────────────────────────────────────────────
function openSubModal(tab, mode) {
  state.subEditMode = mode;
  if (mode === 'edit' && !state.subSelected) return alert('Please select a record first.');

  switch(tab) {
    case 'calllog':  openCallLogModal(mode); break;
    case 'hardware': openHardwareModal(mode); break;
    case 'swfix':    openSWFixModal(mode); break;
    case 'hwrma':    openHWRMAModal(mode); break;
    case 'notes':    openNotesModal(mode); break;
  }
}

function openCallLogModal(mode) {
  const r = mode === 'edit' ? state.subSelected : {};
  setVal('cl-SeqNo', r.SeqNo || '');
  setVal('cl-CallDate', r.CallDate || todayStr());
  setVal('cl-CallTime', r.CallTime || timeStr());
  setVal('cl-ServHour', r.ServHour || '');
  setVal('cl-Subject', r.Subject || '');
  setVal('cl-Action', r.Action || '');
  setVal('cl-Via', r.Via || 'P');
  setVal('cl-Response', r.Response || '');
  setVal('cl-Status', r.Status || 'OK');
  setVal('cl-HandleBy', r.HandleBy || r.Response || '');
  setVal('cl-Remark', r.Remark || '');
  showModal('modal-calllog');
}

function openHardwareModal(mode) {
  const r = mode === 'edit' ? state.subSelected : {};
  ['SeqNo','Device_Name','MotherBoard','CPU','Memory','HDD','Monitor','KB',
   'GraphicCard','Printer','Scanner','CashDrawer','Others','CustomerProvide','BorrowTo']
    .forEach(f => setVal('hw-'+f, r[f] || ''));
  showModal('modal-hardware');
}

function openSWFixModal(mode) {
  // Repopulate SW Name dropdown
  fillSelect('sf-SoftwareName', state.lookup.swname, 'Software_Name', '', '-- Select --');
  fillSelect('sf-HandleBy', state.lookup.engineer, 'Engineer', '', '-- Select --');
  const r = mode === 'edit' ? state.subSelected : {};
  setVal('sf-CaseNum', r.CaseNum || '');
  setVal('sf-IssueDate', r.IssueDate || todayStr());
  setVal('sf-SoftwareName', r.SoftwareName || '');
  setVal('sf-Version', r.Version || '');
  setVal('sf-HandleBy', r.HandleBy || '');
  setVal('sf-DeliveryMethod', r.DeliveryMethod || '');
  setVal('sf-Status', r.Status || 'Open');
  setVal('sf-Problem', r.Problem || '');
  setVal('sf-cAction', r.cAction || '');
  setVal('sf-Remark', r.Remark || '');
  document.getElementById('sf-CaseNum').readOnly = mode === 'edit';
  showModal('modal-swfix');
}

async function refreshNextRMANo() {
  if (state.subEditMode !== 'add') return;
  const issueDate = gv('rma-IssueDate') || todayStr();
  const data = await GET(`/api/hwrma/next-number?issueDate=${enc(issueDate)}`);
  setVal('rma-RMANo', data.RMANo || '');
}

function openHWRMAModal(mode) {
  fillSelect('rma-HandleBy', state.lookup.engineer, 'Engineer', '', '-- Select --');
  const r = mode === 'edit' ? state.subSelected : {};
  setVal('rma-RMANo', r.RMANo || '');
  setVal('rma-IssueDate', r.IssueDate || todayStr());
  setVal('rma-Status', r.Status || 'Open');
  setVal('rma-DeviceName', r.DeviceName || '');
  setVal('rma-HandleBy', r.HandleBy || '');
  setVal('rma-RepairBy', r.RepairBy || '');
  setVal('rma-cAction', r.cAction || '');
  setVal('rma-DeliveryMethod', r.DeliveryMethod || '');
  setVal('rma-VendorRMANo', r.VendorRMANo || '');
  setVal('rma-BorrowFrom', r.BorrowFrom || '');
  setVal('rma-OldSN', r.OldSN || '');
  setVal('rma-NewSN', r.NewSN || '');
  setVal('rma-ShipDate', r.ShipDate || '');
  setVal('rma-ReturnDate', r.ReturnDate || '');
  setVal('rma-Problem', r.Problem || '');
  setVal('rma-Remark', r.Remark || '');
  const rmaNoEl = document.getElementById('rma-RMANo');
  const issueDateEl = document.getElementById('rma-IssueDate');
  rmaNoEl.readOnly = true;
  issueDateEl.onchange = mode === 'add'
    ? () => refreshNextRMANo().catch(e => setStatus('Error generating RMA number: ' + e.message, true))
    : null;
  showModal('modal-hwrma');
  if (mode === 'add') {
    refreshNextRMANo().catch(e => setStatus('Error generating RMA number: ' + e.message, true));
  }
}

function openNotesModal(mode) {
  const r = mode === 'edit' ? state.subSelected : {};
  setVal('nt-Notes', r.Notes || '');
  showModal('modal-notes');
}

// ─── SUB RECORD SAVE ─────────────────────────────────────────────────────────
async function saveSubRecord(tab) {
  try {
    const phone = state.selectedPhone;
    const mode = state.subEditMode;

    switch(tab) {
      case 'calllog': {
        const d = {
          Phone_num: phone,
          SeqNo: gv('cl-SeqNo'),
          CallDate: gv('cl-CallDate'), CallTime: gv('cl-CallTime'),
          ServHour: gv('cl-ServHour'), Subject: gv('cl-Subject'),
          Action: gv('cl-Action'), Via: gv('cl-Via'),
          Response: gv('cl-Response'), Status: gv('cl-Status'), Remark: gv('cl-Remark')
        };
        if (mode === 'add') {
          await POST('/api/calllog', d);
        } else {
          await PUT(`/api/calllog/${enc(phone)}/${enc(d.SeqNo)}`, d);
        }
        closeModal('modal-calllog'); loadTab('calllog'); break;
      }
      case 'hardware': {
        const d = {
          Phone_num: phone,
          SeqNo: gv('hw-SeqNo'),
          Device_Name: gv('hw-Device_Name'), MotherBoard: gv('hw-MotherBoard'),
          CPU: gv('hw-CPU'), Memory: gv('hw-Memory'), HDD: gv('hw-HDD'),
          Monitor: gv('hw-Monitor'), KB: gv('hw-KB'), GraphicCard: gv('hw-GraphicCard'),
          Printer: gv('hw-Printer'), Scanner: gv('hw-Scanner'), CashDrawer: gv('hw-CashDrawer'),
          Others: gv('hw-Others'), CustomerProvide: gv('hw-CustomerProvide'), BorrowTo: gv('hw-BorrowTo')
        };
        if (mode === 'add') {
          await POST('/api/hardware', d);
        } else {
          await PUT(`/api/hardware/${enc(d.SeqNo)}`, d);
        }
        closeModal('modal-hardware'); loadTab('hardware'); break;
      }
      case 'swfix': {
        const d = {
          Phone_num: phone, CaseNum: gv('sf-CaseNum'),
          IssueDate: gv('sf-IssueDate'), Status: gv('sf-Status'),
          SoftwareName: gv('sf-SoftwareName'), Version: gv('sf-Version'),
          Problem: gv('sf-Problem'), cAction: gv('sf-cAction'),
          HandleBy: gv('sf-HandleBy'), DeliveryMethod: gv('sf-DeliveryMethod'),
          Remark: gv('sf-Remark')
        };
        if (!d.CaseNum) return alert('Case number is required.');
        if (mode === 'add') {
          await POST('/api/swfix', d);
        } else {
          await PUT(`/api/swfix/${enc(phone)}/${enc(d.CaseNum)}`, d);
        }
        closeModal('modal-swfix'); loadTab('swfix'); break;
      }
      case 'hwrma': {
        const d = {
          Phone_num: phone, RMANo: gv('rma-RMANo'),
          IssueDate: gv('rma-IssueDate'), Status: gv('rma-Status'),
          DeviceName: gv('rma-DeviceName'), Problem: gv('rma-Problem'),
          cAction: gv('rma-cAction'), HandleBy: gv('rma-HandleBy'),
          RepairBy: gv('rma-RepairBy'), VendorRMANo: gv('rma-VendorRMANo'),
          ShipDate: gv('rma-ShipDate'), ReturnDate: gv('rma-ReturnDate'),
          BorrowFrom: gv('rma-BorrowFrom'), OldSN: gv('rma-OldSN'), NewSN: gv('rma-NewSN'),
          DeliveryMethod: gv('rma-DeliveryMethod'), Remark: gv('rma-Remark')
        };
        if (mode === 'add') {
          const result = await POST('/api/hwrma', d);
          d.RMANo = result.RMANo || d.RMANo;
        } else {
          await PUT(`/api/hwrma/${enc(phone)}/${enc(d.RMANo)}`, d);
        }
        closeModal('modal-hwrma'); loadTab('hwrma'); break;
      }
      case 'notes': {
        const d = { Notes: gv('nt-Notes') };
        if (mode === 'add') {
          await POST('/api/notes', d);
        } else {
          await PUT(`/api/notes/${state.subSelected.ID}`, d);
        }
        closeModal('modal-notes');
        await loadNotesWindow();
        break;
      }
    }
    setStatus('Saved successfully.');
    state.subSelected = null;
  } catch(e) {
    alert('Error saving: ' + e.message);
  }
}

// ─── DELETE SUB RECORD ────────────────────────────────────────────────────────
async function deleteSubRecord(tab) {
  if (!state.subSelected) return alert('Please select a record first.');
  if (!confirm('Delete this record?')) return;
  try {
    const phone = enc(state.selectedPhone);
    switch(tab) {
      case 'calllog':
        await DEL(`/api/calllog/${phone}/${enc(state.subSelected.SeqNo)}`); break;
      case 'hardware':
        await DEL(`/api/hardware/${enc(state.subSelected.SeqNo)}`); break;
      case 'swfix':
        await DEL(`/api/swfix/${phone}/${enc(state.subSelected.CaseNum)}`); break;
      case 'hwrma':
        await DEL(`/api/hwrma/${phone}/${enc(state.subSelected.RMANo)}`); break;
      case 'notes':
        await DEL(`/api/notes/${state.subSelected.ID}`); break;
    }
    state.subSelected = null;
    if (tab === 'notes') await loadNotesWindow();
    else loadTab(tab);
    setStatus('Record deleted.');
  } catch(e) {
    alert('Error: ' + e.message);
  }
}

// ─── MODAL HELPERS ────────────────────────────────────────────────────────────
function showModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }
function gv(id) { const el = document.getElementById(id); return el ? el.value : ''; }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }

// Close modal on overlay click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('show');
  }
});

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
async function openSettings() {
  await loadLookups();
  renderAllSettings();
  showModal('modal-settings');
  switchSettingsTab('city');
}

function switchSettingsTab(tab) {
  state.settingsTab = tab;
  document.querySelectorAll('#modal-settings .tab-bar .tab').forEach((el,i) => {
    const tabs = ['city','engineer','industry','swname','serviceday','servicehr'];
    el.classList.toggle('active', tabs[i] === tab);
  });
  document.querySelectorAll('#modal-settings .tab-content').forEach(el => {
    el.classList.remove('active'); el.style.display = 'none';
  });
  const tc = document.getElementById('stab-' + tab);
  if (tc) { tc.classList.add('active'); tc.style.display = 'flex'; }

  renderSettingsGrid(tab);
}

function renderAllSettings() {
  ['city','engineer','industry','swname','serviceday','servicehr'].forEach(renderSettingsGrid);
}

function renderSettingsGrid(tab) {
  const fieldMap = { city:'City', engineer:'Engineer', industry:'Industry',
    swname:'Software_Name', serviceday:'ServiceDay', servicehr:'ServiceHR' };
  const idMap   = { city:'ID', engineer:'ID', industry:'ID',
    swname:'ID', serviceday:'Seq_num', servicehr:'Seq_num' };
  const field   = fieldMap[tab];
  const idField = idMap[tab];
  const tbody = document.getElementById('sb-' + tab);
  if (!tbody) return;
  tbody.innerHTML = '';
  (state.lookup[tab] || []).forEach(r => {
    const rid = r[idField];
    const tr = document.createElement('tr');
    tr.dataset.id = rid;
    tr.innerHTML = `<td>${rid}</td><td><input type="text" value="${esc(r[field])}" data-field="${field}" data-id="${rid}" data-tab="${tab}" style="width:100%;border:none;background:transparent;font-size:11px"
      onchange="updateLookupInline(this)"></td>`;
    tr.onclick = () => { state.settingsSelected[tab] = rid; tbody.querySelectorAll('tr').forEach(x=>x.classList.remove('selected')); tr.classList.add('selected'); };
    tbody.appendChild(tr);
  });
}

async function updateLookupInline(input) {
  const id = input.dataset.id;
  const tab = input.dataset.tab;
  const field = input.dataset.field;
  try {
    await PUT(`/api/lookup/${tab}/${id}`, { [field]: input.value });
    await loadLookups();
    populateLookupDropdowns();
  } catch(e) { alert('Error: ' + e.message); }
}

async function addLookup(tab, field) {
  const input = document.getElementById('new-' + tab);
  const val = input.value.trim();
  if (!val) return;
  try {
    await POST(`/api/lookup/${tab}`, { [field]: val });
    input.value = '';
    await loadLookups();
    renderSettingsGrid(tab);
    populateLookupDropdowns();
  } catch(e) { alert('Error: ' + e.message); }
}

async function deleteLookup(tab) {
  const id = state.settingsSelected[tab];
  if (!id) return alert('Please select a row to delete.');
  if (!confirm('Delete this entry?')) return;
  try {
    await DEL(`/api/lookup/${tab}/${id}`);
    state.settingsSelected[tab] = null;
    await loadLookups();
    renderSettingsGrid(tab);
    populateLookupDropdowns();
  } catch(e) { alert('Error: ' + e.message); }
}

