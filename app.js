/**
 * ============================================================================
 * Bookstoriaga PHP/MySQL API Adapter & 401 Failsafe
 * ============================================================================
 * Handles all communication with api.php, verifies PHP sessions across the
 * split Login (index.html) and Workspace (workspace.html) pages, and clears
 * browser storage if a 401 Unauthorized response occurs.
 */
const ApiService = (() => {
  const API = 'api.php';
  const SESSION_KEY = 'bs_session_v1';
  let currentSession = null;
  let redirectingToLogin = false;

  function clearBrowserAuthStorage() {
    currentSession = null;
    try {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.clear();
    } catch (_) {
      // Ignore storage errors in restricted contexts
    }
  }

  function triggerAuthFailsafe(reason = 'expired') {
    clearBrowserAuthStorage();
    if (redirectingToLogin) return;
    const isLoginPage = Boolean(document.getElementById('authView'));
    if (!isLoginPage) {
      redirectingToLogin = true;
      const query = reason ? `?reason=${encodeURIComponent(reason)}` : '';
      window.location.replace(`index.html${query}`);
    }
  }

  async function request(action, data = {}, coverFile = null) {
    const options = {
      method: 'POST',
      credentials: 'same-origin'
    };

    if (coverFile) {
      const formData = new FormData();
      formData.append('action', action);
      Object.entries(data).forEach(([key, value]) => {
        formData.append(key, typeof value === 'string' ? value : JSON.stringify(value));
      });
      formData.append('coverImage', coverFile);
      options.body = formData;
    } else {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify({ action, ...data });
    }

    const response = await fetch(API, options);
    let result;
    try {
      result = await response.json();
    } catch (_) {
      throw new Error('The server returned an invalid response.');
    }

    if (response.status === 401) {
      if (action !== 'login' && action !== 'check_session') {
        triggerAuthFailsafe('expired');
      } else {
        clearBrowserAuthStorage();
      }
      throw new Error(result.message || 'Session expired. Please sign in again.');
    }

    if (!response.ok || result.success === false) {
      throw new Error(result.message || 'Request failed.');
    }

    return result.data;
  }

  return {
    init() {},

    clearBrowserAuthStorage,
    triggerAuthFailsafe,

    async checkSession() {
      const saved = localStorage.getItem(SESSION_KEY);
      if (!saved) {
        currentSession = null;
        return null;
      }

      try {
        // Uses an existing action in api.php that calls requireLogin()
        await request('get_inventory'); 
        currentSession = JSON.parse(saved);
        return currentSession;
      } catch (err) {
        // If the PHP session expired, request() triggers a 401 -> triggerAuthFailsafe('expired')
        clearBrowserAuthStorage();
        currentSession = null;
        return null;
      }
    },

    async login(email, password) {
      const user = await request('login', { email, password });
      currentSession = user;
      localStorage.setItem(SESSION_KEY, JSON.stringify(user));
      return user;
    },

    async changePassword(userId, currentPassword, newPassword) {
      return request('change_password', { userId, currentPassword, newPassword });
    },

    async updateProfile(userId, newName) {
      const user = await request('update_profile', { userId, newName });
      currentSession = user;
      localStorage.setItem(SESSION_KEY, JSON.stringify(user));
      return user;
    },

    getSession() {
      if (currentSession) return currentSession;
      try {
        return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      } catch (_) {
        return null;
      }
    },

    setSession(user) {
      currentSession = user;
      if (user) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(user));
      } else {
        localStorage.removeItem(SESSION_KEY);
      }
    },

    async logout() {
      clearBrowserAuthStorage();
      try {
        await request('logout');
      } catch (_) {
        // Proceed with client logout even if server session already ended
      }
    },

    async getInventory() {
      return request('get_inventory');
    },

    async saveInventoryItem(itemData, actor, coverFile) {
      return request('save_inventory_item', { itemData, actor }, coverFile);
    },

    async deleteInventoryItem(itemId, actor) {
      return request('delete_inventory_item', { itemId, actor });
    },

    async manageTags(action, payload, actor) {
      return request('manage_tags', { tagAction: action, payload, actor });
    },

    async saveSupplier(supData, actor) {
      return request('save_supplier', { supData, actor });
    },

    async deleteSupplier(supplierId, actor) {
      return request('delete_supplier', { supplierId, actor });
    },

    async submitTransaction(payload, actor) {
      return request('submit_transaction', { payload, actor });
    },

    async manageUsers(action, payload, actor) {
      return request('manage_users', { userAction: action, payload, actor });
    },

    async getLogs() {
      return request('get_logs');
    },

    getTheme() {
      return localStorage.getItem('bs_theme_v1') || 'light';
    },

    setTheme(theme) {
      localStorage.setItem('bs_theme_v1', theme);
    }
  };
})();

/**
 * ============================================================================
 * APPLICATION STATE & UI CONTROLLER
 * ============================================================================
 */
const State = {
  currentUser: null,
  activeTab: 'dashboard',
  sidebarCollapsed: false,
  bookMode: false,
  inventory: [],
  tags: [],
  suppliers: [],
  transactions: [],
  restockLogs: [],
  users: [],
  logs: [],
  // Filters & Sorting
  salesChartDays: 7,
  bestsellerPeriod: 'day',
  invSearch: '',
  invTagFilter: [],
  invSort: 'title-asc',
  invPage: 1,
  invPageSize: 6,
  supSearch: '',
  supTagFilter: [],
  supSort: 'name-asc',
  logSearch: '',
  // Separate Counter Receipt Carts for Sell vs Restock
  cartMode: 'SELL', // 'SELL' | 'RESTOCK'
  sellCart: [], // [{ itemId, qty }]
  restockCart: [], // [{ itemId, qty }]
  modalMultiSelectOpen: false,
  modalSelectedTags: [],
  modalCloseGuard: null
};

const formatPHP = (num) =>
  '₱' + Number(num || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function showToast(message) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 200);
  }, 2800);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  ApiService.setTheme(theme);
  const sw = document.getElementById('sidebarThemeSwitch');
  if (sw) {
    sw.classList.toggle('active', theme === 'dark');
  }
  const icon = document.getElementById('sidebarThemeIcon');
  if (icon) {
    icon.src = theme === 'dark' ? 'assets/icons/Dark%20Mode.png' : 'assets/icons/Light%20Mode.png';
  }
}

function setNotifDropdownOpen(isOpen) {
  const drop = document.getElementById('notifDropdown');
  const backdrop = document.getElementById('notifBackdrop');
  if (!drop) return;
  drop.classList.toggle('hidden', !isOpen);
  if (backdrop) {
    backdrop.classList.toggle('hidden', !isOpen);
  }
  document.body.classList.toggle('notif-open', isOpen);
}

// ============================================================================
// BOOTSTRAP: SPLIT LOGIN (index.html) VS WORKSPACE (workspace.html)
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  ApiService.init();
  applyTheme(ApiService.getTheme());

  const authView = document.getElementById('authView');
  const appShell = document.getElementById('appShell');

  // CASE A: Login Page (index.html)
  if (authView && !appShell) {
    bindLoginEvents();

    const params = new URLSearchParams(window.location.search);
    if (params.get('reason') === 'expired') {
      ApiService.clearBrowserAuthStorage();
      window.history.replaceState({}, '', 'index.html');
      showToast('Session expired. Please sign in again.');
    }

    try {
      const activeUser = await ApiService.checkSession();
      if (activeUser) {
        window.location.replace('workspace.html');
        return;
      }
    } catch (_) {
      ApiService.clearBrowserAuthStorage();
    }
    return;
  }

  // CASE B: Logged-In Workspace Page (workspace.html)
  if (appShell) {
    try {
      const verifiedUser = await ApiService.checkSession();
      if (!verifiedUser) {
        ApiService.triggerAuthFailsafe('expired');
        return;
      }
      bindWorkspaceEvents();
      await enterWorkspace(verifiedUser);
    } catch (_) {
      ApiService.triggerAuthFailsafe('expired');
    }
  }
});

function bindLoginEvents() {
  const toggleBtn = document.getElementById('toggleLoginPasswordBtn');
  const passInput = document.getElementById('loginPassword');

  if (toggleBtn && passInput) {
    toggleBtn.addEventListener('click', () => {
      const isHidden = passInput.type === 'password';
      passInput.type = isHidden ? 'text' : 'password';
      toggleBtn.textContent = isHidden ? 'Hide password' : 'View password';
      toggleBtn.setAttribute('aria-pressed', String(isHidden));
    });
  }

  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('loginSubmitBtn');
      if (submitBtn) submitBtn.disabled = true;
      try {
        const email = document.getElementById('loginEmail').value;
        const pass = document.getElementById('loginPassword').value;
        await ApiService.login(email, pass);
        window.location.href = 'workspace.html';
      } catch (err) {
        if (submitBtn) submitBtn.disabled = false;
        showToast(err.message);
      }
    });
  }
}

