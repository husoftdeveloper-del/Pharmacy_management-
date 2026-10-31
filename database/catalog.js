'use strict';
// Table names and field names are server-owned; callers never supply SQL identifiers.
const entities = {
  categories: { permission: 'categories', fields: { name: 'text!', description: 'text', active: 'bool' } },
  manufacturers: { permission: 'manufacturers', fields: { name: 'text!', country: 'text', phone: 'text', active: 'bool' } },
  customers: { permission: 'customers', fields: { name: 'text!', phone: 'text', address: 'text', opening_balance: 'money', credit_limit: 'money', active: 'bool' } },
  suppliers: { permission: 'suppliers', fields: { name: 'text!', phone: 'text', address: 'text', opening_balance: 'money', active: 'bool' } },
  patients: { permission: 'patients', fields: { name: 'text!', phone: 'text', age: 'age', gender: 'text', notes: 'text', active: 'bool' } },
  staff: { permission: 'staff', fields: { name: 'text!', phone: 'text', position: 'text', salary: 'money', hired_on: 'date', active: 'bool' } },
  locations: { permission: 'inventory', fields: { name: 'text!', description: 'text', active: 'bool' } },
  medicines: { permission: 'inventory', fields: { name: 'text!', generic_name: 'text', sku: 'text!', barcode: 'barcode', category_id: 'id', manufacturer_id: 'id', unit: 'text!', cost: 'money', price: 'money!', reorder_level: 'int', rx_required: 'bool', storage: 'text', active: 'bool' } },
  offers: { permission: 'offers', fields: { name: 'text!', kind: 'text!', value: 'money!', min_total: 'money', starts: 'date!', ends: 'date!', active: 'bool' } },
  accounts: { permission: 'banking', fields: { code: 'text!', name: 'text!', type: 'text!', active: 'bool' } }
};
const modules = ['dashboard','pos','sales','customers','inventory','barcodes','purchases','suppliers','finance','staff','register','prescriptions','categories','patients','manufacturers','transfers','adjustments','banking','offers','stockcount','reports','users','audit','settings','backup'];
const rolePermissions = {
  admin: modules,
  pharmacist: ['dashboard','pos','sales','customers','inventory','barcodes','purchases','suppliers','prescriptions','categories','patients','manufacturers','transfers','adjustments','offers','stockcount','reports'],
  cashier: ['dashboard','pos','sales','customers','patients','prescriptions','register','barcodes'],
  accountant: ['dashboard','sales','customers','suppliers','purchases','finance','staff','register','banking','reports','backup']
};
function cleanEntity(entity, input, editing = false) {
  const config = entities[entity];
  if (!config || !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid record.');
  const result = {};
  for (const [field, type] of Object.entries(config.fields)) {
    let value = input[field];
    if (value === undefined || value === null || value === '') {
      if (type.endsWith('!') && !editing) throw new Error(`${field.replaceAll('_', ' ')} is required.`);
      if (type === 'bool') value = field === 'active' ? 1 : 0;
      else if (['id','money','int','age'].includes(type)) value = type === 'id' ? null : 0;
      else value = '';
    }
    if (type === 'id') value = value === null ? null : Number(value);
    if (['money','int','age','bool'].includes(type)) value = Number(value);
    if (type === 'id' && value !== null && (!Number.isSafeInteger(value) || value < 1)) throw new Error(`Invalid ${field}.`);
    if (['money','int','age'].includes(type) && (!Number.isFinite(value) || value < 0 || value > 1e10)) throw new Error(`Invalid ${field}.`);
    if (['int','age'].includes(type) && !Number.isSafeInteger(value)) throw new Error(`${field} must be a whole number.`);
    if (type === 'age' && value > 130) throw new Error('Age must be between 0 and 130.');
    if (type === 'bool' && ![0,1].includes(value)) throw new Error(`Invalid ${field}.`);
    if (type === 'money') value = Math.round(value * 100) / 100;
    if (type.startsWith('text') || type === 'barcode' || type === 'date') {
      value = String(value).trim();
      if (value.length > (field === 'notes' || field === 'address' ? 4000 : 180)) throw new Error(`${field} is too long.`);
      if (type.endsWith('!') && !value) throw new Error(`${field.replaceAll('_', ' ')} is required.`);
    }
    if (type === 'date' && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid ${field}.`);
    if (type === 'barcode' && value && !/^[A-Za-z0-9-]{4,64}$/.test(value)) throw new Error('Barcode must contain 4–64 letters, digits or hyphens.');
    result[field] = value;
  }
  if (entity === 'medicines' && !result.barcode) result.barcode = null;
  if (entity === 'medicines' && !result.sku) throw new Error('SKU is required.');
  if (entity === 'offers') {
    if (!['percent','fixed'].includes(result.kind)) throw new Error('Invalid offer type.');
    if (result.kind === 'percent' && result.value > 100) throw new Error('Percentage cannot exceed 100.');
    if (result.ends < result.starts) throw new Error('Offer end date must follow its start date.');
  }
  if (entity === 'accounts' && !['asset','liability','equity','income','expense'].includes(result.type)) throw new Error('Invalid account type.');
  return result;
}
module.exports = { entities, modules, rolePermissions, cleanEntity };
