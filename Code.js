const SHEET_NAME = "Deliveries";
const ACCESS_GROUP = 'package_desk_access_list@stedwards.edu';

function getDeliveriesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    throw new Error(`Sheet "${SHEET_NAME}" not found.`);
  }

  return sheet;
}

function getCurrentUserEmail_() {

  const email =
    Session.getActiveUser().getEmail();

  if (!email) {
    throw new Error('Unable to determine user email.');
  }

  return email;
}

function assertAuthorized_(){
   const userEmail = getCurrentUserEmail_();

 if (!userEmail) {
   throw new Error('You must be signed in with a Google account.');
 }

 const isMember = GroupsApp
   .getGroupByEmail(ACCESS_GROUP)
   .hasUser(userEmail);

 if (!isMember) {
   throw new Error('You are not authorized to access this app.');
 }
}



function doGet() {
 assertAuthorized_();

 return HtmlService.createHtmlOutputFromFile('Index')
 .setTitle('Package Desk Tracker')
}

function checkoutSelected(payload) {
 assertAuthorized_();

 const ids = payload?.ids || [];
 const checkedOutBy = getCurrentUserEmail_();
 const svgDataUri =
   String(payload?.signature_svg_url || '').trim();

 if (!ids.length) throw new Error('No deliveries selected.');

 const sheet = getDeliveriesSheet_();
 if (!sheet) throw new Error(`Sheet "${SHEET_NAME}" not found.`);

 const lock = LockService.getScriptLock();
 lock.waitLock(15000);

 try {
  // get signature values
  const signatureValue = svgDataUri;

   // Read all data once
   const range = sheet.getDataRange();
   const values = range.getValues();
   if (values.length < 2) {
    return { ok: true, updated: 0, skipped: ids.length };
   }

   const headers = values[0].map(h => String(h).trim());
   const idx = {};
   headers.forEach((h, i) => (idx[h] = i));

   // Required columns check
   const requiredCols = ['id','picked_up_at','checked_out_by','signature_url','signed_at'];
   for (const c of requiredCols) {
     if (idx[c] === undefined) throw new Error(`Missing column "${c}" in header row.`);
   }

   const idSet = new Set(ids.map(String));
   const nowIso = new Date().toISOString();

   let updated = 0;
   let skipped = 0;

   // Update rows in memory
   for (let r = 1; r < values.length; r++) {
     const row = values[r];
     const rowId = String(row[idx['id']] ?? '');

     if (!idSet.has(rowId)) continue;

     const pickedUpAt = String(row[idx['picked_up_at']] ?? '').trim();
     if (pickedUpAt) {
       skipped++;
       continue; // already picked up
     }

     row[idx['picked_up_at']] = nowIso;
     row[idx['checked_out_by']] = checkedOutBy;
     row[idx['signature_url']] = signatureValue;
     row[idx['signed_at']] = nowIso;

     updated++;
   }

   // Write back once
   range.setValues(values);

   return { ok: true, updated, skipped };
 } finally {
   lock.releaseLock();
 }
}

function searchPackages(query) {
 assertAuthorized_();

 const sheet = getDeliveriesSheet_();
 if (!sheet) throw new Error('Sheet "${SHEET_NAME}" not found.');

 const values = sheet.getDataRange().getValues();
 if (values.length < 2) return [];

 const header = values[0].map(h => String(h).trim());
 const idx = {};
 header.forEach((h, i) => (idx[h] = i));

 const qFirst = String(query.first_name || '').trim().toLowerCase();
 const qLast = String(query.last_name || '').trim().toLowerCase();

 const out = [];

 for (let r = 1; r < values.length; r++){
   const row = values[r];

   const pickedUpAt = String(row[idx['picked_up_at']] ?? '').trim();

   if (pickedUpAt) continue; // only get arrivals

   const first = String(row[idx['first_name']] ?? '').trim();
   const last = String(row[idx['last_name']] ?? '').trim();

   // match rules: it must match (substring, case-insensitive)
   if (qFirst && !first.toLowerCase().includes(qFirst)) continue;
   if (qLast  && !last.toLowerCase().includes(qLast)) continue;

   out.push({
     id: String(row[idx['id']] ?? ''),
     first_name: first,
     last_name: last,
     type: String(row[idx['type']] ?? ''),
     tracking_number: String(row[idx['tracking_number']] ?? ''),
     arrived_at: row[idx['arrived_at']] ?? '',
     checked_in_by: String(row[idx['checked_in_by']] ?? ''),
   });

 }
 return out;
}

function addDelivery(data) {
 assertAuthorized_();
 const sheet = getDeliveriesSheet_();
 if (!sheet) throw new Error('Sheet "${SHEET_NAME}" not found');

 // read header so we can append in the correct order no matter what
 const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h=>String(h).trim());
 const idx = {};
 header.forEach((h, i) => (idx[h] = i));

 // helpers
 const first = String(data.first_name || '').trim();
 const last = String(data.last_name || '').trim();
 const type = String(data.type || '').trim().toUpperCase();
 const tracking = String(data.tracking_number || '').trim();
 const checkedInBy = getCurrentUserEmail_();

 // validation
 if (!first) throw new Error('First Name is required');
 if (!last) throw new Error('First Name is required');
 if (type !== 'PACKAGE' && type !== 'LETTER') throw new Error('Type must be PACKAGE or LETTER');
 if (type === 'PACKAGE' && !tracking) throw new Error('Tracking number is required for packages');

 // Build row by header names
 const row = new Array(header.length).fill('');
 const now = new Date().toISOString();
 const id = Utilities.getUuid();

 if (idx['id'] !== undefined) row[idx['id']] = id;
 if (idx['first_name'] !== undefined) row[idx['first_name']] = first;
 if (idx['last_name'] !== undefined) row[idx['last_name']] = last;
 if (idx['type'] !== undefined) row[idx['type']] = type;
 if (idx['tracking_number'] !== undefined) row[idx['tracking_number']] = tracking;
 if (idx['arrived_at'] !== undefined) row[idx['arrived_at']] = now;
 if (idx['checked_in_by'] !== undefined) row[idx['checked_in_by']] = checkedInBy;

 // Leave these blank on check-in
 if (idx['picked_up_at'] !== undefined) row[idx['picked_up_at']] = '';
 if (idx['checked_out_by'] !== undefined) row[idx['checked_out_by']] = '';
 if (idx['signature_url'] !== undefined) row[idx['signature_url']] = '';
 if (idx['signed_at'] !== undefined) row[idx['signed_at']] = '';

 // lock writes to avoid collisions
 const lock = LockService.getScriptLock();
 lock.waitLock(15000);
 try {
   sheet.appendRow(row);
 } finally {
   lock.releaseLock();
 }

 return { ok: true, id};
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Signature Viewer')
    .addItem('Open Viewer', 'showSidebar')
    .addToUi();
}

function showSidebar() {

  const html =
    HtmlService
      .createHtmlOutputFromFile('Sidebar')
      .setTitle('SVG Preview');

  SpreadsheetApp.getUi()
    .showSidebar(html);
}

function getSelectedCellValue() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return '';

  const sheet = ss.getActiveSheet();
  if (!sheet) return '';

  const range = sheet.getActiveRange();
  if (!range) return '';

  return String(range.getValue() || '');
}