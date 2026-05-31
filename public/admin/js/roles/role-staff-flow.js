(function () {
  'use strict';

  window.KinaadmanRoleFlow?.register('staff', {
    apply() {
      if (typeof syncStaffWorkspaceVisibility === 'function') {
        syncStaffWorkspaceVisibility('staff');
      }
    }
  });
})();