function bindWorkspaceEvents() {
  const appShell = document.getElementById('appShell');
  const mobileNavButton = document.getElementById('mobileNavToggle');
  const mobileNavSidebar = document.getElementById('leftSidebar');
  const mobileNavBackdrop = document.getElementById('mobileNavBackdrop');
  let mobileNavGesture = null;

  // Edge-swipe gesture support for mobile navigation drawer
  document.addEventListener(
    'touchstart',
    (event) => {
      if (
        !window.matchMedia('(max-width: 768px)').matches ||
        appShell.classList.contains('hidden') ||
        event.touches.length !== 1
      ) {
        mobileNavGesture = null;
        return;
      }
      const touch = event.touches[0];
      const menuWasOpen = appShell.classList.contains('mobile-nav-open');
      if (!menuWasOpen && touch.clientX > 32) {
        mobileNavGesture = null;
        return;
      }
      mobileNavGesture = {
        startX: touch.clientX,
        startY: touch.clientY,
        menuWasOpen,
        drawerWidth: mobileNavSidebar.getBoundingClientRect().width,
        offset: menuWasOpen ? 0 : -mobileNavSidebar.getBoundingClientRect().width,
        active: false
      };
    },
    { passive: true }
  );

  document.addEventListener(
    'touchmove',
    (event) => {
      if (!mobileNavGesture || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const deltaX = touch.clientX - mobileNavGesture.startX;
      const deltaY = touch.clientY - mobileNavGesture.startY;

      if (!mobileNavGesture.active) {
        if (Math.abs(deltaX) < 6) return;
        if (Math.abs(deltaX) <= Math.abs(deltaY) * 1.25) {
          if (Math.abs(deltaY) >= 6) mobileNavGesture = null;
          return;
        }
        const opening = !mobileNavGesture.menuWasOpen && deltaX > 0;
        const closing = mobileNavGesture.menuWasOpen && deltaX < 0;
        if (!opening && !closing) {
          mobileNavGesture = null;
          return;
        }
        mobileNavGesture.active = true;
        appShell.classList.add('mobile-nav-open', 'mobile-nav-dragging');
      }

      event.preventDefault();
      const width = mobileNavGesture.drawerWidth;
      mobileNavGesture.offset = mobileNavGesture.menuWasOpen
        ? Math.max(-width, Math.min(0, deltaX))
        : Math.max(-width, Math.min(0, -width + deltaX));
      const openProgress = (mobileNavGesture.offset + width) / width;
      mobileNavSidebar.style.transform = `translateX(${mobileNavGesture.offset}px)`;
      mobileNavBackdrop.style.opacity = String(openProgress);
    },
    { passive: false }
  );

  const finishMobileNavGesture = (cancelled) => {
    if (!mobileNavGesture) return;
    const gesture = mobileNavGesture;
    mobileNavGesture = null;
    if (!gesture.active) return;

    const shouldRemainOpen = cancelled
      ? gesture.menuWasOpen
      : gesture.offset > -gesture.drawerWidth / 2;
    appShell.classList.toggle('mobile-nav-open', shouldRemainOpen);
    appShell.classList.remove('mobile-nav-dragging');
    mobileNavSidebar.style.removeProperty('transform');
    mobileNavBackdrop.style.removeProperty('opacity');
    mobileNavButton.setAttribute('aria-expanded', String(shouldRemainOpen));
  };

  document.addEventListener('touchend', () => finishMobileNavGesture(false), { passive: true });
  document.addEventListener('touchcancel', () => finishMobileNavGesture(true), { passive: true });

  // Delegated handler for all .password-toggle-btn[data-toggle-pass] buttons
  document.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('[data-toggle-pass]');
    if (!toggleBtn) return;
    const targetInput = document.getElementById(toggleBtn.dataset.togglePass);
    if (!targetInput) return;
    const reveal = targetInput.type === 'password';
    targetInput.type = reveal ? 'text' : 'password';
    toggleBtn.textContent = reveal ? 'Hide' : 'Show';
    toggleBtn.setAttribute('aria-pressed', String(reveal));
  });

  // Collapsible Left Sidebar Toggle
  document.getElementById('sidebarToggleBtn').addEventListener('click', () => {
    State.sidebarCollapsed = !State.sidebarCollapsed;
    document.getElementById('leftSidebar').classList.toggle('collapsed', State.sidebarCollapsed);
  });

  // Book Mode Toggle (Keeps current page without switching to Inventory Management)
  document.getElementById('sidebarBookModeBtn').addEventListener('click', () => {
    State.bookMode = !State.bookMode;
    document.getElementById('sidebarBookModeSwitch').classList.toggle('active', State.bookMode);
    renderInventoryTable();
    showToast(State.bookMode ? 'Book Mode enabled (Cover Grid)' : 'Book Mode disabled (Table View)');
  });

  // Sidebar Dark Mode Toggle
  document.getElementById('sidebarThemeToggleBtn').addEventListener('click', () => {
    const next = ApiService.getTheme() === 'light' ? 'dark' : 'light';
    applyTheme(next);
    showToast(next === 'dark' ? 'Dark Roast Espresso enabled' : 'Oat Latte Light enabled');
  });

  // Sidebar Log Out Button (Compact, centered confirmation modal)
  document.getElementById('sidebarLogoutBtn').addEventListener('click', () => {
    openModal(`
      <div class="logout-modal-body">
        <h3 class="font-bold" style="font-size: 1.15rem; margin-bottom: 0.35rem;">Log Out</h3>
        <p class="text-sm text-secondary" style="margin-bottom: 1.2rem;">Are you sure you want to log out of your account?</p>
        <div class="flex justify-center gap-2 w-full">
          <button type="button" class="btn btn-secondary" id="cancelLogoutBtn">Cancel</button>
          <button type="button" class="btn btn-danger" id="confirmLogoutBtn">Log Out</button>
        </div>
      </div>
    `);
    const logoutBackdrop = document.getElementById('modalBackdrop');
    showConfirmationPrompt(logoutBackdrop, 'logout-confirmation');

    document.getElementById('cancelLogoutBtn').addEventListener('click', () =>
      closeConfirmationPrompt('logout-confirmation')
    );
    document.getElementById('confirmLogoutBtn').addEventListener('click', () => {
      closeConfirmationPrompt('logout-confirmation', async () => {
        closeMobileReceipt();
        State.currentUser = null;
        State.sellCart = [];
        State.restockCart = [];
        await ApiService.logout();
        window.location.replace('index.html');
      });
    });
  });

  // Main Navigation Tabs
  document.querySelectorAll('#mainNavTabs .nav-tab[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Notification Bell Dropdown, Backdrop & Scroll Containment
  const bellBtn = document.getElementById('notifBellBtn');
  const notifDrop = document.getElementById('notifDropdown');
  const notifBackdrop = document.getElementById('notifBackdrop');
  const notifList = document.getElementById('notifList');

  bellBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setNotifDropdownOpen(notifDrop.classList.contains('hidden'));
  });

  if (notifBackdrop) {
    notifBackdrop.addEventListener('click', () => setNotifDropdownOpen(false));
    notifBackdrop.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  }

  // Prevent scroll chaining at top/bottom bounds of mobile notification list
  if (notifList) {
    let notifTouchStartY = 0;
    notifList.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length === 1) {
          notifTouchStartY = e.touches[0].clientY;
        }
      },
      { passive: true }
    );

    notifList.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches.length !== 1) return;
        const currentY = e.touches[0].clientY;
        const deltaY = currentY - notifTouchStartY;
        const atTop = notifList.scrollTop <= 0;
        const atBottom = Math.ceil(notifList.scrollTop + notifList.clientHeight) >= notifList.scrollHeight;
        const noScrollNeeded = notifList.scrollHeight <= notifList.clientHeight;

        if (noScrollNeeded || (atTop && deltaY > 0) || (atBottom && deltaY < 0)) {
          e.preventDefault();
        }
      },
      { passive: false }
    );
  }

  document.addEventListener('click', (e) => {
    if (!notifDrop.contains(e.target) && !bellBtn.contains(e.target)) {
      setNotifDropdownOpen(false);
    }
    if (!e.target.closest('.tag-filter-control')) {
      document.querySelectorAll('.tag-filter-menu').forEach((menu) => menu.classList.add('hidden'));
      document.querySelectorAll('.filter-menu-toggle').forEach((btn) => btn.setAttribute('aria-expanded', 'false'));
    }
    if (!e.target.closest('.multiselect-wrap') && State.modalMultiSelectOpen) {
      State.modalMultiSelectOpen = false;
      const menu = document.getElementById('modalTagsMenu');
      if (menu) menu.classList.add('hidden');
    }
  });

  // Dashboard Sales & Profit Chart Period Filter
  document.querySelectorAll('#salesChartPeriodTabs .sub-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#salesChartPeriodTabs .sub-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      State.salesChartDays = Number(btn.dataset.days) || 7;
      renderSalesProfitLineChart();
    });
  });

  // Dashboard Bestsellers Filter
  document.querySelectorAll('#bestsellerPeriodTabs .sub-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#bestsellerPeriodTabs .sub-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      State.bestsellerPeriod = btn.dataset.period;
      renderDashboard();
    });
  });

  // Inventory Sub-tabs (Books vs Tags)
  document.querySelectorAll('[data-inv-sub]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-inv-sub]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const sub = btn.dataset.invSub;
      document.getElementById('invSubCatalog').classList.toggle('hidden', sub !== 'catalog');
      document.getElementById('invSubTags').classList.toggle('hidden', sub !== 'tags');
      if (sub !== 'catalog') closeMobileReceipt();
    });
  });

  // Inventory Search, Tag Removal & Sort
  document.getElementById('invSearchInput').addEventListener('input', (e) => {
    State.invSearch = e.target.value;
    State.invPage = 1;
    renderInventoryTable();
  });
  document.getElementById('invTagFilterBar').addEventListener('click', (e) => {
    const removeButton = e.target.closest('[data-remove-filter]');
    if (removeButton) removeInvTagFilter(removeButton.dataset.removeFilter);
  });
  document.getElementById('invSortSelect').addEventListener('change', (e) => {
    State.invSort = e.target.value;
    State.invPage = 1;
    renderInventoryTable();
  });

  // Inventory Pagination & Page Size
  document.getElementById('invPageSizeSelect').addEventListener('change', (e) => {
    State.invPageSize = Number(e.target.value) || 6;
    State.invPage = 1;
    renderInventoryTable();
  });
  document.getElementById('invPrevPageBtn').addEventListener('click', () => {
    if (State.invPage > 1) {
      State.invPage -= 1;
      renderInventoryTable();
    }
  });
  document.getElementById('invNextPageBtn').addEventListener('click', () => {
    State.invPage += 1;
    renderInventoryTable();
  });

  // Add Tag Form
  document.getElementById('addTagForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('newTagInput');
    try {
      await ApiService.manageTags('ADD', { name: input.value }, actorString());
      input.value = '';
      await refreshAllData();
      showToast('New tag created');
    } catch (err) {
      showToast(err.message);
    }
  });

  // Cart Mode Switch & Actions (Separate Sell and Restock lists)
  document.getElementById('modeSellBtn').addEventListener('click', () => setCartMode('SELL'));
  document.getElementById('modeRestockBtn').addEventListener('click', () => setCartMode('RESTOCK'));
  document.getElementById('mobileReceiptToggle').addEventListener('click', openMobileReceipt);
  document.getElementById('mobileReceiptBackdrop').addEventListener('click', closeMobileReceipt);
  document.getElementById('closeMobileReceiptBtn').addEventListener('click', closeMobileReceipt);
  document.getElementById('clearCartBtn').addEventListener('click', () => {
    if (State.cartMode === 'SELL') {
      State.sellCart = [];
    } else {
      State.restockCart = [];
    }
    renderCart();
  });
  document.getElementById('cartContinueBtn').addEventListener('click', openTransactionConfirmModal);

  // Add Book, Supplier & User Modals
  document.getElementById('openAddItemModalBtn').addEventListener('click', () => openItemFormModal(null));
  document.getElementById('openAddSupplierModalBtn').addEventListener('click', () => openSupplierFormModal(null));
  document.getElementById('openAddUserModalBtn').addEventListener('click', () => openUserFormModal(null));

  // Supplier Search, Tag Removal & Sort
  document.getElementById('supSearchInput').addEventListener('input', (e) => {
    State.supSearch = e.target.value;
    renderSuppliers();
  });
  document.getElementById('supTagFilterBar').addEventListener('click', (e) => {
    const removeButton = e.target.closest('[data-remove-filter]');
    if (removeButton) removeSupTagFilter(removeButton.dataset.removeFilter);
  });
  document.getElementById('supSortSelect').addEventListener('change', (e) => {
    State.supSort = e.target.value;
    renderSuppliers();
  });

  // Audit Logs Search
  document.getElementById('logSearchInput').addEventListener('input', (e) => {
    State.logSearch = e.target.value;
    renderLogs();
  });

  // Settings Actions: Profile Customization & Password
  const profileNameInput = document.getElementById('profileNameInput');
  profileNameInput.addEventListener('input', updateProfileUnsavedIndicator);

  document.getElementById('profileSettingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const newName = profileNameInput.value;
      const updatedUser = await ApiService.updateProfile(State.currentUser.id, newName);
      State.currentUser = updatedUser;
      document.getElementById('headerUserGreeting').textContent = `Hi, ${updatedUser.name}`;
      updateProfileUnsavedIndicator();
      await refreshAllData();
      showToast('Profile name updated');
    } catch (err) {
      showToast(err.message);
    }
  });

  document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const cur = document.getElementById('curPassInput').value;
      const next = document.getElementById('newPassInput').value;
      await ApiService.changePassword(State.currentUser.id, cur, next);
      e.target.reset();
      showToast('Password updated successfully');
      await refreshAllData();
    } catch (err) {
      showToast(err.message);
    }
  });

  // Close Modal on Backdrop Click
  document.getElementById('modalBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modalBackdrop') {
      const confirmationClass = ['logout-confirmation', 'unsaved-profile-confirmation'].find((className) =>
        e.target.classList.contains(className)
      );
      if (confirmationClass) {
        closeConfirmationPrompt(confirmationClass);
      } else {
        attemptCloseModal();
      }
    }
  });
}

const actorString = () => `${State.currentUser.name} (${State.currentUser.role})`;

function applyRolePermissions(user) {
  const isOwner = user.role === 'Owner';
  document.getElementById('headerUserGreeting').textContent = `Hi, ${user.name}`;
  document.getElementById('headerRoleBadge').textContent = user.role;
  document.getElementById('profileNameInput').value = user.name;
  document.getElementById('profileEmailDisplay').value = user.email;

  document.querySelectorAll('.owner-only').forEach((el) => {
    el.classList.toggle('hidden', !isOwner);
  });

  const profileNameInput = document.getElementById('profileNameInput');
  const saveProfileBtn = document.getElementById('saveProfileBtn');
  const profileHelpText = document.getElementById('profileHelpText');

  if (isOwner) {
    profileNameInput.removeAttribute('readonly');
    saveProfileBtn.classList.remove('hidden');
    profileHelpText.textContent = 'Update your display name shown across the workspace and audit logs.';
  } else {
    profileNameInput.setAttribute('readonly', 'readonly');
    saveProfileBtn.classList.add('hidden');
    profileHelpText.textContent = 'Display names are managed by the shop Owner.';
  }
  updateProfileUnsavedIndicator();
}

async function enterWorkspace(user) {
  State.currentUser = user;
  document.getElementById('appShell').classList.remove('hidden');

  applyRolePermissions(user);
  await refreshAllData();
  switchTab('dashboard');
}

