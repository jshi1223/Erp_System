(function () {
  'use strict';

  window.KinaadmanRoleFlow?.register('admin', {
    apply() {
      if (typeof syncStaffWorkspaceVisibility === 'function') {
        syncStaffWorkspaceVisibility('admin');
      }
    }
  });
})();
