/**
 * Bookstoriaga PHP/MySQL API adapter.
 * The UI controller below continues to call the same ApiService methods.
 */
const ApiService = (() => {
  const API = 'api.php';
  async function request(action, data = {}) {
    const response = await fetch(API, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      credentials: 'same-origin',
      body: JSON.stringify({action, ...data})
    });
    let result;
    try { result = await response.json(); }
    catch (_) { throw new Error('The server returned an invalid response.'); }
    if (!response.ok || result.success === false) throw new Error(result.message || 'Request failed.');
    return result.data;
  }
  let currentSession = null;
  return {
    init() {},
    async login(email,password) {
      const user = await request('login',{email,password});
      currentSession = user;
      localStorage.setItem('bs_session_v1',JSON.stringify(user));
      return user;
    },
    async verifyEmailForReset(email) { return request('verify_reset_email',{email}); },
    async resetPassword(email,newPassword) { return request('reset_password',{email,newPassword}); },
    async changePassword(userId,currentPassword,newPassword) {
      return request('change_password',{userId,currentPassword,newPassword});
    },
    async updateProfile(userId,newName) {
      const user = await request('update_profile',{userId,newName});
      currentSession = user;
      localStorage.setItem('bs_session_v1',JSON.stringify(user));
      return user;
    },
    getSession() {
      if (currentSession) return currentSession;
      try { return JSON.parse(localStorage.getItem('bs_session_v1') || 'null'); }
      catch (_) { return null; }
    },
    logout() {
      currentSession = null;
      localStorage.removeItem('bs_session_v1');
      request('logout').catch(()=>{});
    },
    async getInventory() { return request('get_inventory'); },
    async saveInventoryItem(itemData,actor) {
      return request('save_inventory_item',{itemData,actor});
    },
    async deleteInventoryItem(itemId,actor) {
      return request('delete_inventory_item',{itemId,actor});
    },
    async manageTags(action,payload,actor) {
      return request('manage_tags',{tagAction:action,payload,actor});
    },
    async saveSupplier(supData,actor) {
      return request('save_supplier',{supData,actor});
    },
    async deleteSupplier(supplierId,actor) {
      return request('delete_supplier',{supplierId,actor});
    },
    async submitTransaction(payload,actor) {
      return request('submit_transaction',{payload,actor});
    },
    async manageUsers(action,payload,actor) {
      return request('manage_users',{userAction:action,payload,actor});
    },
    async getLogs() { return request('get_logs'); },
    getTheme() { return localStorage.getItem('bs_theme_v1') || 'light'; },
    setTheme(theme) { localStorage.setItem('bs_theme_v1',theme); }
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
  users: [],
  logs: [],
  // Filters & Sorting
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
  document.getElementById('sidebarThemeIcon').src =
    theme === 'dark' ? 'assets/icons/Dark%20Mode.png' : 'assets/icons/Light%20Mode.png';
}

// ============================================================================
// BOOTSTRAP & AUTH FLOW
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  ApiService.init();
  applyTheme(ApiService.getTheme());

  const existingSession = ApiService.getSession();
  if (existingSession) {
    await enterWorkspace(existingSession);
  }

  bindGlobalEvents();
});