function switchTab(tabName) {
  if (
    State.activeTab === 'settings' &&
    tabName !== 'settings' &&
    isProfileCustomizationDirty()
  ) {
    openModal(`
      <div style="text-align: center;">
        <h3 class="font-bold" style="font-size: 1.15rem; margin-bottom: 0.4rem;">Unsaved Profile Changes</h3>
        <p class="text-sm text-secondary" style="margin-bottom: 1.15rem;">Your profile customization hasn’t been saved. Leave this page and discard your changes?</p>
        <div class="flex justify-center gap-2">
          <button type="button" class="btn btn-secondary" id="cancelLeaveSettingsBtn">Stay</button>
          <button type="button" class="btn btn-danger" id="discardProfileChangesBtn">Leave Without Saving</button>
        </div>
      </div>
    `);
    const unsavedChangesBackdrop = document.getElementById('modalBackdrop');
    showConfirmationPrompt(unsavedChangesBackdrop, 'unsaved-profile-confirmation');
    document.getElementById('cancelLeaveSettingsBtn').addEventListener('click', () => {
      closeConfirmationPrompt('unsaved-profile-confirmation');
    });
    document.getElementById('discardProfileChangesBtn').addEventListener('click', () => {
      closeConfirmationPrompt('unsaved-profile-confirmation', () => {
        document.getElementById('profileNameInput').value = State.currentUser.name;
        updateProfileUnsavedIndicator();
        switchTab(tabName);
      });
    });
    return;
  }

  if (tabName !== 'inventory') closeMobileReceipt();
  State.activeTab = tabName;
  document.querySelectorAll('#mainNavTabs .nav-tab[data-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-section').forEach((sec) => {
    sec.classList.toggle('hidden', sec.id !== `tab-${tabName}`);
  });
}

function isProfileCustomizationDirty() {
  const profileNameInput = document.getElementById('profileNameInput');
  return Boolean(
    State.currentUser &&
      State.currentUser.role === 'Owner' &&
      profileNameInput &&
      profileNameInput.value.trim() !== State.currentUser.name
  );
}

function updateProfileUnsavedIndicator() {
  const badge = document.getElementById('profileUnsavedBadge');
  if (!badge) return;
  badge.classList.toggle('hidden', !isProfileCustomizationDirty());
}

async function refreshAllData() {
  const data = await ApiService.getInventory();
  State.inventory = data.items;
  State.tags = data.tags;
  State.invTagFilter = State.invTagFilter.filter((tag) => State.tags.includes(tag));
  State.supTagFilter = State.supTagFilter.filter((tag) => State.tags.includes(tag));
  State.suppliers = data.suppliers;
  State.transactions = data.transactions;
  State.restockLogs = data.restockLogs || [];

  if (State.currentUser && State.currentUser.role === 'Owner') {
    State.users = await ApiService.manageUsers('LIST');
    State.logs = await ApiService.getLogs();
  }

  renderNotifications();
  renderDashboard();
  renderInventoryModule();
  renderSuppliers();
  if (State.currentUser && State.currentUser.role === 'Owner') {
    renderUsers();
    renderLogs();
  }
}

// ============================================================================
// MODULE 2: HEADER LOW-STOCK NOTIFICATIONS (SORTED BY LOWEST STOCK FIRST)
// ============================================================================
function renderNotifications() {
  const lowItems = State.inventory
    .filter((item) => item.stock <= item.lowThreshold)
    .sort((a, b) => a.stock - b.stock || a.title.localeCompare(b.title));

  const badge = document.getElementById('notifBadge');
  const countLabel = document.getElementById('notifCountLabel');
  const list = document.getElementById('notifList');

  badge.textContent = lowItems.length;
  badge.classList.toggle('hidden', lowItems.length === 0);
  countLabel.textContent = `${lowItems.length} alert${lowItems.length === 1 ? '' : 's'}`;

  if (lowItems.length === 0) {
    list.innerHTML = `<div style="padding: 1.5rem; text-align: center;" class="text-sm text-muted">All stock levels are healthy.</div>`;
    return;
  }

  list.innerHTML = lowItems
    .map(
      (item) => `
      <div class="notif-item" onclick="jumpToInventoryItem('${item.id}')">
        <div>
          <div class="font-semibold text-sm">${escapeHtml(item.title)}</div>
          <div class="text-xs text-secondary">SKU: ${escapeHtml(item.sku)} • Threshold: ${item.lowThreshold}</div>
        </div>
        <span class="pill ${item.stock === 0 ? 'pill-danger' : 'pill-warning'}">${item.stock} left</span>
      </div>
    `
    )
    .join('');
}

window.jumpToInventoryItem = function (itemId) {
  setNotifDropdownOpen(false);
  State.invSearch = '';
  State.invTagFilter = [];
  document.getElementById('invSearchInput').value = '';

  const sortedAll = [...State.inventory].sort((a, b) => a.title.localeCompare(b.title));
  State.invSort = 'title-asc';
  document.getElementById('invSortSelect').value = 'title-asc';
  const targetIdx = sortedAll.findIndex((i) => i.id === itemId);
  State.invPage = targetIdx !== -1 ? Math.floor(targetIdx / State.invPageSize) + 1 : 1;

  document.querySelectorAll('[data-inv-sub]').forEach((b) =>
    b.classList.toggle('active', b.dataset.invSub === 'catalog')
  );
  document.getElementById('invSubCatalog').classList.remove('hidden');
  document.getElementById('invSubTags').classList.add('hidden');

  switchTab('inventory');
  renderInventoryModule();

  requestAnimationFrame(() => {
    const targetEl =
      document.getElementById(`inv-row-${itemId}`) ||
      document.getElementById(`inv-mobile-card-${itemId}`);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetEl.classList.remove('row-highlighted');
      void targetEl.offsetWidth;
      targetEl.classList.add('row-highlighted');
    }
  });
};

// ============================================================================
// MODULE 3: DASHBOARD RENDERING (KPIs, LINE CHART, LOW 5, BESTSELLERS, TOP 5 SUPPLIERS)
// ============================================================================
function renderDashboard() {
  const salesTxs = State.transactions.filter((t) => t.type === 'SELL');
  const totalRevenue = salesTxs.reduce((sum, t) => sum + t.unitPrice * t.qty, 0);
  const totalProfit = salesTxs.reduce((sum, t) => sum + (t.unitPrice - t.unitCost) * t.qty, 0);
  const totalUnits = State.inventory.reduce((sum, i) => sum + Number(i.stock), 0);
  const lowCount = State.inventory.filter((i) => i.stock <= i.lowThreshold).length;

  document.getElementById('kpiSales').textContent = formatPHP(totalRevenue);
  document.getElementById('kpiProfit').textContent = formatPHP(totalProfit);
  document.getElementById('kpiTotalUnits').textContent = totalUnits.toLocaleString();
  document.getElementById('kpiCatalogCount').textContent = `Across ${State.inventory.length} book titles`;
  document.getElementById('kpiLowStockCount').textContent = lowCount;

  renderSalesProfitLineChart();
  renderLowStockLevelsChart();
  renderBestsellersList(salesTxs);
  renderTopSuppliersList();
}

function renderSalesProfitLineChart() {
  const container = document.getElementById('salesProfitChart');
  const readout = document.getElementById('salesProfitChartReadout');
  const subtitle = document.getElementById('salesChartSubtitle');
  if (!container) return;

  const isOwner = State.currentUser && State.currentUser.role === 'Owner';
  if (subtitle) {
    subtitle.textContent = isOwner
      ? `Daily gross revenue and net profit over the last ${State.salesChartDays} days`
      : `Daily gross revenue over the last ${State.salesChartDays} days`;
  }

  const days = State.salesChartDays || 7;
  const dayBuckets = [];
  const bucketMap = new Map();
  const now = new Date();

  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
    const bucket = { key, label, revenue: 0, profit: 0 };
    dayBuckets.push(bucket);
    bucketMap.set(key, bucket);
  }

  State.transactions
    .filter((t) => t.type === 'SELL')
    .forEach((t) => {
      const d = new Date(t.timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const bucket = bucketMap.get(key);
      if (bucket) {
        bucket.revenue += t.unitPrice * t.qty;
        bucket.profit += (t.unitPrice - t.unitCost) * t.qty;
      }
    });

  const periodRev = dayBuckets.reduce((s, b) => s + b.revenue, 0);
  const periodProf = dayBuckets.reduce((s, b) => s + b.profit, 0);
  if (readout) {
    readout.innerHTML = isOwner
      ? `Last ${days} days: <strong>${formatPHP(periodRev)}</strong> gross revenue • <strong style="color: var(--status-success);">${formatPHP(periodProf)}</strong> net profit`
      : `Last ${days} days: <strong>${formatPHP(periodRev)}</strong> gross revenue`;
  }

  const width = 760;
  const height = 230;
  const padLeft = 68;
  const padRight = 22;
  const padTop = 18;
  const padBottom = 34;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxVal = Math.max(
    100,
    ...dayBuckets.map((b) => Math.max(b.revenue, isOwner ? b.profit : 0))
  );
  const yTicks = 4;

  const getX = (idx) =>
    dayBuckets.length === 1 ? padLeft + plotW / 2 : padLeft + (idx / (dayBuckets.length - 1)) * plotW;
  const getY = (val) => padTop + plotH - (Math.max(0, val) / maxVal) * plotH;

  const gridLines = [];
  for (let i = 0; i <= yTicks; i += 1) {
    const ratio = i / yTicks;
    const val = maxVal * (1 - ratio);
    const y = padTop + ratio * plotH;
    const shortVal =
      val >= 1000 ? `₱${(val / 1000).toFixed(val % 1000 === 0 ? 0 : 1)}k` : `₱${Math.round(val)}`;
    gridLines.push(`
      <line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${width - padRight}" y2="${y.toFixed(1)}" stroke="var(--border-color)" stroke-dasharray="4 4" />
      <text x="${padLeft - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="var(--text-muted)" font-size="11" font-weight="600">${shortVal}</text>
    `);
  }

  const labelStep = days <= 7 ? 1 : days <= 14 ? 2 : 5;
  const xLabels = dayBuckets
    .map((b, idx) => {
      if (idx % labelStep !== 0 && idx !== dayBuckets.length - 1) return '';
      const x = getX(idx);
      return `<text x="${x.toFixed(1)}" y="${height - 10}" text-anchor="middle" fill="var(--text-muted)" font-size="11" font-weight="600">${escapeHtml(b.label)}</text>`;
    })
    .join('');

  const revPoints = dayBuckets.map((b, idx) => `${getX(idx).toFixed(1)},${getY(b.revenue).toFixed(1)}`).join(' ');
  const profPoints = dayBuckets.map((b, idx) => `${getX(idx).toFixed(1)},${getY(b.profit).toFixed(1)}`).join(' ');

  const revDots = dayBuckets
    .map((b, idx) => {
      const cx = getX(idx).toFixed(1);
      const cy = getY(b.revenue).toFixed(1);
      return `
        <circle cx="${cx}" cy="${cy}" r="4.2" fill="var(--accent-primary)" stroke="var(--bg-surface)" stroke-width="1.8">
          <title>${escapeHtml(b.label)} — Revenue: ${formatPHP(b.revenue)}${isOwner ? ` | Profit: ${formatPHP(b.profit)}` : ''}</title>
        </circle>
      `;
    })
    .join('');

  const profDots = isOwner
    ? dayBuckets
        .map((b, idx) => {
          const cx = getX(idx).toFixed(1);
          const cy = getY(b.profit).toFixed(1);
          return `
            <circle cx="${cx}" cy="${cy}" r="4.2" fill="var(--status-success)" stroke="var(--bg-surface)" stroke-width="1.8">
              <title>${escapeHtml(b.label)} — Net Profit: ${formatPHP(b.profit)}</title>
            </circle>
          `;
        })
        .join('')
    : '';

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="sales-line-svg" role="img" aria-label="Sales and Profit Line Chart">
      ${gridLines.join('')}
      ${xLabels}
      <polyline fill="none" stroke="var(--accent-primary)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" points="${revPoints}" />
      ${
        isOwner
          ? `<polyline fill="none" stroke="var(--status-success)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" points="${profPoints}" />`
          : ''
      }
      ${revDots}
      ${profDots}
    </svg>
  `;
}

function renderLowStockLevelsChart() {
  const chartEl = document.getElementById('lowStockBarChart');
  if (!chartEl) return;

  const lowestFive = [...State.inventory]
    .sort((a, b) => a.stock - b.stock || a.title.localeCompare(b.title))
    .slice(0, 5);

  if (lowestFive.length === 0) {
    chartEl.innerHTML = `<div style="padding: 1.5rem; text-align: center;" class="text-sm text-muted">No books in inventory yet.</div>`;
    return;
  }

  const maxCap = Math.max(10, ...lowestFive.map((i) => Math.max(Number(i.stock), Number(i.lowThreshold) * 2)));

  chartEl.innerHTML = lowestFive
    .map((item) => {
      const pct = Math.min(100, Math.round((item.stock / maxCap) * 100));
      const isLow = item.stock <= item.lowThreshold;
      return `
        <div class="bar-row">
          <div class="flex justify-between text-xs font-semibold" style="gap: 0.5rem;">
            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(item.title)}</span>
            <span class="${isLow ? 'pill pill-warning' : 'text-secondary'}" style="flex-shrink: 0;">${item.stock} units</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill ${isLow ? 'low' : ''}" style="width: ${pct}%;"></div>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderBestsellersList(salesTxs) {
  const periodDurations = {
    day: 86400000,
    week: 86400000 * 7,
    month: 86400000 * 30,
    year: 86400000 * 365
  };
  const cutoff = Date.now() - periodDurations[State.bestsellerPeriod];
  const filteredSales = salesTxs.filter((t) => t.timestamp >= cutoff);

  const tallyMap = {};
  filteredSales.forEach((t) => {
    tallyMap[t.itemId] = (tallyMap[t.itemId] || 0) + t.qty;
  });

  const ranked = Object.entries(tallyMap)
    .map(([itemId, soldQty]) => ({
      item: State.inventory.find((i) => i.id === itemId),
      soldQty
    }))
    .filter((entry) => entry.item)
    .sort((a, b) => b.soldQty - a.soldQty)
    .slice(0, 5);

  const bestEl = document.getElementById('bestsellersList');
  if (ranked.length === 0) {
    bestEl.innerHTML = `<div style="padding: 1.5rem; text-align: center;" class="text-sm text-muted">No recorded sales in this ${State.bestsellerPeriod} window yet.</div>`;
  } else {
    bestEl.innerHTML = ranked
      .map(
        (entry, index) => `
        <div class="flex items-center justify-between" style="padding: 0.7rem 0.9rem; background: var(--bg-surface-alt); border-radius: var(--radius-md); gap: 0.5rem;">
          <div class="flex items-center gap-2" style="min-width: 0;">
            <span class="pill pill-accent font-bold">#${index + 1}</span>
            <div style="min-width: 0;">
              <div class="font-semibold text-sm" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(entry.item.title)}</div>
              <div class="text-xs text-secondary">${formatPHP(entry.item.sellPrice)} each</div>
            </div>
          </div>
          <span class="pill pill-success" style="flex-shrink: 0;">${entry.soldQty} sold</span>
        </div>
      `
      )
      .join('');
  }
}

