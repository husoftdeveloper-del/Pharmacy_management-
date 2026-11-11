// Explicit form-to-IPC contracts. Database column names stay snake_case in
// entity forms, while transaction services use camelCase. Keep validation in
// the main process; these helpers only translate names and omit irrelevant IDs.
export function purchasePayload(data, lines) {
  return {
    supplierId: data.supplier_id,
    invoiceNo: data.invoice_no,
    discount: data.discount,
    paymentMethod: data.method,
    accountId: data.method === 'credit' ? undefined : data.account_id,
    items: lines.map(line => ({
      medicineId: line.medicine_id,
      locationId: line.location_id,
      batchNo: line.batch_no,
      expiry: line.expiry,
      quantity: line.quantity,
      cost: line.cost
    }))
  };
}
export function paymentPayload(data) {
  return {
    partyType: data.party_type,
    partyId: data.party_id,
    amount: data.amount,
    method: data.method,
    accountId: data.account_id,
    reference: data.reference
  };
}
export function expensePayload(data) {
  return {
    category: data.category,
    description: data.description,
    amount: data.amount,
    method: data.method,
    accountId: data.account_id
  };
}
export function staffPaymentPayload(kind, data) {
  const payload = {
    staffId: data.staff_id,
    method: data.method,
    accountId: data.account_id
  };
  if (kind === 'salary') {
    payload.month = data.month;
    if (data.gross !== '' && data.gross !== undefined) payload.gross = data.gross;
  } else {
    payload.amount = data.amount;
    payload.note = data.note;
  }
  return payload;
}
export function inventoryPayload(kind, data) {
  const payload = {
    batchId: data.batch_id,
    quantity: data.quantity,
    reason: data.reason
  };
  if (kind === 'transfer') payload.toLocation = data.to_location;
  return payload;
}
export function stockCountPayload(data) {
  return { action: 'create', locationId: data.location_id, note: data.note };
}
export function prescriptionPayload(data, attachment = '', mime = '') {
  return {
    patientId: data.patient_id,
    doctor: data.doctor,
    date: data.date,
    notes: data.notes,
    attachment,
    mime
  };
}
export function returnPayload(type, documentId, data, items) {
  return {
    type,
    documentId,
    items,
    reason: data.reason,
    method: data.method,
    accountId: data.method === 'credit' ? undefined : data.account_id
  };
}