function bindGlobalEvents() {
  // Auth View Toggles
  document.getElementById('goToForgotBtn').addEventListener('click', () => switchAuthForm('forgot'));
  document.getElementById('toggleLoginPasswordBtn').addEventListener('click', () => {
    document.getElementById('loginPassword').type =
      document.getElementById('loginPassword').type === 'password' ? 'text' : 'password';
    document.getElementById('toggleLoginPasswordBtn').textContent =
      document.getElementById('loginPassword').type === 'password' ? 'View password' : 'Hide password';
    document.getElementById('toggleLoginPasswordBtn').setAttribute(
      'aria-pressed',
      document.getElementById('loginPassword').type === 'text'
    );
  });
  document.querySelectorAll('.backToLoginBtn').forEach((btn) =>
    btn.addEventListener('click', () => switchAuthForm('login'))
  );

  // Standard Login Submit
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const email = document.getElementById('loginEmail').value;
      const pass = document.getElementById('loginPassword').value;
      const user = await ApiService.login(email, pass);
      await enterWorkspace(user);
    } catch (err) {
      showToast(err.message);
    }
  });

  // Forgot Password Submit
  document.getElementById('forgotForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const email = document.getElementById('forgotEmail').value;
      const verifiedEmail = await ApiService.verifyEmailForReset(email);
      document.getElementById('resetTargetEmail').textContent = verifiedEmail;
      switchAuthForm('reset');
      showToast('Email verified. Choose a new password.');
    } catch (err) {
      showToast(err.message);
    }
  });

  // Reset Password Submit
  document.getElementById('resetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('resetTargetEmail').textContent;
    const p1 = document.getElementById('newResetPass').value;
    const p2 = document.getElementById('confirmResetPass').value;
    if (p1 !== p2) return showToast('Passwords do not match.');
    try {
      await ApiService.resetPassword(email, p1);
      const user = await ApiService.login(email, p1);
      showToast('Password updated!');
      await enterWorkspace(user);
    } catch (err) {
      showToast(err.message);
    }
  });

  // Collapsible Left Sidebar Toggle (At bottom of navigation bar)
  document.getElementById('sidebarToggleBtn').addEventListener('click', () => {
    State.sidebarCollapsed = !State.sidebarCollapsed;
    document.getElementById('leftSidebar').classList.toggle('collapsed', State.sidebarCollapsed);
  });

  // Book Mode Toggle (Switches Inventory Management to Cover Image Grid & jumps to Inventory)
  document.getElementById('sidebarBookModeBtn').addEventListener('click', () => {
    State.bookMode = !State.bookMode;
    document.getElementById('sidebarBookModeSwitch').classList.toggle('active', State.bookMode);
    if (State.activeTab !== 'inventory') {
      switchTab('inventory');
    }
    // Ensure Books sub-tab is visible
    document.querySelectorAll('[data-inv-sub]').forEach((b) => b.classList.toggle('active', b.dataset.invSub === 'catalog'));
    document.getElementById('invSubCatalog').classList.remove('hidden');
    document.getElementById('invSubTags').classList.add('hidden');
    renderInventoryTable();
    showToast(State.bookMode ? 'Book Mode enabled (Cover Grid)' : 'Book Mode disabled (Table View)');
  });

  // Sidebar Dark Mode Simple Toggle
  document.getElementById('sidebarThemeToggleBtn').addEventListener('click', () => {
    const next = ApiService.getTheme() === 'light' ? 'dark' : 'light';
    applyTheme(next);
    showToast(next === 'dark' ? 'Dark Roast Espresso enabled' : 'Oat Latte Light enabled');
  });

  // Sidebar Log Out Button
  document.getElementById('sidebarLogoutBtn').addEventListener('click', () => {
    ApiService.logout();
    State.currentUser = null;
    State.sellCart = [];
    State.restockCart = [];
    document.getElementById('appShell').classList.add('hidden');
    document.getElementById('authView').classList.remove('hidden');
    switchAuthForm('login');
    showToast('Signed out');
  });

  // Main Navigation Tabs
  document.querySelectorAll('#mainNavTabs .nav-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Notification Bell Dropdown Toggle
  const bellBtn = document.getElementById('notifBellBtn');
  const notifDrop = document.getElementById('notifDropdown');
  bellBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    notifDrop.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!notifDrop.contains(e.target) && e.target !== bellBtn) {
      notifDrop.classList.add('hidden');
    }
    if (!e.target.closest('.tag-filter-control')) {
      document.querySelectorAll('.tag-filter-menu').forEach((menu) => menu.classList.add('hidden'));
      document.querySelectorAll('.filter-menu-toggle').forEach((btn) => btn.setAttribute('aria-expanded', 'false'));
    }
    // Close modal multi-select dropdown when clicking outside
    if (!e.target.closest('.multiselect-wrap') && State.modalMultiSelectOpen) {
      State.modalMultiSelectOpen = false;
      const menu = document.getElementById('modalTagsMenu');
      if (menu) menu.classList.add('hidden');
    }
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
    });
  });

  // Inventory Search & Sort
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
  document.getElementById('clearCartBtn').addEventListener('click', () => {
    if (State.cartMode === 'SELL') {
      State.sellCart = [];
    } else {
      State.restockCart = [];
    }
    renderCart();
  });
  document.getElementById('cartContinueBtn').addEventListener('click', openTransactionConfirmModal);

  // Add Book & Supplier Modals
  document.getElementById('openAddItemModalBtn').addEventListener('click', () => openItemFormModal(null));
  document.getElementById('openAddSupplierModalBtn').addEventListener('click', () => openSupplierFormModal(null));
  document.getElementById('openAddUserModalBtn').addEventListener('click', () => openUserFormModal(null));

  // Supplier Search & Sort
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
  document.getElementById('profileSettingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const newName = document.getElementById('profileNameInput').value;
      const updatedUser = await ApiService.updateProfile(State.currentUser.id, newName);
      State.currentUser = updatedUser;
      document.getElementById('headerUserGreeting').textContent = `Hi, ${updatedUser.name}`;
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

  document.getElementById('resetDemoDataBtn').addEventListener('click', async () => {
    ApiService.init(true);
    State.sellCart = [];
    State.restockCart = [];
    await refreshAllData();
    showToast('Demo database restored to defaults');
  });

  // Close Modal on Backdrop Click
  document.getElementById('modalBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modalBackdrop') attemptCloseModal();
  });
}