function renderTopSuppliersList() {
  const container = document.getElementById('topSuppliersList');
  if (!container) return;

  // Map book titles (lowercased) to their connected supplier
  const titleToSupplierId = new Map();
  State.inventory.forEach((item) => {
    if (item.title && item.supplierId) {
      titleToSupplierId.set(item.title.trim().toLowerCase(), String(item.supplierId));
    }
  });

  // Browse audit log entries for RESTOCK_COMPLETED and tally restocked book quantities per supplier
  const sourceLogs = (State.logs && State.logs.length ? State.logs : State.restockLogs).filter(
    (entry) => entry.action === 'RESTOCK_COMPLETED'
  );

  const supplierTotals = new Map();

  sourceLogs.forEach((log) => {
    // Strip trailing "(Total: PHP ...)" from details string
    const rawItemsPart = String(log.details || '').replace(/\s*\(Total:[^)]*\)\s*$/i, '');
    const parts = rawItemsPart.split(/,\s*(?=\d+\s*x\s+)/i);

    parts.forEach((part) => {
      const match = part.trim().match(/^(\d+)\s*x\s+(.+)$/i);
      if (!match) return;
      const qty = Number(match[1]) || 0;
      const bookTitle = match[2].trim().toLowerCase();
      const supplierId = titleToSupplierId.get(bookTitle);
      if (supplierId && qty > 0) {
        supplierTotals.set(supplierId, (supplierTotals.get(supplierId) || 0) + qty);
      }
    });
  });

  const rankedSuppliers = Array.from(supplierTotals.entries())
    .map(([supplierId, restockedQty]) => ({
      supplier: State.suppliers.find((s) => String(s.id) === supplierId),
      restockedQty
    }))
    .filter((entry) => entry.supplier)
    .sort((a, b) => b.restockedQty - a.restockedQty || a.supplier.name.localeCompare(b.supplier.name))
    .slice(0, 5);

  if (rankedSuppliers.length === 0) {
    container.innerHTML = `<div style="padding: 1.5rem; text-align: center;" class="text-sm text-muted">No supplier-linked restocks recorded in audit logs yet.</div>`;
    return;
  }

  container.innerHTML = rankedSuppliers
    .map(
      (entry, index) => `
      <div class="flex items-center justify-between" style="padding: 0.7rem 0.9rem; background: var(--bg-surface-alt); border-radius: var(--radius-md); gap: 0.5rem;">
        <div class="flex items-center gap-2" style="min-width: 0;">
          <span class="pill pill-accent font-bold">#${index + 1}</span>
          <div style="min-width: 0;">
            <div class="font-semibold text-sm" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(entry.supplier.name)}</div>
            <div class="text-xs text-secondary">${escapeHtml(entry.supplier.contact || 'Distributor')} • ${entry.supplier.leadDays}d lead</div>
          </div>
        </div>
        <span class="pill pill-info" style="flex-shrink: 0;">${entry.restockedQty} restocked</span>
      </div>
    `
    )
    .join('');
}

// ============================================================================
// MODULE 4: INVENTORY MANAGEMENT, TAGS SUB-TAB & RECEIPT SIDE CART
// ============================================================================
function renderInventoryModule() {
  renderInvTagPills();
  renderInventoryTable();
  renderTagsManagement();
  renderCart();
}

function renderInvTagPills() {
  const bar = document.getElementById('invTagFilterBar');
  renderTagFilterBar(bar, 'inv', State.tags, State.invTagFilter);
}

function renderTagFilterBar(bar, type, tags, selectedTags) {
  const menuId = `${type}TagFilterMenu`;
  bar.innerHTML = `
    <div class="tag-filter-control">
      <button
        type="button"
        id="${type}TagFilterToggle"
        class="filter-pill filter-menu-toggle ${selectedTags.length ? 'active' : ''}"
        aria-haspopup="true"
        aria-controls="${menuId}"
        aria-expanded="false"
        onclick="toggleTagFilterMenu('${type}')"
      >
        Filter <span aria-hidden="true">▾</span>
      </button>
      <div id="${menuId}" class="tag-filter-menu hidden" role="group" aria-label="Available tags">
        <div class="tag-filter-options">
          ${
            tags.length
              ? tags
                  .map(
                    (tag) => `
                      <label class="tag-filter-option">
                        <input type="checkbox" data-tag-filter-option value="${escapeAttr(tag)}" ${selectedTags.includes(tag) ? 'checked' : ''} />
                        <span>${escapeHtml(tag)}</span>
                      </label>
                    `
                  )
                  .join('')
              : '<div class="tag-filter-empty">No tags available.</div>'
          }
        </div>
        <div class="tag-filter-menu-actions">
          <button type="button" class="btn btn-primary btn-sm" onclick="applyTagFilter('${type}')">Apply filters</button>
        </div>
      </div>
    </div>
    <div class="applied-filter-list">
      ${selectedTags
        .map(
          (tag) => `
            <span class="applied-filter-pill">
              <span>${escapeHtml(tag)}</span>
              <button
                type="button"
                class="applied-filter-remove"
                data-remove-filter="${escapeAttr(tag)}"
                aria-label="Remove ${escapeAttr(tag)} filter"
              ><span aria-hidden="true">×</span></button>
            </span>
          `
        )
        .join('')}
    </div>
  `;
}

window.toggleTagFilterMenu = function (type) {
  const menu = document.getElementById(`${type}TagFilterMenu`);
  const toggle = document.getElementById(`${type}TagFilterToggle`);
  const willOpen = menu.classList.contains('hidden');

  document.querySelectorAll('.tag-filter-menu').forEach((item) => item.classList.add('hidden'));
  document.querySelectorAll('.filter-menu-toggle').forEach((button) => button.setAttribute('aria-expanded', 'false'));
  menu.classList.toggle('hidden', !willOpen);
  toggle.setAttribute('aria-expanded', String(willOpen));
};

window.applyTagFilter = function (type) {
  const bar = document.getElementById(type === 'inv' ? 'invTagFilterBar' : 'supTagFilterBar');
  const selectedTags = Array.from(bar.querySelectorAll('[data-tag-filter-option]:checked')).map((input) => input.value);

  if (type === 'inv') {
    State.invTagFilter = selectedTags;
    State.invPage = 1;
    renderInvTagPills();
    renderInventoryTable();
  } else {
    State.supTagFilter = selectedTags;
    renderSuppliers();
  }
};

function removeInvTagFilter(tag) {
  State.invTagFilter = State.invTagFilter.filter((activeTag) => activeTag !== tag);
  State.invPage = 1;
  renderInvTagPills();
  renderInventoryTable();
}

function removeSupTagFilter(tag) {
  State.supTagFilter = State.supTagFilter.filter((activeTag) => activeTag !== tag);
  renderSuppliers();
}

window.toggleMobileInvCard = function (itemId) {
  const card = document.getElementById(`inv-mobile-card-${itemId}`);
  if (card) {
    card.classList.toggle('expanded');
  }
};

