import {renderRecords} from '../components/records.js';
export async function render(root,params){return renderRecords(root.querySelector('[data-view]'),'patients',params);}
