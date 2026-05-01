let projectsDb = [];
let tasksDb = [];
let costsDb = [];
let currentProjectId = null;
let currentCalendarDate = new Date();
let activeGanttTab = 'projects';
const ganttToolbarState = {
  projects: {
    search: '',
    status: ''
  }
};

document.addEventListener('DOMContentLoaded', () => {
  renderGanttToolbarControls(activeGanttTab);
  loadProjects();
  document.getElementById('f-project-start').valueAsDate = new Date();
  document.getElementById('f-project-end').valueAsDate = new Date(Date.now() + 30*24*60*60*1000);
  document.getElementById('f-task-start').valueAsDate = new Date();
  document.getElementById('f-task-end').valueAsDate = new Date(Date.now() + 7*24*60*60*1000);
  document.getElementById('f-cost-date').valueAsDate = new Date();
});

function doLogout() {
  fetch('/logout', { method: 'POST' }).then(() => { window.location.href = '/'; });
}

function goBackToDashboard() {
  window.location.href = '/admin?view=dashboard';
}

function captureGanttToolbarState(tab) {
  if (tab !== 'projects') return;
  ganttToolbarState.projects.search = document.getElementById('project-search')?.value || ganttToolbarState.projects.search || '';
  ganttToolbarState.projects.status = document.getElementById('project-status')?.value || ganttToolbarState.projects.status || '';
}