function switchAuthForm(mode) {
  document.getElementById('loginForm').classList.toggle('hidden', mode !== 'login');
  document.getElementById('forgotForm').classList.toggle('hidden', mode !== 'forgot');
  document.getElementById('resetForm').classList.toggle('hidden', mode !== 'reset');
  const subtitles = {
    login: 'Library, Manga & Collectibles Inventory',
    forgot: 'Account Password Recovery',
    reset: 'Set a New Workspace Password'
  };
  document.getElementById('authSubtitle').textContent = subtitles[mode];
}

const actorString = () => `${State.currentUser.name} (${State.currentUser.role})`;

async function enterWorkspace(user) {
  State.currentUser = user;
  document.getElementById('authView').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');

  document.getElementById('headerUserGreeting').textContent = `Hi, ${user.name}`;
  document.getElementById('headerRoleBadge').textContent = user.role;
  document.getElementById('profileNameInput').value = user.name;
  document.getElementById('profileEmailDisplay').value = user.email;

  // Enforce Role-Based Access Control (Owner Only elements)
  const isOwner = user.role === 'Owner';
  document.querySelectorAll('.owner-only').forEach((el) => {
    el.classList.toggle('hidden', !isOwner);
  });

  await refreshAllData();
  switchTab('dashboard');
}

function switchTab(tabName) {
  State.activeTab = tabName;
  document.querySelectorAll('#mainNavTabs .nav-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-section').forEach((sec) => {
    sec.classList.toggle('hidden', sec.id !== `tab-${tabName}`);
  });
}

