'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const page = document.getElementById('user-management-page');
  if (!page) return;

  activeTab = 'users';
  localStorage.setItem('kinaadman_activeTab', 'users');
  updateSidebarMenuState('users');

  const pageTitle = document.querySelector('.page-title');
  const pageSub = document.querySelector('.page-sub');
  const addBtn = document.getElementById('btn-main-add');

  if (pageTitle) pageTitle.textContent = 'User Management';
  if (pageSub) pageSub.textContent = 'Create and manage admin, staff, and user accounts.';
  if (addBtn) {
    addBtn.textContent = 'Add User';
    addBtn.onclick = () => openUserModal();
  }

  loadUsers();
  renderUsers();
});