function renderInventoryTable() {
  const tbody = document.getElementById('inventoryTableBody');
  const mobileCardsEl = document.getElementById('inventoryMobileCards');
  const tableContainer = document.getElementById('inventoryTableContainer');
  const coverGrid = document.getElementById('inventoryBookModeGrid');
  const paginationBar = document.getElementById('inventoryPaginationBar');
  const pageIndicator = document.getElementById('invPageIndicator');
  const prevBtn = document.getElementById('invPrevPageBtn');
  const nextBtn = document.getElementById('invNextPageBtn');
  if (!tbody) return;

  const q = State.invSearch.trim().toLowerCase();

  tableContainer.classList.toggle('hidden', State.bookMode);
  if (mobileCardsEl) {
    mobileCardsEl.classList.toggle('hidden', State.bookMode);
  }
  coverGrid.classList.toggle('hidden', !State.bookMode);

  let filtered = State.inventory.filter((item) => {
    const matchesSearch =
      !q ||
      item.title.toLowerCase().includes(q) ||
      (item.author || '').toLowerCase().includes(q) ||
      item.sku.toLowerCase().includes(q) ||
      item.tags.some((t) => t.toLowerCase().includes(q));
    const matchesTag = State.invTagFilter.length === 0 || item.tags.some((tag) => State.invTagFilter.includes(tag));
    return matchesSearch && matchesTag;
  });

  filtered.sort((a, b) => {
    switch (State.invSort) {
      case 'title-desc':
        return b.title.localeCompare(a.title);
      case 'stock-asc':
        return a.stock - b.stock;
      case 'stock-desc':
        return b.stock - a.stock;
      case 'price-asc':
        return a.sellPrice - b.sellPrice;
      case 'price-desc':
        return b.sellPrice - a.sellPrice;
      default:
        return a.title.localeCompare(b.title);
    }
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem;" class="text-muted">No matching books found.</td></tr>`;
    if (mobileCardsEl) {
      mobileCardsEl.innerHTML = `<div class="card text-muted" style="text-align: center;">No matching books found.</div>`;
    }
    coverGrid.innerHTML = `<div class="card text-muted" style="grid-column: 1 / -1; text-align: center;">No matching books found.</div>`;
    paginationBar.classList.add('hidden');
    return;
  }

  paginationBar.classList.remove('hidden');
  const totalPages = Math.max(1, Math.ceil(filtered.length / State.invPageSize));
  if (State.invPage > totalPages) State.invPage = totalPages;
  if (State.invPage < 1) State.invPage = 1;

  const startIdx = (State.invPage - 1) * State.invPageSize;
  const paginatedItems = filtered.slice(startIdx, startIdx + State.invPageSize);

  pageIndicator.textContent = `Page ${State.invPage} of ${totalPages} (${filtered.length} books)`;
  prevBtn.disabled = State.invPage <= 1;
  nextBtn.disabled = State.invPage >= totalPages;

  // 1. Book Mode Cover Grid
  coverGrid.innerHTML = paginatedItems
    .map((item) => {
      const isLow = item.stock <= item.lowThreshold;
      const fallbackUrl = `https://placehold.co/300x450/7B4B2A/FFFDF9?text=${encodeURIComponent(item.title)}`;
      const imgSrc = item.coverUrl || fallbackUrl;
      return `
        <div class="book-cover-item">
          <div class="book-cover-card" onclick="openItemFormModal('${item.id}')" title="Click to edit ${escapeAttr(item.title)}">
            <img src="${escapeAttr(imgSrc)}" alt="${escapeAttr(item.title)}" onerror="this.onerror=null;this.src='${fallbackUrl}';" />
            <span class="book-cover-stock-pill ${isLow ? 'low' : ''}">${item.stock} in stock</span>
            <div class="book-cover-overlay">
              <div class="book-cover-title">${escapeHtml(item.title)}</div>
              <div class="book-cover-sub">${escapeHtml(item.author || item.sku)} • ${formatPHP(item.sellPrice)}</div>
            </div>
          </div>
          <div class="book-cover-actions">
            <button type="button" class="btn btn-primary btn-sm" onclick="addToCartWithMode('${item.id}', 'SELL')">Sell</button>
            <button type="button" class="btn btn-outline btn-sm" onclick="addToCartWithMode('${item.id}', 'RESTOCK')">Restock</button>
          </div>
        </div>
      `;
    })
    .join('');

  // 2. Desktop Table View
  tbody.innerHTML = paginatedItems
    .map((item) => {
      const isLow = item.stock <= item.lowThreshold;
      const supplier = State.suppliers.find((s) => s.id === item.supplierId);

      return `
        <tr id="inv-row-${item.id}">
          <td>
            <div class="font-bold">${escapeHtml(item.title)}</div>
            <div class="text-xs text-secondary">${escapeHtml(item.author || 'Unknown Author')} • <span class="text-muted">${escapeHtml(item.sku)}</span></div>
          </td>
          <td>
            <div class="flex" style="flex-wrap: wrap; gap: 0.3rem;">
              ${
                item.tags.length
                  ? item.tags
                      .map((t) => `<span class="pill pill-accent" style="padding: 2px 8px; font-size: 0.7rem;">${escapeHtml(t)}</span>`)
                      .join('')
                  : `<span class="text-xs text-muted">No tags</span>`
              }
            </div>
          </td>
          <td>
            <span class="text-xs font-medium text-secondary">${escapeHtml(supplier ? supplier.name : 'Unassigned')}</span>
          </td>
          <td>
            <div class="font-semibold">${formatPHP(item.sellPrice)}</div>
            <div class="text-xs text-muted">Cost: ${formatPHP(item.costPrice)}</div>
          </td>
          <td>
            <div class="flex items-center gap-1">
              <span class="font-bold">${item.stock}</span>
              ${isLow ? `<span class="pill pill-warning" title="Low stock alert">Low</span>` : ''}
            </div>
          </td>
          <td style="text-align: right; white-space: nowrap;">
            <button class="btn btn-primary btn-sm" onclick="addToCartWithMode('${item.id}', 'SELL')">Sell</button>
            <button class="btn btn-outline btn-sm" onclick="addToCartWithMode('${item.id}', 'RESTOCK')">Restock</button>
            <button class="btn btn-secondary btn-sm" onclick="openItemFormModal('${item.id}')" title="Edit Book" style="padding: 0.38rem 0.65rem; font-weight: 800;">⋮</button>
          </td>
        </tr>
      `;
    })
    .join('');

  // 3. Mobile Inventory Cards
  if (mobileCardsEl) {
    mobileCardsEl.innerHTML = paginatedItems
      .map((item) => {
        const isLow = item.stock <= item.lowThreshold;
        const supplier = State.suppliers.find((s) => s.id === item.supplierId);
        return `
          <div class="mobile-inv-card" id="inv-mobile-card-${item.id}">
            <div class="flex justify-between items-start gap-2" onclick="toggleMobileInvCard('${item.id}')" style="cursor: pointer;">
              <div style="min-width: 0;">
                <div class="font-bold text-sm">${escapeHtml(item.title)}</div>
                <div class="text-xs text-secondary">${escapeHtml(item.author || 'Unknown Author')} • ${formatPHP(item.sellPrice)}</div>
              </div>
              <div class="flex items-center gap-1" style="flex-shrink: 0;">
                <span class="pill ${isLow ? 'pill-warning' : ''}">${item.stock} left</span>
              </div>
            </div>

            <div class="mobile-inv-collapsible" style="padding-top: 0.55rem;">
              <div class="text-xs text-secondary" style="margin-bottom: 0.35rem;">
                SKU: <strong>${escapeHtml(item.sku)}</strong> • Cost: ${formatPHP(item.costPrice)} • Supplier: ${escapeHtml(supplier ? supplier.name : 'Unassigned')}
              </div>
              <div class="flex" style="flex-wrap: wrap; gap: 0.3rem;">
                ${
                  item.tags.length
                    ? item.tags
                        .map((t) => `<span class="pill pill-accent" style="padding: 2px 8px; font-size: 0.7rem;">${escapeHtml(t)}</span>`)
                        .join('')
                    : `<span class="text-xs text-muted">No tags</span>`
                }
              </div>
            </div>

            <div class="mobile-inv-actions">
              <button type="button" class="btn btn-primary btn-sm" onclick="addToCartWithMode('${item.id}', 'SELL')">Sell</button>
              <button type="button" class="btn btn-outline btn-sm" onclick="addToCartWithMode('${item.id}', 'RESTOCK')">Restock</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="openItemFormModal('${item.id}')" title="Edit Book" style="padding: 0.38rem 0.75rem; font-weight: 800;">⋮</button>
            </div>
          </div>
        `;
      })
      .join('');
  }
}

function renderTagsManagement() {
  const list = document.getElementById('tagsManagementList');
  list.innerHTML = State.tags
    .map((tag) => {
      const usageCount = State.inventory.filter((i) => i.tags.includes(tag)).length;
      return `
        <div class="flex items-center justify-between" style="padding: 0.65rem 0.95rem; background: var(--bg-surface-alt); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
          <div class="flex items-center gap-2">
            <span class="pill pill-accent">${escapeHtml(tag)}</span>
            <span class="text-xs text-secondary">${usageCount} book${usageCount === 1 ? '' : 's'}</span>
          </div>
          <div class="flex gap-1">
            <button class="btn btn-secondary btn-sm" onclick="promptRenameTag('${escapeAttr(tag)}')">Rename</button>
            <button class="btn btn-danger btn-sm" onclick="confirmDeleteTag('${escapeAttr(tag)}')">Delete</button>
          </div>
        </div>
      `;
    })
    .join('');
}

window.promptRenameTag = function (oldName) {
  openModal(`
    <h3 class="font-bold" style="font-size: 1.15rem; margin-bottom: 0.75rem;">Rename Tag</h3>
    <form id="renameTagModalForm">
      <div class="input-group">
        <label>New Tag Name</label>
        <input type="text" id="renameTagField" class="form-control" value="${escapeAttr(oldName)}" required />
      </div>
      <div class="flex justify-between gap-2" style="margin-top: 1rem;">
        <button type="button" class="btn btn-secondary w-full" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary w-full">Save Name</button>
      </div>
    </form>
  `);
  document.getElementById('renameTagModalForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const newName = document.getElementById('renameTagField').value;
      await ApiService.manageTags('RENAME', { oldName, newName }, actorString());
      closeModal();
      await refreshAllData();
      showToast('Tag renamed');
    } catch (err) {
      showToast(err.message);
    }
  });
};

window.confirmDeleteTag = function (name) {
  const usageCount = State.inventory.filter((i) => i.tags.includes(name)).length;
  openModal(`
    <h3 class="font-bold" style="font-size: 1.15rem; margin-bottom: 0.5rem;">Delete Tag</h3>
    <p class="text-sm text-secondary" style="margin-bottom: 1rem;">
      Are you sure you want to delete the tag <strong>"${escapeHtml(name)}"</strong>? It will also be removed from ${usageCount} book${usageCount === 1 ? '' : 's'} and any linked suppliers.
    </p>
    <div class="flex justify-end gap-2">
      <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button type="button" id="confirmDeleteTagBtn" class="btn btn-danger">Confirm Delete</button>
    </div>
  `);
  document.getElementById('confirmDeleteTagBtn').addEventListener('click', async () => {
    try {
      await ApiService.manageTags('DELETE', { name }, actorString());
      closeModal();
      await refreshAllData();
      showToast('Tag deleted');
    } catch (err) {
      showToast(err.message);
    }
  });
};

// ============================================================================
// RECEIPT SIDE CART & CONFIRMATION MODAL
// ============================================================================
function getActiveCart() {
  return State.cartMode === 'SELL' ? State.sellCart : State.restockCart;
}

function openMobileReceipt() {
  if (State.sellCart.length === 0 && State.restockCart.length === 0) return;
  document.getElementById('mobileReceiptBackdrop').classList.remove('hidden');
  document.getElementById('receiptCart').classList.add('mobile-receipt-expanded');
  document.getElementById('appShell').classList.add('mobile-receipt-open');
  document.body.classList.add('mobile-receipt-open');
  document.getElementById('mobileReceiptToggle').setAttribute('aria-expanded', 'true');
}

function closeMobileReceipt() {
  const backdrop = document.getElementById('mobileReceiptBackdrop');
  const receipt = document.getElementById('receiptCart');
  const toggle = document.getElementById('mobileReceiptToggle');
  if (!backdrop || !receipt || !toggle) return;
  backdrop.classList.add('hidden');
  receipt.classList.remove('mobile-receipt-expanded');
  document.getElementById('appShell').classList.remove('mobile-receipt-open');
  document.body.classList.remove('mobile-receipt-open');
  toggle.setAttribute('aria-expanded', 'false');
}

function setCartMode(mode) {
  State.cartMode = mode;
  document.getElementById('modeSellBtn').className = `receipt-mode-btn ${mode === 'SELL' ? 'active-sell' : ''}`;
  document.getElementById('modeRestockBtn').className = `receipt-mode-btn ${mode === 'RESTOCK' ? 'active-restock' : ''}`;
  document.getElementById('cartModeHint').textContent =
    mode === 'SELL'
      ? 'Selling deducts stock at customer retail price (₱).'
      : 'Restocking adds stock at supplier wholesale cost (₱).';
  renderCart();
}

window.addToCartWithMode = function (itemId, targetMode) {
  if (State.cartMode !== targetMode) {
    setCartMode(targetMode);
  }
  addToCart(itemId);
};

window.addToCart = function (itemId) {
  const item = State.inventory.find((i) => i.id === itemId);
  if (!item) return;

  const activeCart = getActiveCart();
  const existing = activeCart.find((c) => c.itemId === itemId);
  if (State.cartMode === 'SELL') {
    const currentQty = existing ? existing.qty : 0;
    if (currentQty + 1 > item.stock) {
      return showToast(`Only ${item.stock} units available in stock.`);
    }
  }

  if (existing) {
    existing.qty += 1;
  } else {
    activeCart.push({ itemId, qty: 1 });
  }
  renderCart();
};

window.updateCartQty = function (itemId, delta) {
  const activeCart = getActiveCart();
  const idx = activeCart.findIndex((c) => c.itemId === itemId);
  if (idx === -1) return;
  const item = State.inventory.find((i) => i.id === itemId);
  const nextQty = activeCart[idx].qty + delta;

  if (nextQty <= 0) {
    activeCart.splice(idx, 1);
  } else {
    if (State.cartMode === 'SELL' && item && nextQty > item.stock) {
      return showToast(`Max stock reached (${item.stock}).`);
    }
    activeCart[idx].qty = nextQty;
  }
  renderCart();
};

