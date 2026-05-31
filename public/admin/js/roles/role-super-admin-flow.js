(function () {
  'use strict';

  window.KinaadmanRoleFlow?.register('super_admin', {
    apply() {
      if (typeof syncStaffWorkspaceVisibility === 'function') {
        syncStaffWorkspaceVisibility('super_admin');
      }
    }
  });
})();