async function refreshAllData() {
  const data = await ApiService.getInventory();
  State.inventory = data.items;
  State.tags = data.tags;
  State.invTagFilter = State.invTagFilter.filter((tag) => State.tags.includes(tag));
  State.supTagFilter = State.supTagFilter.filter((tag) => State.tags.includes(tag));
  State.suppliers = data.suppliers;
  State.transactions = data.transactions;

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
// MODULE 2: HEADER LOW-STOCK NOTIFICATIONS (JUMP & HIGHLIGHT IN INVENTORY)
// ============================================================================
function renderNotifications() {
  const lowItems = State.inventory.filter((item) => item.stock <= item.lowThreshold);
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
  document.getElementById('notifDropdown').classList.add('hidden');
  // Reset filters so item is guaranteed visible
  State.invSearch = '';
  State.invTagFilter = [];
  document.getElementById('invSearchInput').value = '';

  // Jump to the page containing the target item
  const sortedAll = [...State.inventory].sort((a, b) => a.title.localeCompare(b.title));
  State.invSort = 'title-asc';
  document.getElementById('invSortSelect').value = 'title-asc';
  const targetIdx = sortedAll.findIndex((i) => i.id === itemId);
  State.invPage = targetIdx !== -1 ? Math.floor(targetIdx / State.invPageSize) + 1 : 1;

  // Ensure Books sub-tab is active
  document.querySelectorAll('[data-inv-sub]').forEach((b) => b.classList.toggle('active', b.dataset.invSub === 'catalog'));
  document.getElementById('invSubCatalog').classList.remove('hidden');
  document.getElementById('invSubTags').classList.add('hidden');

  switchTab('inventory');
  renderInventoryModule();

  requestAnimationFrame(() => {
    const row = document.getElementById(`inv-row-${itemId}`);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.remove('row-highlighted');
      void row.offsetWidth;
      row.classList.add('row-highlighted');
    }
  });
};