function renderCart() {
  const receiptEl = document.getElementById('receiptCart');
  const listEl = document.getElementById('cartItemsList');
  const qtyEl = document.getElementById('cartTotalQty');
  const amtEl = document.getElementById('cartTotalAmount');
  const continueBtn = document.getElementById('cartContinueBtn');
  const mobileReceiptCount = document.getElementById('mobileReceiptItemCount');
  const mobileReceiptAmount = document.getElementById('mobileReceiptTotalAmount');
  const activeCart = getActiveCart();
  const hasItems = State.sellCart.length > 0 || State.restockCart.length > 0;

  receiptEl.classList.toggle('hidden', !hasItems);
  document.getElementById('mobileReceiptToggle').classList.toggle('hidden', !hasItems);
  document.getElementById('invSubCatalog').classList.toggle('receipt-hidden', !hasItems);

  if (activeCart.length === 0) {
    const otherCart = State.cartMode === 'SELL' ? State.restockCart : State.sellCart;
    const otherMode = State.cartMode === 'SELL' ? 'Restock' : 'Sell';
    const otherQty = otherCart.reduce((total, entry) => total + entry.qty, 0);
    listEl.innerHTML = '';
    if (hasItems) {
      listEl.innerHTML = `<div class="text-xs text-muted" style="padding: 1.5rem 0; text-align: center;">This ${
        State.cartMode === 'SELL' ? 'Sell' : 'Restock'
      } receipt is empty.${otherQty ? ` ${otherQty} item${otherQty === 1 ? '' : 's'} remain in the ${otherMode} receipt.` : ''}</div>`;
    } else {
      closeMobileReceipt();
    }
    qtyEl.textContent = '0';
    amtEl.textContent = '₱0.00';
    mobileReceiptCount.textContent = `View ${State.cartMode === 'SELL' ? 'Sell' : 'Restock'} Receipt · 0 items`;
    mobileReceiptAmount.textContent = '₱0.00';
    continueBtn.disabled = true;
    return;
  }

  let totalQty = 0;
  let totalAmount = 0;

  listEl.innerHTML = activeCart
    .map((entry) => {
      const item = State.inventory.find((i) => i.id === entry.itemId);
      if (!item) return '';
      const unitPrice = State.cartMode === 'SELL' ? item.sellPrice : item.costPrice;
      const lineTotal = unitPrice * entry.qty;
      totalQty += entry.qty;
      totalAmount += lineTotal;

      return `
        <div class="cart-item-row">
          <div style="flex: 1; min-width: 0;">
            <div class="font-semibold text-sm" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(item.title)}</div>
            <div class="text-xs text-secondary">${formatPHP(unitPrice)} × ${entry.qty} = <strong>${formatPHP(lineTotal)}</strong></div>
          </div>
          <div class="stock-stepper">
            <button type="button" onclick="updateCartQty('${item.id}', -1)" title="Decrease">−</button>
            <span>${entry.qty}</span>
            <button type="button" onclick="updateCartQty('${item.id}', 1)" title="Increase">+</button>
          </div>
        </div>
      `;
    })
    .join('');

  qtyEl.textContent = totalQty;
  amtEl.textContent = formatPHP(totalAmount);
  mobileReceiptCount.textContent = `View Receipt · ${totalQty} item${totalQty === 1 ? '' : 's'}`;
  mobileReceiptAmount.textContent = formatPHP(totalAmount);
  continueBtn.disabled = false;
}

function openTransactionConfirmModal() {
  const activeCart = getActiveCart();
  if (activeCart.length === 0) return;
  const isSell = State.cartMode === 'SELL';
  let grandTotal = 0;

  const linesHtml = activeCart
    .map((entry) => {
      const item = State.inventory.find((i) => i.id === entry.itemId);
      if (!item) return '';
      const unitPrice = isSell ? item.sellPrice : item.costPrice;
      const sub = unitPrice * entry.qty;
      grandTotal += sub;
      return `
        <div class="flex justify-between text-sm" style="padding: 0.45rem 0; border-bottom: 1px dashed var(--border-color);">
          <span>${entry.qty}× ${escapeHtml(item.title)}</span>
          <span class="font-semibold">${formatPHP(sub)}</span>
        </div>
      `;
    })
    .join('');

  openModal(`
    <h3 class="font-bold" style="font-size: 1.2rem; margin-bottom: 0.35rem;">
      ${isSell ? 'Confirm Customer Sale' : 'Confirm Supplier Restock'}
    </h3>
    <p class="text-xs text-secondary" style="margin-bottom: 1rem;">
      ${isSell ? 'Stock quantities will be deducted immediately upon confirmation.' : 'Stock quantities will be added to inventory immediately.'}
    </p>
    <div style="background: var(--bg-input); padding: 0.9rem 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-color); margin-bottom: 1rem;">
      ${linesHtml}
      <div class="flex justify-between font-bold" style="margin-top: 0.75rem; font-size: 1.05rem;">
        <span>Total ${isSell ? 'Payable' : 'Cost'}</span>
        <span style="color: var(--accent-primary);">${formatPHP(grandTotal)}</span>
      </div>
    </div>
    <div class="flex justify-end gap-2">
      <button type="button" class="btn btn-secondary" onclick="closeModal()">Back</button>
      <button type="button" id="confirmTxSubmitBtn" class="btn btn-primary">
        ${isSell ? 'Complete Sale' : 'Confirm Restock'}
      </button>
    </div>
  `);

  document.getElementById('confirmTxSubmitBtn').addEventListener('click', async () => {
    try {
      const res = await ApiService.submitTransaction(
        { mode: State.cartMode, cartItems: activeCart },
        actorString()
      );
      if (State.cartMode === 'SELL') {
        State.sellCart = [];
      } else {
        State.restockCart = [];
      }
      closeModal();
      await refreshAllData();
      showToast(`Receipt #${res.receiptRef} completed (${formatPHP(res.grandTotal)})`);
    } catch (err) {
      showToast(err.message);
    }
  });
}

