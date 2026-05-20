'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const page = document.getElementById('user-management-page');
  if (!page) return;

  activeTab = 'users';
  localStorage.setItem('kinaadman_activeTab', 'users');
  updateSidebarMenuState('users');

  const pageTitle = document.querySelector('.page-title');
  const pageSub = document.querySelector('.page-sub');

  if (pageTitle) pageTitle.textContent = 'User Management';
  if (pageSub) pageSub.textContent = 'Approve registered accounts and manage existing users.';
  if (typeof setUserManagementView === 'function') setUserManagementView('approvals');

  loadUsers();
  renderUsers();
});