// ============================================================================
// MODULE 3: DASHBOARD RENDERING
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

  // Pure HTML/CSS Stock Bar Chart
  const chartEl = document.getElementById('stockBarChart');
  const maxCap = Math.max(50, ...State.inventory.map((i) => i.stock));
  chartEl.innerHTML = State.inventory
    .map((item) => {
      const pct = Math.min(100, Math.round((item.stock / maxCap) * 100));
      const isLow = item.stock <= item.lowThreshold;
      return `
        <div class="bar-row">
          <div class="flex justify-between text-xs font-semibold">
            <span>${escapeHtml(item.title)}</span>
            <span class="${isLow ? 'pill pill-warning' : 'text-secondary'}">${item.stock} units</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill ${isLow ? 'low' : ''}" style="width: ${pct}%;"></div>
          </div>
        </div>
      `;
    })
    .join('');

  // Bestsellers filtered by Day / Week / Month / Year
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
        <div class="flex items-center justify-between" style="padding: 0.7rem 0.9rem; background: var(--bg-surface-alt); border-radius: var(--radius-md);">
          <div class="flex items-center gap-2">
            <span class="pill pill-accent font-bold">#${index + 1}</span>
            <div>
              <div class="font-semibold text-sm">${escapeHtml(entry.item.title)}</div>
              <div class="text-xs text-secondary">${formatPHP(entry.item.sellPrice)} each</div>
            </div>
          </div>
          <span class="pill pill-success">${entry.soldQty} sold</span>
        </div>
      `
      )
      .join('');
  }
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

function renderInventoryTable() {
  const tbody = document.getElementById('inventoryTableBody');
  const tableContainer = document.getElementById('inventoryTableContainer');
  const coverGrid = document.getElementById('inventoryBookModeGrid');
  const paginationBar = document.getElementById('inventoryPaginationBar');
  const pageIndicator = document.getElementById('invPageIndicator');
  const prevBtn = document.getElementById('invPrevPageBtn');
  const nextBtn = document.getElementById('invNextPageBtn');
  const q = State.invSearch.trim().toLowerCase();

  // Toggle between Table View and Book Mode Cover Grid
  tableContainer.classList.toggle('hidden', State.bookMode);
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

  // Sorting
  filtered.sort((a, b) => {
    switch (State.invSort) {
      case 'title-desc': return b.title.localeCompare(a.title);
      case 'stock-asc': return a.stock - b.stock;
      case 'stock-desc': return b.stock - a.stock;
      case 'price-asc': return a.sellPrice - b.sellPrice;
      case 'price-desc': return b.sellPrice - a.sellPrice;
      default: return a.title.localeCompare(b.title);
    }
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem;" class="text-muted">No matching books found.</td></tr>`;
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

  // Render Book Mode Cover Grid (with Sell & Restock buttons underneath each card)
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

  // Render Standard Table View
  tbody.innerHTML = paginatedItems
    .map((item) => {
      const isLow = item.stock <= item.lowThreshold;
      const fallbackUrl = `https://placehold.co/300x450/7B4B2A/FFFDF9?text=${encodeURIComponent(item.title)}`;
      const imgSrc = item.coverUrl || fallbackUrl;
      return `
        <div class="book-cover-card" onclick="openItemFormModal('${item.id}')" title="Click to edit ${escapeAttr(item.title)}">
          <img src="${escapeAttr(imgSrc)}" alt="${escapeAttr(item.title)}" onerror="this.onerror=null;this.src='${fallbackUrl}';" />
          <span class="book-cover-stock-pill ${isLow ? 'low' : ''}">${item.stock} in stock</span>
          <div class="book-cover-overlay">
            <div class="book-cover-title">${escapeHtml(item.title)}</div>
            <div class="book-cover-sub">${escapeHtml(item.author || item.sku)} • ${formatPHP(item.sellPrice)}</div>
          </div>
        </div>
      `;
    })
    .join('');

  // Render Standard Table View
  tbody.innerHTML = filtered
    .map((item) => {
      const isLow = item.stock <= item.lowThreshold;
      const supplier = State.suppliers.find((s) => s.id === item.supplierId);

      return `
        <tr id="inv-row-${item.id}">
          <td>
            <div class="font-bold">${escapeHtml(item.title)}</div>
            <div class="text-xs text-secondary">${escapeHtml(item.author || 'Unknown Author')} • <span class="text-muted">${escapeHtml(item.sku)}</span></div>
          </td>

          <!-- Read-only Tags Display (Editable via 3-dot modal) -->
          <td>
            <div class="flex" style="flex-wrap: wrap; gap: 0.3rem;">
              ${
                item.tags.length
                  ? item.tags.map((t) => `<span class="pill pill-accent" style="padding: 2px 8px; font-size: 0.7rem;">${escapeHtml(t)}</span>`).join('')
                  : `<span class="text-xs text-muted">No tags</span>`
              }
            </div>
          </td>

          <!-- Unchangeable Supplier Display -->
          <td>
            <span class="text-xs font-medium text-secondary">${escapeHtml(supplier ? supplier.name : 'Unassigned')}</span>
          </td>

          <td>
            <div class="font-semibold">${formatPHP(item.sellPrice)}</div>
            <div class="text-xs text-muted">Cost: ${formatPHP(item.costPrice)}</div>
          </td>

          <!-- Read-only Stock Display -->
          <td>
            <div class="flex items-center gap-1">
              <span class="font-bold">${item.stock}</span>
              ${isLow ? `<span class="pill pill-warning" title="Low stock alert">Low</span>` : ''}
            </div>
          </td>

          <!-- Sell, Restock & 3-dot Edit Book Actions -->
          <td style="text-align: right; white-space: nowrap;">
            <button class="btn btn-primary btn-sm" onclick="addToCartWithMode('${item.id}', 'SELL')">Sell</button>
            <button class="btn btn-outline btn-sm" onclick="addToCartWithMode('${item.id}', 'RESTOCK')">Restock</button>
            <button class="btn btn-secondary btn-sm" onclick="openItemFormModal('${item.id}')" title="Edit Book" style="padding: 0.38rem 0.65rem; font-weight: 800;">⋮</button>
          </td>
        </tr>
      `;
    })
    .join('');
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
    await ApiService.manageTags('DELETE', { name }, actorString());
    closeModal();
    await refreshAllData();
    showToast('Tag deleted');
  });
};