// ============================================================================
// ADD / EDIT BOOK MODAL
// ============================================================================
window.openItemFormModal = function (itemId) {
  const existing = itemId ? State.inventory.find((i) => i.id === itemId) : null;
  State.modalSelectedTags = existing ? [...existing.tags] : [];
  State.modalMultiSelectOpen = false;
  const isNew = !existing;
  const defaultCover =
    existing && existing.coverUrl
      ? existing.coverUrl
      : `https://placehold.co/300x450/7B4B2A/FFFDF9?text=${encodeURIComponent(existing ? existing.title : 'Book Cover')}`;

  openModal(
    `
    <h3 class="font-bold" style="font-size: 1.18rem; margin-bottom: 1rem;">${existing ? 'Edit Book Details' : 'Add New Book'}</h3>
    <form id="itemModalForm">
      <!-- SECTION 1: BOOK INFORMATION -->
      <div class="modal-section">
        <div class="modal-section-title">Book Information</div>

        <div class="flex gap-3 items-start" style="margin-bottom: 0.95rem;">
          <img id="fItemCoverPreview" class="edit-cover-preview" src="${escapeAttr(defaultCover)}" alt="Book Cover Preview" onerror="this.onerror=null;this.src='https://placehold.co/300x450/7B4B2A/FFFDF9?text=No+Cover';" />
          <div class="w-full" style="min-width: 0;">
            <div class="input-group" style="margin-bottom: 0.65rem;">
              <label>Book Title</label>
              <div class="editable-field-row">
                <input type="text" id="fItemTitle" class="form-control" value="${existing ? escapeAttr(existing.title) : ''}" placeholder="e.g., Chainsaw Man Vol. 16" ${isNew ? '' : 'readonly'} required />
                ${isNew ? '' : `<button type="button" class="btn btn-secondary btn-sm" onclick="unlockModalField('fItemTitle', this)" title="Edit Book Title">Edit</button>`}
              </div>
            </div>
            <div class="input-group" style="margin-bottom: 0;">
              <label for="fItemCoverFile">Cover Image</label>
              <input type="file" id="fItemCoverFile" class="form-control" accept="image/jpeg,image/png,image/webp" />
              <small class="text-muted">JPG, PNG, or WebP; maximum 5 MB. Leave empty to keep the current cover.</small>
            </div>
          </div>
        </div>

        <div class="input-group">
          <label>Author</label>
          <div class="editable-field-row">
            <input type="text" id="fItemAuthor" class="form-control" value="${existing ? escapeAttr(existing.author || '') : ''}" placeholder="e.g., Tatsuki Fujimoto" ${isNew ? '' : 'readonly'} required />
            ${isNew ? '' : `<button type="button" class="btn btn-secondary btn-sm" onclick="unlockModalField('fItemAuthor', this)" title="Edit Author">Edit</button>`}
          </div>
        </div>

        <div class="input-group">
          <label>Description</label>
          <textarea id="fItemDesc" class="form-control" rows="2" placeholder="Short synopsis or edition notes...">${existing ? escapeHtml(existing.description || '') : ''}</textarea>
        </div>

        <div class="flex gap-2">
          <div class="input-group w-full" style="margin-bottom: 0;">
            <label>SKU Code</label>
            <input type="text" id="fItemSku" class="form-control" value="${existing ? escapeAttr(existing.sku) : ''}" placeholder="MNG-CSM-16" required />
          </div>
          <div class="input-group w-full" style="margin-bottom: 0;">
            <label>Tags (Multi-Select)</label>
            <div class="multiselect-wrap">
              <div class="multiselect-trigger" id="modalTagsTrigger" onclick="toggleModalMultiSelect(event)"></div>
              <div class="multiselect-menu hidden" id="modalTagsMenu" onclick="event.stopPropagation()"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- SECTION 2: STOCK INFORMATION -->
      <div class="modal-section" style="margin-bottom: 0;">
        <div class="modal-section-title">Stock Information</div>

        <div class="flex gap-2">
          <div class="input-group w-full">
            <label>Current Stock</label>
            <input type="number" min="0" id="fItemStock" class="form-control" value="${existing ? existing.stock : 10}" ${isNew ? '' : 'readonly'} required />
          </div>
          <div class="input-group w-full">
            <label>Low-Stock Alert Count</label>
            <input type="number" min="1" id="fItemThreshold" class="form-control" value="${existing ? existing.lowThreshold : 5}" required />
          </div>
        </div>

        <div class="input-group">
          <label>Supplier</label>
          <select id="fItemSupplier" class="form-control">
            <option value="">Unassigned</option>
            ${State.suppliers
              .map(
                (s) =>
                  `<option value="${s.id}" ${existing && existing.supplierId === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
              )
              .join('')}
          </select>
        </div>

        <div class="flex gap-2" style="margin-bottom: 0;">
          <div class="input-group w-full" style="margin-bottom: 0;">
            <label>Supplier Cost (₱)</label>
            <input type="number" step="0.01" min="0" id="fItemCost" class="form-control" value="${existing ? existing.costPrice : 350}" required />
          </div>
          <div class="input-group w-full" style="margin-bottom: 0;">
            <label>Retail Price (₱)</label>
            <input type="number" step="0.01" min="0" id="fItemSell" class="form-control" value="${existing ? existing.sellPrice : 599}" required />
          </div>
        </div>
      </div>

      <div class="flex justify-between gap-2" style="margin-top: 1.25rem;">
        ${existing ? `<button type="button" id="deleteItemBtn" class="btn btn-danger">Delete</button>` : '<div></div>'}
        <div class="flex gap-2">
          <button type="button" class="btn btn-secondary" onclick="attemptCloseModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Book</button>
        </div>
      </div>
    </form>
  `,
    () => {
      showToast('Changes were not saved');
    }
  );

  renderModalTagsMultiSelect();

  const formEl = document.getElementById('itemModalForm');
  const coverInput = document.getElementById('fItemCoverFile');
  const coverPreview = document.getElementById('fItemCoverPreview');

  coverInput.addEventListener('change', () => {
    const file = coverInput.files[0];
    if (!file) return;
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type) || file.size > 5 * 1024 * 1024) {
      coverInput.value = '';
      showToast('Choose a JPG, PNG, or WebP image no larger than 5 MB.');
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (coverInput.files[0] === file) coverPreview.src = reader.result;
    });
    reader.readAsDataURL(file);
  });

  formEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
    }
  });

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const titleVal = document.getElementById('fItemTitle').value.trim();
    const coverFile = coverInput.files[0] || null;
    const payload = {
      id: existing ? existing.id : null,
      title: titleVal,
      coverUrl:
        existing && existing.coverUrl
          ? existing.coverUrl
          : `https://placehold.co/300x450/7B4B2A/FFFDF9?text=${encodeURIComponent(titleVal)}`,
      author: document.getElementById('fItemAuthor').value.trim(),
      description: document.getElementById('fItemDesc').value.trim(),
      sku: document.getElementById('fItemSku').value.trim(),
      supplierId: document.getElementById('fItemSupplier').value,
      costPrice: Number(document.getElementById('fItemCost').value),
      sellPrice: Number(document.getElementById('fItemSell').value),
      stock: Number(document.getElementById('fItemStock').value),
      lowThreshold: Number(document.getElementById('fItemThreshold').value),
      tags: [...State.modalSelectedTags]
    };
    try {
      await ApiService.saveInventoryItem(payload, actorString(), coverFile);
      closeModal();
      await refreshAllData();
      showToast(existing ? 'Book updated' : 'New book added');
    } catch (err) {
      showToast(err.message);
    }
  });

  if (existing) {
    document.getElementById('deleteItemBtn').addEventListener('click', () => {
      openModal(`
        <h3 class="font-bold" style="font-size: 1.15rem; margin-bottom: 0.5rem;">Delete Book</h3>
        <p class="text-sm text-secondary" style="margin-bottom: 1.15rem;">
          Are you sure you want to delete <strong>"${escapeHtml(existing.title)}"</strong>? Its transaction history will also be removed.
        </p>
        <div class="flex justify-end gap-2">
          <button type="button" class="btn btn-secondary" onclick="openItemFormModal('${existing.id}')">Back</button>
          <button type="button" id="confirmDeleteBookBtn" class="btn btn-danger">Confirm Delete</button>
        </div>
      `);
      document.getElementById('confirmDeleteBookBtn').addEventListener('click', async () => {
        try {
          await ApiService.deleteInventoryItem(existing.id, actorString());
          State.sellCart = State.sellCart.filter((c) => c.itemId !== existing.id);
          State.restockCart = State.restockCart.filter((c) => c.itemId !== existing.id);
          closeModal();
          await refreshAllData();
          showToast('Book removed');
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  }
};

window.unlockModalField = function (inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.removeAttribute('readonly');
  input.focus();
  input.select();
  btn.classList.add('hidden');
};

window.toggleModalMultiSelect = function (e) {
  e.stopPropagation();
  State.modalMultiSelectOpen = !State.modalMultiSelectOpen;
  const menu = document.getElementById('modalTagsMenu');
  if (menu) menu.classList.toggle('hidden', !State.modalMultiSelectOpen);
};

window.toggleModalTagOption = function (tag) {
  if (State.modalSelectedTags.includes(tag)) {
    State.modalSelectedTags = State.modalSelectedTags.filter((t) => t !== tag);
  } else {
    State.modalSelectedTags.push(tag);
  }
  renderModalTagsMultiSelect();
};

function renderModalTagsMultiSelect() {
  const trigger = document.getElementById('modalTagsTrigger');
  const menu = document.getElementById('modalTagsMenu');
  if (!trigger || !menu) return;

  trigger.innerHTML = State.modalSelectedTags.length
    ? State.modalSelectedTags
        .map((t) => `<span class="pill pill-accent" style="padding: 2px 8px; font-size: 0.72rem;">${escapeHtml(t)}</span>`)
        .join('')
    : `<span class="text-xs text-muted">Select tags...</span>`;

  menu.innerHTML = State.tags
    .map((tag) => {
      const checked = State.modalSelectedTags.includes(tag);
      return `
        <label class="multiselect-option">
          <input type="checkbox" ${checked ? 'checked' : ''} onchange="toggleModalTagOption('${escapeAttr(tag)}')" />
          <span>${escapeHtml(tag)}</span>
        </label>
      `;
    })
    .join('');
}

// ============================================================================
// MODULE 5: SUPPLIER MANAGEMENT
// ============================================================================
function renderSuppliers() {
  const bar = document.getElementById('supTagFilterBar');
  renderTagFilterBar(bar, 'sup', State.tags, State.supTagFilter);

  const q = State.supSearch.trim().toLowerCase();
  let list = State.suppliers.filter((s) => {
    const matchesQ =
      !q ||
      s.name.toLowerCase().includes(q) ||
      s.contact.toLowerCase().includes(q) ||
      s.email.toLowerCase().includes(q);
    const matchesTag = State.supTagFilter.length === 0 || s.tags.some((tag) => State.supTagFilter.includes(tag));
    return matchesQ && matchesTag;
  });

  list.sort((a, b) => {
    if (State.supSort === 'name-desc') return b.name.localeCompare(a.name);
    if (State.supSort === 'lead-asc') return a.leadDays - b.leadDays;
    return a.name.localeCompare(b.name);
  });

  const grid = document.getElementById('suppliersGrid');
  if (list.length === 0) {
    grid.innerHTML = `<div class="card text-muted" style="grid-column: 1 / -1; text-align: center;">No matching suppliers found.</div>`;
    return;
  }

  grid.innerHTML = list
    .map((s) => {
      const suppliedCount = State.inventory.filter((i) => i.supplierId === s.id).length;
      return `
        <div class="card entity-card">
          <div>
            <div class="flex justify-between items-start gap-2" style="margin-bottom: 0.65rem;">
              <h3 class="font-bold" style="font-size: 1.05rem;">${escapeHtml(s.name)}</h3>
              <span class="pill pill-info">${s.leadDays}d lead</span>
            </div>
            <div class="flex flex-col gap-1 text-sm text-secondary" style="margin-bottom: 0.85rem;">
              <span>Contact: ${escapeHtml(s.contact)}</span>
              <span>Phone: ${escapeHtml(s.phone)}</span>
              <span>Email: ${escapeHtml(s.email)}</span>
            </div>
            <div class="flex" style="flex-wrap: wrap; gap: 0.35rem;">
              ${s.tags.map((t) => `<span class="pill pill-accent">${escapeHtml(t)}</span>`).join('')}
            </div>
          </div>
          <div class="flex justify-between items-center" style="padding-top: 0.85rem; border-top: 1px solid var(--border-color);">
            <span class="text-xs text-muted">${suppliedCount} book title${suppliedCount === 1 ? '' : 's'}</span>
            <button class="btn btn-secondary btn-sm" onclick="openSupplierFormModal('${s.id}')" title="Edit Supplier" style="padding: 0.38rem 0.7rem; font-weight: 800;">⋮</button>
          </div>
        </div>
      `;
    })
    .join('');
}

window.openSupplierFormModal = function (supId) {
  const existing = supId ? State.suppliers.find((s) => s.id === supId) : null;
  const selectedTags = existing ? existing.tags : [];

  const normalizePhoneDigits = (value) => {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('63')) digits = digits.slice(2);
    if (digits.startsWith('0')) digits = digits.slice(1);
    return digits.slice(0, 10);
  };
  const formatPhilippinePhone = (value) => {
    const digits = normalizePhoneDigits(value);
    const groups = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 10)].filter(Boolean);
    return `+63 ${groups.join(' ')}`;
  };

  openModal(`
    <h3 class="font-bold" style="font-size: 1.18rem; margin-bottom: 1rem;">${existing ? 'Edit Supplier' : 'Add New Supplier'}</h3>
    <form id="supplierModalForm">
      <div class="input-group">
        <label>Company / Distributor Name</label>
        <input type="text" id="fSupName" class="form-control" value="${existing ? escapeAttr(existing.name) : ''}" required />
      </div>
      <div class="flex gap-2">
        <div class="input-group w-full">
          <label>Contact Person</label>
          <input type="text" id="fSupContact" class="form-control" value="${existing ? escapeAttr(existing.contact) : ''}" required />
        </div>
      </div>
      <div class="flex gap-2">
        <div class="input-group w-full">
          <label>Phone Number</label>
          <input type="text" id="fSupPhone" class="form-control" inputmode="numeric" value="${escapeAttr(formatPhilippinePhone(existing ? existing.phone : ''))}" required />
        </div>
        <div class="input-group w-full">
          <label>Email</label>
          <input type="email" id="fSupEmail" class="form-control" value="${existing ? escapeAttr(existing.email) : ''}" required />
        </div>
      </div>
      <div class="input-group">
        <label>Lead Time (Days)</label>
        <input type="number" id="fSupLead" class="form-control" min="1" value="${existing ? existing.leadDays || 1 : 1}" required />
      </div>
      <div class="input-group">
        <label>Supplied Categories</label>
        <div class="flex" style="flex-wrap: wrap; gap: 0.45rem; padding: 0.65rem; background: var(--bg-input); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
          ${State.tags
            .map(
              (t) => `
              <label class="pill" style="cursor: pointer;">
                <input type="checkbox" name="fSupTags" value="${escapeAttr(t)}" ${selectedTags.includes(t) ? 'checked' : ''} />
                <span>${escapeHtml(t)}</span>
              </label>
            `
            )
            .join('')}
        </div>
      </div>
      <div class="flex justify-between gap-2" style="margin-top: 1.15rem;">
        ${existing ? `<button type="button" id="deleteSupplierBtn" class="btn btn-danger btn-sm">Delete</button>` : '<div></div>'}
        <div class="flex gap-2">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Supplier</button>
        </div>
      </div>
    </form>
  `);

  const phoneInput = document.getElementById('fSupPhone');
  phoneInput.addEventListener('input', () => {
    const cursorPosition = phoneInput.selectionStart;
    const digitsBeforeCursor = normalizePhoneDigits(phoneInput.value.slice(0, cursorPosition)).length;
    const formattedPhone = formatPhilippinePhone(phoneInput.value);
    if (phoneInput.value !== formattedPhone) {
      phoneInput.value = formattedPhone;
      const formattedCursor =
        4 +
        digitsBeforeCursor +
        (digitsBeforeCursor > 3 ? 1 : 0) +
        (digitsBeforeCursor > 6 ? 1 : 0);
      phoneInput.setSelectionRange(formattedCursor, formattedCursor);
    }
  });

  document.getElementById('supplierModalForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const checkedTags = Array.from(document.querySelectorAll('input[name="fSupTags"]:checked')).map((el) => el.value);
      await ApiService.saveSupplier(
        {
          id: existing ? existing.id : null,
          name: document.getElementById('fSupName').value.trim(),
          contact: document.getElementById('fSupContact').value.trim(),
          leadDays: Number(document.getElementById('fSupLead').value),
          phone: document.getElementById('fSupPhone').value.trim(),
          email: document.getElementById('fSupEmail').value.trim(),
          tags: checkedTags
        },
        actorString()
      );
      closeModal();
      await refreshAllData();
      showToast(existing ? 'Supplier updated' : 'Supplier added');
    } catch (err) {
      showToast(err.message);
    }
  });

  const deleteSupplierBtn = document.getElementById('deleteSupplierBtn');
  if (deleteSupplierBtn && existing) {
    deleteSupplierBtn.addEventListener('click', () => {
      const linkedBooks = State.inventory.filter((item) => item.supplierId === existing.id).length;
      const detailText = linkedBooks
        ? `${linkedBooks} linked book(s) will remain in inventory but become unassigned.`
        : 'This action cannot be undone.';

      openModal(`
        <h3 class="font-bold" style="font-size: 1.15rem; margin-bottom: 0.5rem;">Delete Supplier</h3>
        <p class="text-sm text-secondary" style="margin-bottom: 1.15rem;">
          Are you sure you want to delete <strong>"${escapeHtml(existing.name)}"</strong>? ${detailText}
        </p>
        <div class="flex justify-end gap-2">
          <button type="button" class="btn btn-secondary" onclick="openSupplierFormModal('${existing.id}')">Back</button>
          <button type="button" id="confirmDeleteSupplierBtn" class="btn btn-danger">Confirm Delete</button>
        </div>
      `);

      document.getElementById('confirmDeleteSupplierBtn').addEventListener('click', async () => {
        try {
          const result = await ApiService.deleteSupplier(existing.id, actorString());
          closeModal();
          await refreshAllData();
          const unassigned = Number(result?.unassignedItems || 0);
          showToast(
            unassigned ? `Supplier deleted. ${unassigned} book(s) are now unassigned.` : 'Supplier deleted'
          );
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  }
};

// ============================================================================
// MODULE 6: USER MANAGEMENT (OWNER ONLY)
// ============================================================================
function renderUsers() {
  const grid = document.getElementById('usersGrid');
  grid.innerHTML = State.users
    .map((u) => {
      const isSelf = u.id === State.currentUser.id;
      return `
        <div class="card entity-card">
          <div>
            <div class="flex justify-between items-start gap-2" style="margin-bottom: 0.5rem;">
              <div>
                <h3 class="font-bold" style="font-size: 1.05rem;">${escapeHtml(u.name)} ${isSelf ? '(You)' : ''}</h3>
                <div class="text-xs text-secondary">${escapeHtml(u.email)}</div>
              </div>
              <span class="pill ${u.active ? 'pill-success' : 'pill-danger'}">${u.active ? 'Active' : 'Deactivated'}</span>
            </div>
            <div style="margin-top: 0.65rem;">
              <span class="pill pill-accent">${u.role}</span>
            </div>
          </div>
          <div class="flex flex-wrap gap-1" style="padding-top: 0.85rem; border-top: 1px solid var(--border-color);">
            <button class="btn btn-secondary btn-sm" onclick="openUserFormModal('${u.id}')" title="Edit User" style="padding: 0.38rem 0.65rem; font-weight: 800;">⋮</button>
            <button class="btn btn-secondary btn-sm" onclick="openAdminResetPassModal('${u.id}')">Reset Pass</button>
            ${
              !isSelf && u.role !== 'Owner'
                ? `<button class="btn ${u.active ? 'btn-danger' : 'btn-outline'} btn-sm" onclick="toggleUserStatus('${u.id}')">
                    ${u.active ? 'Deactivate' : 'Activate'}
                  </button>`
                : ''
            }
          </div>
        </div>
      `;
    })
    .join('');
}

window.openUserFormModal = function (userId) {
  const existing = userId ? State.users.find((u) => u.id === userId) : null;
  const activeOtherUsers = State.users.filter((u) => u.active && (!existing || u.id !== existing.id));

  openModal(`
    <h3 class="font-bold" style="font-size: 1.18rem; margin-bottom: 1rem;">${existing ? 'Edit User Account' : 'Create New Staff User'}</h3>
    <form id="userModalForm">
      <div class="input-group">
        <label>Full Name</label>
        <input type="text" id="fUserName" class="form-control" value="${existing ? escapeAttr(existing.name) : ''}" required />
      </div>
      <div class="input-group">
        <label>Email Address</label>
        <input type="email" id="fUserEmail" class="form-control" value="${existing ? escapeAttr(existing.email) : ''}" required />
      </div>
      <div class="input-group">
        <label>Role</label>
        <select id="fUserRole" class="form-control" ${!existing ? 'disabled' : ''}>
          <option value="Staff" ${!existing || existing.role === 'Staff' ? 'selected' : ''}>Staff (Dashboard, Inventory Management, Supplier Management)</option>
          ${
            existing
              ? `<option value="Owner" ${existing.role === 'Owner' ? 'selected' : ''}>Owner (Full Access + Profit, Users, Logs)</option>`
              : ''
          }
        </select>
        ${
          !existing
            ? `<small class="text-muted">Only one Owner account is allowed. Ownership can be transferred when editing an existing account.</small>`
            : ''
        }
      </div>

      <div id="successorFieldGroup" class="input-group hidden">
        <label for="fSuccessorSelect">Transfer Owner Role To</label>
        <select id="fSuccessorSelect" class="form-control">
          <option value="">Select an active user...</option>
          ${activeOtherUsers
            .map((u) => `<option value="${u.id}">${escapeHtml(u.name)} (${escapeHtml(u.email)})</option>`)
            .join('')}
        </select>
      </div>

      <div id="ownerConfirmPassGroup" class="input-group hidden">
        <label for="fOwnerConfirmPass">Confirm Your Owner Password</label>
        <div class="password-field-wrap">
          <input type="password" id="fOwnerConfirmPass" class="form-control" placeholder="Enter your current password to confirm role transfer" />
          <button type="button" class="password-toggle-btn" data-toggle-pass="fOwnerConfirmPass" aria-pressed="false">Show</button>
        </div>
      </div>

      ${
        !existing
          ? `<div class="input-group">
              <label>Initial Password</label>
              <div class="password-field-wrap">
                <input type="password" id="fUserPass" class="form-control" value="" minlength="6" required />
                <button type="button" class="password-toggle-btn" data-toggle-pass="fUserPass" aria-pressed="false">Show</button>
              </div>
            </div>`
          : ''
      }
      <div class="flex justify-end gap-2" style="margin-top: 1.15rem;">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save Account</button>
      </div>
    </form>
  `);

  const roleSelect = document.getElementById('fUserRole');
  const successorGroup = document.getElementById('successorFieldGroup');
  const ownerPassGroup = document.getElementById('ownerConfirmPassGroup');
  const ownerPassInput = document.getElementById('fOwnerConfirmPass');
  const successorSelect = document.getElementById('fSuccessorSelect');

  const syncRoleTransferFields = () => {
    if (!existing) return;
    const nextRole = roleSelect.value;
    const isDemotingOwner = existing.role === 'Owner' && nextRole !== 'Owner';
    const isPromotingToOwner = existing.role !== 'Owner' && nextRole === 'Owner';
    const requiresOwnerAuth = isDemotingOwner || isPromotingToOwner;

    successorGroup.classList.toggle('hidden', !isDemotingOwner);
    ownerPassGroup.classList.toggle('hidden', !requiresOwnerAuth);
    ownerPassInput.required = requiresOwnerAuth;
    successorSelect.required = isDemotingOwner;
  };

  if (existing) {
    roleSelect.addEventListener('change', syncRoleTransferFields);
    syncRoleTransferFields();
  }

  document.getElementById('userModalForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const nextRole = existing ? roleSelect.value : 'Staff';
      const updatedUsers = await ApiService.manageUsers(
        'SAVE',
        {
          id: existing ? existing.id : null,
          name: document.getElementById('fUserName').value.trim(),
          email: document.getElementById('fUserEmail').value.trim(),
          role: nextRole,
          password: existing ? undefined : document.getElementById('fUserPass').value,
          successorId: successorSelect ? successorSelect.value : undefined,
          ownerPassword: ownerPassInput ? ownerPassInput.value : undefined
        },
        actorString()
      );

      const me = updatedUsers.find((u) => u.id === State.currentUser.id);
      if (me) {
        State.currentUser = me;
        ApiService.setSession(me);
        applyRolePermissions(me);
      }

      closeModal();
      if (State.currentUser.role !== 'Owner') {
        await refreshAllData();
        switchTab('dashboard');
        showToast('Owner role transferred. You are now signed in as Staff.');
      } else {
        await refreshAllData();
        showToast(existing ? 'User updated' : 'User created');
      }
    } catch (err) {
      showToast(err.message);
    }
  });
};

window.toggleUserStatus = function (userId) {
  const target = State.users.find((u) => u.id === userId);
  if (!target) return;
  const nextVerb = target.active ? 'Deactivate' : 'Activate';

  openModal(`
    <h3 class="font-bold" style="font-size: 1.15rem; margin-bottom: 0.5rem;">${nextVerb} Account</h3>
    <p class="text-xs text-secondary" style="margin-bottom: 1rem;">
      Enter your Owner password to ${nextVerb.toLowerCase()} <strong>${escapeHtml(target.name)}</strong> (${escapeHtml(target.email)}).
    </p>
    <form id="toggleUserStatusForm">
      <div class="input-group">
        <label for="statusOwnerPassField">Owner Password</label>
        <div class="password-field-wrap">
          <input type="password" id="statusOwnerPassField" class="form-control" required />
          <button type="button" class="password-toggle-btn" data-toggle-pass="statusOwnerPassField" aria-pressed="false">Show</button>
        </div>
      </div>
      <div class="flex justify-end gap-2" style="margin-top: 1rem;">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn ${target.active ? 'btn-danger' : 'btn-primary'}">${nextVerb}</button>
      </div>
    </form>
  `);

  document.getElementById('toggleUserStatusForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await ApiService.manageUsers(
        'TOGGLE_ACTIVE',
        { id: userId, ownerPassword: document.getElementById('statusOwnerPassField').value },
        actorString()
      );
      closeModal();
      await refreshAllData();
      showToast('Account status updated');
    } catch (err) {
      showToast(err.message);
    }
  });
};