function renderGanttToolbarControls(tab) {
  const actions = document.getElementById('gantt-toolbar-actions');
  if (!actions) return;

  const state = ganttToolbarState.projects;

  if (tab === 'projects') {
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="project-search" type="text" placeholder="Search projects..." value="${escHtml(state.search || '')}" oninput="filterProjects()" />
      </div>
      <button class="btn btn-add btn-sm" type="button" onclick="openProjectModal()">New Project</button>
      <select id="project-status" class="filter-select" onchange="filterProjects()">
        <option value="">All Status</option>
        <option value="planning" ${state.status === 'planning' ? 'selected' : ''}>Planning</option>
        <option value="active" ${state.status === 'active' ? 'selected' : ''}>Active</option>
        <option value="completed" ${state.status === 'completed' ? 'selected' : ''}>Completed</option>
      </select>
    `;
    return;
  }

  if (tab === 'gantt') {
    actions.innerHTML = `
      <select id="project-selector" class="filter-select" onchange="loadGanttForProject()" style="flex:1;max-width:300px">
        <option value="">Select a project</option>
      </select>
      <button class="btn btn-add btn-sm" type="button" onclick="openTaskModal()">Add Task</button>
    `;
    updateProjectSelectors();
    if (currentProjectId) {
      const selector = document.getElementById('project-selector');
      if (selector) selector.value = String(currentProjectId);
    }
    return;
  }

  if (tab === 'costs') {
    actions.innerHTML = `
      <select id="cost-project-selector" class="filter-select" onchange="loadCostsForProject()" style="flex:1;max-width:300px">
        <option value="">Select a project</option>
      </select>
      <button class="btn btn-add btn-sm" type="button" onclick="openCostModal()">Record Cost</button>
    `;
    updateProjectSelectors();
    if (currentProjectId) {
      const selector = document.getElementById('cost-project-selector');
      if (selector) selector.value = String(currentProjectId);
    }
    return;
  }

  actions.innerHTML = '';
}

function switchTab(tab, btn) {
  captureGanttToolbarState(activeGanttTab);
  document.querySelectorAll('.module-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(tab).classList.add('active');
  activeGanttTab = tab;
  renderGanttToolbarControls(tab);
  if (tab === 'projects') {
    renderProjects();
  } else if (tab === 'calendar') {
    renderProjectsCalendar();
  } else if (tab === 'gantt' && currentProjectId) {
    loadGanttForProject();
  } else if (tab === 'costs' && currentProjectId) {
    loadCostsForProject();
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PROJECTS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function loadProjects() {
  fetch('/api/projects')
    .then(r => r.json())
    .then(data => {
      projectsDb = data;
      renderProjects();
      renderProjectsCalendar();
      updateProjectSelectors();

      // Auto-select project if ID is in URL
      const params = new URLSearchParams(window.location.search);
      const urlProjectId = params.get('projectId');
      const autoOpen = params.get('autoOpen');
      const newName = params.get('newProjectName');

      if (urlProjectId) {
        selectProject(parseInt(urlProjectId));
      } else if (autoOpen === 'true') {
        // Awtomatikong buksan ang "New Project" modal
        openProjectModal();
        if (newName) {
          // I-pre-fill ang pangalan ng project galing sa transaction client
          document.getElementById('f-project-name').value = decodeURIComponent(newName);
        }
      }
    })
    .catch(e => console.error('Error:', e));
}

function renderProjects() {
  const grid = document.getElementById('projects-grid');
  const searchInput = document.getElementById('project-search');
  const statusInput = document.getElementById('project-status');
  const q = String(searchInput?.value ?? ganttToolbarState.projects.search ?? '').toLowerCase().trim();
  const status = String(statusInput?.value ?? ganttToolbarState.projects.status ?? '').trim();
  const filtered = projectsDb.filter(p =>
    (p.project_name + ' ' + (p.members || '') + ' ' + (p.project_manager || '')).toLowerCase().includes(q) &&
    (!status || p.status === status)
  );
  if (!projectsDb.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted)">No projects found. Create one to get started!</div>';
    return;
  }

  if (!filtered.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted)">No projects match your search.</div>';
    return;
  }
  
  grid.innerHTML = filtered.map(p => {
    const daysRemaining = Math.ceil((new Date(p.end_date) - new Date()) / (1000*60*60*24));
    const progress = p.avg_progress || 0;
    const budgetUsed = p.total_actual_cost || 0;
    const budgetRemaining = p.budget - budgetUsed;
    
    return `
      <div class="project-card" onclick="selectProject(${p.id})">
        <div style="font-weight:600;color:var(--primary);margin-bottom:0.5rem">${highlightText(p.project_name, q)}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:1rem">${p.task_count || 0} tasks</div>
        
        <div style="font-size:0.75rem;margin-bottom:0.5rem">
          <strong>Members:</strong> ${highlightText(p.members || '-', q)}
        </div>

        <div style="margin-bottom:1rem">
          <div style="font-size:0.75rem;font-weight:600;margin-bottom:0.25rem">Progress: ${progress.toFixed(0)}%</div>
          <div style="height:6px;background:var(--bg-light);border-radius:3px;overflow:hidden">
            <div style="height:100%;background:var(--primary);width:${progress}%"></div>
          </div>
        </div>
        
        <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.5rem">
          ${daysRemaining > 0 ? daysRemaining + ' days left' : 'Overdue'}
        </div>
        
        <div style="padding-top:0.75rem;border-top:1px solid var(--border);font-size:0.75rem;margin-top:0.75rem">
          <div style="display:flex;justify-content:space-between">
            <span>Budget: PHP ${(p.budget || 0).toLocaleString('en-PH', {maximumFractionDigits:0})}</span>
            <span style="color:${budgetRemaining < p.budget * 0.2 ? 'var(--danger)' : 'var(--success)'}">PHP ${budgetRemaining.toLocaleString('en-PH', {maximumFractionDigits:0})} left</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function changeCalendarMonth(delta) {
  currentCalendarDate = new Date(currentCalendarDate.getFullYear(), currentCalendarDate.getMonth() + delta, 1);
  renderProjectsCalendar();
}

function jumpToCurrentMonth() {
  currentCalendarDate = new Date();
  renderProjectsCalendar();
}

function renderProjectsCalendar() {
  const grid = document.getElementById('projects-calendar');
  const monthLabel = document.getElementById('calendar-month-label');
  if (!grid || !monthLabel) return;

  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const gridStart = new Date(monthStart);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const gridEnd = new Date(monthEnd);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

  monthLabel.textContent = currentCalendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  if (!projectsDb.length) {
    grid.innerHTML = '<div class="calendar-empty" style="grid-column:1/-1">No projects yet.</div>';
    return;
  }

  const days = [];
  for (let cursor = new Date(gridStart); cursor <= gridEnd; cursor.setDate(cursor.getDate() + 1)) {
    days.push(new Date(cursor));
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  grid.innerHTML = days.map(day => {
    const dayOnly = new Date(day);
    dayOnly.setHours(0, 0, 0, 0);

    const dayProjects = projectsDb.filter(project => {
      const start = new Date(project.start_date);
      const end = new Date(project.end_date || project.start_date);
      start.setHours(0, 0, 0, 0);
      end.setHours(0, 0, 0, 0);
      return dayOnly >= start && dayOnly <= end;
    });

    const isOutside = day.getMonth() !== month;
    const isToday = dayOnly.getTime() === today.getTime();

    return `
      <div class="calendar-day ${isOutside ? 'is-outside' : ''} ${isToday ? 'is-today' : ''}">
        <div class="calendar-day-head">
          <div class="calendar-day-num">${day.getDate()}</div>
          <div class="calendar-day-count">${dayProjects.length ? dayProjects.length + ' proj' : ''}</div>
        </div>
        <div class="calendar-projects">
          ${dayProjects.slice(0, 3).map(project => {
            const end = new Date(project.end_date || project.start_date);
            end.setHours(0, 0, 0, 0);
            const isEnding = (end.getTime() - dayOnly.getTime()) / (1000 * 60 * 60 * 24) <= 2;
            return `<button class="calendar-project-chip ${isEnding ? 'is-ending' : ''}" onclick="selectProject(${project.id})" title="${escHtml(project.project_name)}">${escHtml(project.project_name)}</button>`;
          }).join('')}
          ${dayProjects.length > 3 ? `<div class="calendar-day-count">+${dayProjects.length - 3} more</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function filterProjects() {
  captureGanttToolbarState('projects');
  renderProjects();
}

function selectProject(projectId) {
  currentProjectId = projectId;
  switchTab('gantt', document.querySelectorAll('.module-tab')[2]);
}

function openProjectModal() {
  document.getElementById('f-project-name').value = '';
  document.getElementById('f-project-description').value = '';
  document.getElementById('f-project-manager').value = '';
  document.getElementById('f-project-budget').value = '';
  document.getElementById('f-project-members').value = '';
  document.getElementById('project-modal-backdrop').classList.add('open');
}

function closeProjectModal() {
  document.getElementById('project-modal-backdrop').classList.remove('open');
}

function saveProject() {
  const name = document.getElementById('f-project-name').value.trim();
  const budget = parseFloat(document.getElementById('f-project-budget').value);
  
  if (!name || !budget) {
    alert('Project name and budget are required');
    return;
  }
  
  const payload = {
    project_name: name,
    description: document.getElementById('f-project-description').value.trim(),
    start_date: document.getElementById('f-project-start').value,
    end_date: document.getElementById('f-project-end').value,
    project_manager: document.getElementById('f-project-manager').value.trim(),
    budget,
    budget,
    members: document.getElementById('f-project-members').value.trim()
  };
  
  fetch('/api/projects', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  })
  .then(r => r.json())
  .then(() => {
    closeProjectModal();
    loadProjects();
    alert('Project created successfully');
  })
  .catch(e => alert('Error: ' + e.message));
}

function updateProjectSelectors() {
  const opts = '<option value="">Select a project</option>' + 
    projectsDb.map(p => `<option value="${p.id}">${escHtml(p.project_name)}</option>`).join('');
  const projectSelector = document.getElementById('project-selector');
  const costSelector = document.getElementById('cost-project-selector');
  if (projectSelector) {
    projectSelector.innerHTML = opts;
    if (currentProjectId) projectSelector.value = String(currentProjectId);
  }
  if (costSelector) {
    costSelector.innerHTML = opts;
    if (currentProjectId) costSelector.value = String(currentProjectId);
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// GANTT CHART
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function loadGanttForProject() {
  const projectId = document.getElementById('project-selector').value;
  if (!projectId) {
    document.getElementById('gantt-info').style.display = 'none';
    document.getElementById('gantt-placeholder').style.display = 'block';
    return;
  }
  
  currentProjectId = projectId;
  document.getElementById('gantt-info').style.display = 'block';
  document.getElementById('gantt-placeholder').style.display = 'none';
  
  const project = projectsDb.find(p => p.id == projectId);
  
  fetch(`/api/projects/${projectId}/tasks`)
    .then(r => r.json())
    .then(data => {
      tasksDb = data;
      renderGantt(project);
    })
    .catch(e => console.error('Error:', e));
}

function renderGantt(project) {
  if (!tasksDb.length) {
    document.getElementById('gantt-tasks').innerHTML = 
      '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted)">No tasks yet.</div>';
    return;
  }
  
  const projectStart = new Date(project.start_date);
  const projectEnd = new Date(project.end_date);
  const totalDays = Math.ceil((projectEnd - projectStart) / (1000*60*60*24));
  
  document.getElementById('gantt-duration').textContent = totalDays + ' days';
  document.getElementById('gantt-progress').textContent = (project.avg_progress || 0).toFixed(0) + '%';
  document.getElementById('gantt-completed').textContent = 
    tasksDb.filter(t => t.status === 'completed').length + '/' + tasksDb.length;
  
  document.getElementById('gantt-tasks').innerHTML = tasksDb.map(task => {
    const taskStart = new Date(task.start_date);
    const taskEnd = new Date(task.end_date);
    const taskDays = Math.ceil((taskEnd - taskStart) / (1000*60*60*24));
    const startOffset = Math.ceil((taskStart - projectStart) / (1000*60*60*24));
    
    const percentStart = (startOffset / totalDays) * 100;
    const percentWidth = (taskDays / totalDays) * 100;
    const progressPercent = (task.progress || 0);
    
    return `
      <div class="gantt-row">
        <div>
          <div class="gantt-task-name">${escHtml(task.task_name)}</div>
          <div style="font-size:0.65rem;color:var(--text-muted)">${escHtml(task.assigned_to || '-')}</div>
        </div>
        <div class="gantt-timeline">
          <div class="gantt-bar plan" style="left:${percentStart}%;width:${percentWidth}%" title="Planned: ${task.start_date} to ${task.end_date}">
            Plan
          </div>
          <div class="gantt-bar actual" style="left:${percentStart}%;width:${(percentWidth * progressPercent / 100)}%" title="Progress: ${progressPercent}%">
            ${progressPercent}%
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function openTaskModal() {
  if (!currentProjectId) {
    alert('Please select a project first');
    return;
  }
  document.getElementById('f-task-name').value = '';
  document.getElementById('f-task-description').value = '';
  document.getElementById('f-task-assigned').value = '';
  document.getElementById('f-task-plan-cost').value = '';
  document.getElementById('task-modal-backdrop').classList.add('open');
}

function closeTaskModal() {
  document.getElementById('task-modal-backdrop').classList.remove('open');
}

function saveTask() {
  const name = document.getElementById('f-task-name').value.trim();
  const startDate = document.getElementById('f-task-start').value;
  const endDate = document.getElementById('f-task-end').value;
  
  if (!name || !startDate || !endDate) {
    alert('Task name, start date, and end date are required');
    return;
  }
  
  const payload = {
    project_id: currentProjectId,
    task_name: name,
    description: document.getElementById('f-task-description').value.trim(),
    start_date: startDate,
    end_date: endDate,
    assigned_to: document.getElementById('f-task-assigned').value.trim(),
    plan_cost: parseFloat(document.getElementById('f-task-plan-cost').value) || 0
  };
  
  fetch('/api/tasks', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  })
  .then(r => r.json())
  .then(() => {
    closeTaskModal();
    loadGanttForProject();
    alert('Task created successfully');
  })
  .catch(e => alert('Error: ' + e.message));
}

let activeTaskId = null;
function openQuickTaskModal(id, name, progress, status) {
  activeTaskId = id;
  document.getElementById('quick-task-title').textContent = name;
  document.getElementById('q-task-progress').value = progress;
  document.getElementById('q-progress-val').textContent = progress + '%';
  document.getElementById('q-task-status').value = status;
  document.getElementById('quick-task-modal-backdrop').classList.add('open');
}

function closeQuickTaskModal() {
  document.getElementById('quick-task-modal-backdrop').classList.remove('open');
}

function saveQuickTask() {
  const progress = document.getElementById('q-task-progress').value;
  const status = document.getElementById('q-task-status').value;

  fetch(`/api/tasks/${activeTaskId}`, {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ 
      progress: parseInt(progress), 
      status: status,
      actual_cost: tasksDb.find(t => t.id === activeTaskId).actual_cost // keep current cost
    })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      closeQuickTaskModal();
      loadGanttForProject();
      loadProjects(); // Refresh project list to update total progress
    }
  })
  .catch(e => console.error('Error:', e));
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// COST ANALYSIS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function loadCostsForProject() {
  const projectId = document.getElementById('cost-project-selector').value;
  if (!projectId) {
    document.getElementById('cost-info').style.display = 'none';
    document.getElementById('cost-placeholder').style.display = 'block';
    return;
  }
  
  currentProjectId = projectId;
  document.getElementById('cost-info').style.display = 'block';
  document.getElementById('cost-placeholder').style.display = 'none';
  
  const project = projectsDb.find(p => p.id == projectId);
  
  fetch(`/api/projects/${projectId}/costs`)
    .then(r => r.json())
    .then(data => {
      costsDb = data;
      renderCosts(project);
    })
    .catch(e => console.error('Error:', e));
}

function renderCosts(project) {
  const totalPlan = costsDb.reduce((sum, c) => sum + c.plan_amount, 0);
  const totalActual = costsDb.reduce((sum, c) => sum + (c.actual_amount || 0), 0);
  const variance = totalActual - totalPlan;
  const percentUsed = (totalActual / totalPlan * 100) || 0;
  
  document.getElementById('cost-plan').textContent = 'PHP ' + totalPlan.toLocaleString('en-PH', {maximumFractionDigits:0});
  document.getElementById('cost-actual').textContent = 'PHP ' + totalActual.toLocaleString('en-PH', {maximumFractionDigits:0});
  document.getElementById('cost-variance').textContent = 'PHP ' + Math.abs(variance).toLocaleString('en-PH', {maximumFractionDigits:0});
  document.getElementById('cost-variance').classList.toggle('positive', variance < 0);
  document.getElementById('cost-percent').textContent = percentUsed.toFixed(1) + '%';
  
  const tbody = document.getElementById('costs-tbody');
  tbody.innerHTML = costsDb.length ? costsDb.map(c => {
    const v = c.actual_amount - c.plan_amount;
    const pct = (v / c.plan_amount * 100) || 0;
    return `
      <tr>
        <td>${escHtml(c.cost_category)}</td>
        <td>PHP ${(c.plan_amount).toLocaleString('en-PH', {maximumFractionDigits:0})}</td>
        <td>PHP ${(c.actual_amount || 0).toLocaleString('en-PH', {maximumFractionDigits:0})}</td>
        <td style="color:${v > 0 ? 'var(--danger)' : 'var(--success)'};font-weight:600">PHP ${Math.abs(v).toLocaleString('en-PH', {maximumFractionDigits:0})}</td>
        <td style="color:${v > 0 ? 'var(--danger)' : 'var(--success)'};font-weight:600">${pct > 0 ? '+' : ''}${pct.toFixed(1)}%</td>
        <td><span style="background:${v > 0 ? '#fecaca' : '#fee2e2'};color:${v > 0 ? '#991b1b' : '#dc2626'};padding:0.25rem 0.5rem;border-radius:0.25rem;font-size:0.75rem">${v > 0 ? 'Over' : 'Under'}</span></td>
      </tr>
    `;
  }).join('') : '<tr class="empty-row"><td colspan="6">No costs recorded yet</td></tr>';
}

function openCostModal() {
  if (!currentProjectId) {
    alert('Please select a project first');
    return;
  }
  document.getElementById('f-cost-category').value = '';
  document.getElementById('f-plan-amount').value = '';
  document.getElementById('f-actual-amount').value = '';
  document.getElementById('f-cost-notes').value = '';
  document.getElementById('cost-modal-backdrop').classList.add('open');
}

function closeCostModal() {
  document.getElementById('cost-modal-backdrop').classList.remove('open');
}

function saveCost() {
  const category = document.getElementById('f-cost-category').value.trim();
  const planAmount = parseFloat(document.getElementById('f-plan-amount').value);
  const actualAmount = parseFloat(document.getElementById('f-actual-amount').value);
  
  if (!category || !planAmount) {
    alert('Cost category and planned amount are required');
    return;
  }
  
  const payload = {
    project_id: currentProjectId,
    cost_category: category,
    plan_amount: planAmount,
    actual_amount: actualAmount || 0,
    cost_date: document.getElementById('f-cost-date').value,
    notes: document.getElementById('f-cost-notes').value.trim()
  };
  
  fetch('/api/project-costs', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  })
  .then(r => r.json())
  .then(() => {
    closeCostModal();
    loadCostsForProject();
    alert('Cost recorded successfully');
  })
  .catch(e => alert('Error: ' + e.message));
}

function escHtml(str) {
  return (str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightText(value, query) {
  const escaped = escHtml(value);
  const tokens = String(query || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return escaped;
  const pattern = tokens.sort((a, b) => b.length - a.length).map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return pattern ? escaped.replace(new RegExp(`(${pattern})`, 'gi'), '<mark>$1</mark>') : escaped;
}