// ============================================================================
// RECEIPT SIDE CART & CONFIRMATION MODAL (SEPARATE SELL & RESTOCK LISTS)
// ============================================================================
function getActiveCart() {
  return State.cartMode === 'SELL' ? State.sellCart : State.restockCart;
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
  const activeCart = getActiveCart();
  const isEmpty = activeCart.length === 0;
  receiptEl.classList.toggle('hidden', isEmpty);
  document.getElementById('invSubCatalog').classList.toggle('receipt-hidden', isEmpty);

  if (isEmpty) {
    listEl.innerHTML = '';
    qtyEl.textContent = '0';
    amtEl.textContent = '₱0.00';
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

// Add / Edit Book Modal (Separated Book Information & Stock Information + Image Preview)
window.openItemFormModal = function (itemId) {
  const existing = itemId ? State.inventory.find((i) => i.id === itemId) : null;
  State.modalSelectedTags = existing ? [...existing.tags] : [];
  State.modalMultiSelectOpen = false;
  const isNew = !existing;
  const defaultCover = existing && existing.coverUrl
    ? existing.coverUrl
    : `https://placehold.co/300x450/7B4B2A/FFFDF9?text=${encodeURIComponent(existing ? existing.title : 'Book Cover')}`;

  openModal(`
    <h3 class="font-bold" style="font-size: 1.18rem; margin-bottom: 1rem;">${existing ? 'Edit Book Details' : 'Add New Book'}</h3>
    <form id="itemModalForm">
      <!-- SECTION 1: BOOK INFORMATION -->
      <div class="modal-section">
        <div class="modal-section-title">Book Information</div>

        <!-- Cover Image Preview & URL -->
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
              <label>Cover Image URL</label>
              <input type="url" id="fItemCoverUrl" class="form-control" value="${existing ? escapeAttr(existing.coverUrl || '') : ''}" placeholder="https://..." />
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
            ${State.suppliers
              .map((s) => `<option value="${s.id}" ${existing && existing.supplierId === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`)
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
  `, () => {
    // Warn via bottom-right toast if exited without pressing Save Book
    showToast('Changes were not saved');
  });

  renderModalTagsMultiSelect();

  const formEl = document.getElementById('itemModalForm');
  const coverInput = document.getElementById('fItemCoverUrl');
  const coverPreview = document.getElementById('fItemCoverPreview');

  // Live cover preview update
  coverInput.addEventListener('input', () => {
    const val = coverInput.value.trim();
    const titleFallback = document.getElementById('fItemTitle').value.trim() || 'Book Cover';
    coverPreview.src = val || `https://placehold.co/300x450/7B4B2A/FFFDF9?text=${encodeURIComponent(titleFallback)}`;
  });

  // Prevent Enter key from submitting or closing the Edit Book pop-up (except inside textarea newlines)
  formEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
    }
  });

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const titleVal = document.getElementById('fItemTitle').value.trim();
    const rawCover = document.getElementById('fItemCoverUrl').value.trim();
    const payload = {
      id: existing ? existing.id : null,
      title: titleVal,
      coverUrl: rawCover || `https://placehold.co/300x450/7B4B2A/FFFDF9?text=${encodeURIComponent(titleVal)}`,
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
    await ApiService.saveInventoryItem(payload, actorString());
    closeModal();
    await refreshAllData();
    showToast(existing ? 'Book updated' : 'New book added');
  });

  if (existing) {
    document.getElementById('deleteItemBtn').addEventListener('click', async () => {
      await ApiService.deleteInventoryItem(existing.id, actorString());
      State.sellCart = State.sellCart.filter((c) => c.itemId !== existing.id);
      State.restockCart = State.restockCart.filter((c) => c.itemId !== existing.id);
      closeModal();
      await refreshAllData();
      showToast('Book removed');
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
          <input type="text" id="fSupPhone" class="form-control" value="${existing ? escapeAttr(existing.phone) : '+63 '}" maxlength="13" required />
        </div>
        <div class="input-group w-full">
          <label>Email</label>
          <input type="email" id="fSupEmail" class="form-control" value="${existing ? escapeAttr(existing.email) : ''}" required />
        </div>
      </div>
      <div class="input-group"> <label>Lead Time (Days)</label> 
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
      <div class="flex justify-end gap-2" style="margin-top: 1.15rem;">
        ${existing ? `<button type="button" id="deleteSupplierBtn" class="btn btn-danger btn-sm">Delete</button>` : ''}
        <div class="flex gap-2">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Supplier</button>
        </div>
      </div>
    </form>
  `);

  document.getElementById('supplierModalForm').addEventListener('submit', async (e) => {
    e.preventDefault();
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
  });

  const deleteSupplierBtn = document.getElementById('deleteSupplierBtn');
  if (deleteSupplierBtn && existing) {
    deleteSupplierBtn.addEventListener('click', async () => {
      const linkedBooks = State.inventory.filter((item) => item.supplierId === existing.id).length;
      const confirmation = linkedBooks
        ? `Delete "${existing.name}"? ${linkedBooks} linked book(s) will remain in inventory but become unassigned.`
        : `Delete "${existing.name}"? This action cannot be undone.`;
      if (!window.confirm(confirmation)) return;

      deleteSupplierBtn.disabled = true;
      try {
        const result = await ApiService.deleteSupplier(existing.id, actorString());
        closeModal();
        await refreshAllData();
        const unassigned = Number(result?.unassignedItems || 0);
        showToast(unassigned
          ? `Supplier deleted. ${unassigned} book(s) are now unassigned.`
          : 'Supplier deleted');
      } catch (err) {
        deleteSupplierBtn.disabled = false;
        showToast(err.message);
      }
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
              !isSelf
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
  openModal(`
    <h3 class="font-bold" style="font-size: 1.18rem; margin-bottom: 1rem;">${existing ? 'Edit User Account' : 'Create New User'}</h3>
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
        <select id="fUserRole" class="form-control">
          <option value="Staff" ${existing && existing.role === 'Staff' ? 'selected' : ''}>Staff (Dashboard, Inventory Management, Supplier Management)</option>
          <option value="Owner" ${existing && existing.role === 'Owner' ? 'selected' : ''}>Owner (Full Access + Profit, Users, Logs)</option>
        </select>
      </div>
      ${
        !existing
          ? `<div class="input-group">
              <label>Initial Password</label>
              <input type="password" id="fUserPass" class="form-control" value="" minlength="6" required />
            </div>`
          : ''
      }
      <div class="flex justify-end gap-2" style="margin-top: 1.15rem;">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save Account</button>
      </div>
    </form>
  `);

  document.getElementById('userModalForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await ApiService.manageUsers(
        'SAVE',
        {
          id: existing ? existing.id : null,
          name: document.getElementById('fUserName').value.trim(),
          email: document.getElementById('fUserEmail').value.trim(),
          role: document.getElementById('fUserRole').value,
          password: existing ? undefined : document.getElementById('fUserPass').value
        },
        actorString()
      );
      closeModal();
      await refreshAllData();
      showToast(existing ? 'User updated' : 'User created');
    } catch (err) {
      showToast(err.message);
    }
  });
};

window.toggleUserStatus = async function (userId) {
  await ApiService.manageUsers('TOGGLE_ACTIVE', { id: userId }, actorString());
  await refreshAllData();
  showToast('Account status updated');
};

window.openAdminResetPassModal = function (userId) {
  const target = State.users.find((u) => u.id === userId);
  if (!target) return;
  openModal(`
    <h3 class="font-bold" style="font-size: 1.15rem; margin-bottom: 0.5rem;">Reset Password</h3>
    <p class="text-xs text-secondary" style="margin-bottom: 1rem;">Set a new password for <strong>${escapeHtml(target.name)}</strong> (${escapeHtml(target.email)}).</p>
    <form id="adminResetForm">
      <div class="input-group">
        <label>New Password</label>
        <input type="password" id="adminNewPassField" class="form-control" minlength="6" required />
      </div>
      <div class="flex justify-end gap-2" style="margin-top: 1rem;">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Reset Password</button>
      </div>
    </form>
  `);
  document.getElementById('adminResetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await ApiService.manageUsers(
      'RESET_PASS',
      { id: userId, newPassword: document.getElementById('adminNewPassField').value },
      actorString()
    );
    closeModal();
    await refreshAllData();
    showToast('User password reset');
  });
};

// ============================================================================
// MODULE 7: AUDIT LOGS (OWNER ONLY)
// ============================================================================
function renderLogs() {
  const tbody = document.getElementById('auditLogsTableBody');
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
          <td class="text-xs text-secondary">${escapeHtml(log.details)}</td>
        </tr>
      `;
    })
    .join('');
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