window.openAdminResetPassModal = function (userId) {
  const target = State.users.find((u) => u.id === userId);
  if (!target) return;

  openModal(`
    <h3 class="font-bold" style="font-size: 1.15rem; margin-bottom: 0.5rem;">Reset Password</h3>
    <p class="text-xs text-secondary" style="margin-bottom: 1rem;">Set a new password for <strong>${escapeHtml(target.name)}</strong> (${escapeHtml(target.email)}).</p>
    <form id="adminResetForm">
      <div class="input-group">
        <label for="adminNewPassField">New User Password</label>
        <div class="password-field-wrap">
          <input type="password" id="adminNewPassField" class="form-control" minlength="6" required />
          <button type="button" class="password-toggle-btn" data-toggle-pass="adminNewPassField" aria-pressed="false">Show</button>
        </div>
      </div>
      <div class="input-group">
        <label for="adminOwnerConfirmField">Your Owner Password</label>
        <div class="password-field-wrap">
          <input type="password" id="adminOwnerConfirmField" class="form-control" required />
          <button type="button" class="password-toggle-btn" data-toggle-pass="adminOwnerConfirmField" aria-pressed="false">Show</button>
        </div>
      </div>
      <div class="flex justify-end gap-2" style="margin-top: 1rem;">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Reset Password</button>
      </div>
    </form>
  `);

  document.getElementById('adminResetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await ApiService.manageUsers(
        'RESET_PASS',
        {
          id: userId,
          newPassword: document.getElementById('adminNewPassField').value,
          ownerPassword: document.getElementById('adminOwnerConfirmField').value
        },
        actorString()
      );
      closeModal();
      await refreshAllData();
      showToast('User password reset');
    } catch (err) {
      showToast(err.message);
    }
  });
};

// ============================================================================
// MODULE 7: AUDIT LOGS (OWNER ONLY)
// ============================================================================
function formatLogDetailsHtml(details) {
  const lines = String(details ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return escapeHtml(lines[0] || '');
  }

  return `
    <details class="log-details-collapsible">
      <summary>${lines.length} field changes</summary>
      <ul class="log-diff-list">
        ${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}
      </ul>
    </details>
  `;
}

function renderLogs() {
  const tbody = document.getElementById('auditLogsTableBody');
  const mobileCardsEl = document.getElementById('auditLogsMobileCards');
  const q = State.logSearch.trim().toLowerCase();
  const filtered = State.logs.filter(
    (l) =>
      !q ||
      l.user.toLowerCase().includes(q) ||
      l.action.toLowerCase().includes(q) ||
      l.target.toLowerCase().includes(q) ||
      l.details.toLowerCase().includes(q)
  );

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem;" class="text-muted">No audit log entries match your filter.</td></tr>`;
    if (mobileCardsEl) {
      mobileCardsEl.innerHTML = `<div class="card text-muted" style="text-align: center;">No audit log entries match your filter.</div>`;
    }
    return;
  }

  tbody.innerHTML = filtered
    .map((log) => {
      const dt = new Date(log.timestamp);
      const formattedDate = dt.toLocaleString('en-PH', {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      return `
        <tr>
          <td class="text-xs text-secondary" style="white-space: nowrap;">${formattedDate}</td>
          <td class="font-semibold text-xs">${escapeHtml(log.user)}</td>
          <td><span class="pill pill-accent">${escapeHtml(log.action)}</span></td>
          <td class="font-medium text-xs">${escapeHtml(log.target)}</td>
          <td class="text-xs text-secondary">${formatLogDetailsHtml(log.details)}</td>
        </tr>
      `;
    })
    .join('');

  if (mobileCardsEl) {
    mobileCardsEl.innerHTML = filtered
      .map((log) => {
        const dt = new Date(log.timestamp);
        const formattedDate = dt.toLocaleString('en-PH', {
          month: 'short',
          day: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        return `
          <details class="card mobile-log-card">
            <summary class="mobile-log-summary flex justify-between items-start gap-2">
              <div style="min-width: 0;">
                <div class="flex items-center gap-1" style="flex-wrap: wrap; margin-bottom: 0.25rem;">
                  <span class="pill pill-accent">${escapeHtml(log.action)}</span>
                  <span class="font-bold text-xs">${escapeHtml(log.target)}</span>
                </div>
                <div class="text-xs text-secondary">${escapeHtml(log.user)}</div>
              </div>
              <span class="text-xs text-muted" style="white-space: nowrap;">${formattedDate}</span>
            </summary>
            <div class="mobile-log-body text-xs text-secondary">
              ${formatLogDetailsHtml(log.details)}
            </div>
          </details>
        `;
      })
      .join('');
  }
}

// ============================================================================
// MODAL & SANITIZATION HELPERS
// ============================================================================
function openModal(html, onCancelCallback = null) {
  State.modalCloseGuard = onCancelCallback;
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalBackdrop').classList.remove('hidden');
}

window.attemptCloseModal = function () {
  const guard = State.modalCloseGuard;
  closeModal();
  if (typeof guard === 'function') {
    guard();
  }
};

window.closeModal = function () {
  State.modalCloseGuard = null;
  document.getElementById('modalBackdrop').classList.add('hidden');
};

function closeConfirmationPrompt(promptClass, onClosed) {
  const backdrop = document.getElementById('modalBackdrop');
  if (!backdrop.classList.contains(promptClass) || backdrop.classList.contains('is-closing')) return;

  backdrop.classList.remove('is-visible');
  backdrop.classList.add('is-closing');
  window.setTimeout(() => {
    backdrop.classList.remove(promptClass, 'is-closing');
    window.closeModal();
    if (typeof onClosed === 'function') onClosed();
  }, 280);
}

function showConfirmationPrompt(backdrop, promptClass) {
  backdrop.classList.add(promptClass);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => backdrop.classList.add('is-visible'));
  });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, '&#39;');
}