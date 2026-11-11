import {t} from '../scripts/i18n.js';
import {pageHeader} from '../components/ui.js';
import {renderUsers} from '../components/user-admin.js';

/* Users & permissions: the shared team account panel inside its own page. */
export async function render(root){
  root.innerHTML=pageHeader(t('users'),t('usersHint'))+'<section class="card"><div id="user-panel"></div></section>';
  await renderUsers(root.querySelector('#user-panel'));
}
