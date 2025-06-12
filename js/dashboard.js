// Global variables for chart instances to allow for updates/destruction
let balanceChartInstance = null;
let monthlyChartInstance = null;

// DOM Elements
const loadingIndicator = document.getElementById('loadingIndicator');
const dashboardContent = document.getElementById('dashboardContent');
const usernameNavbarDisplay = document.getElementById('username');
const currentDateHeaderDisplay = document.getElementById('currentDateHeaderDisplay');
const currentYearFooter = document.getElementById('currentYear');
const notificationArea = document.getElementById('notificationArea');
const logoutButton = document.getElementById('logoutBtn');

// Manager Section Elements
const managerSection = document.getElementById('managerSection');
const managerLoadingIndicator = document.getElementById('managerLoadingIndicator');
const managerTableContainer = document.getElementById('managerTableContainer');
const noTeamApplicationsMsg = document.getElementById('noTeamApplicationsMsg');
const teamApplicationsBody = document.getElementById('teamApplicationsBody');


document.addEventListener('DOMContentLoaded', async () => {
    // Set current year in footer
    if (currentYearFooter) {
        currentYearFooter.textContent = new Date().getFullYear();
    }

    // Set current date in header
    if (currentDateHeaderDisplay) {
        currentDateHeaderDisplay.textContent = new Date().toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });
    }
    
    // Authentication check & username display
    const storedUsername = localStorage.getItem('username');
    if (usernameNavbarDisplay && storedUsername) {
        usernameNavbarDisplay.textContent = storedUsername;
    } else if (!storedUsername) {
        // If no username, redirect to login. This is a basic check.
        // A more robust solution would be server-side session checks on API calls.
        showNotification('You are not logged in. Redirecting to login page.', 'error');
        setTimeout(() => window.location.href = 'login.html', 2000);
        return; // Stop further execution
    }

    showMainLoading(true);
    await loadLeaveData();
    // await loadMasterCalendar(); // If you have a separate master calendar call
    showMainLoading(false);

    // Setup logout button
    if (logoutButton) {
        logoutButton.addEventListener('click', handleLogout);
    }
});

function showMainLoading(isLoading) {
    if (isLoading) {
        if (loadingIndicator) loadingIndicator.style.display = 'block';
        if (dashboardContent) dashboardContent.style.display = 'none';
    } else {
        if (loadingIndicator) loadingIndicator.style.display = 'none';
        if (dashboardContent) dashboardContent.style.display = 'block';
    }
}

function showNotification(message, type = 'info', duration = 5000) {
    if (!notificationArea) return;

    const iconClass = {
        success: 'fa-check-circle',
        error: 'fa-times-circle',
        info: 'fa-info-circle',
        warning: 'fa-exclamation-triangle'
    }[type];

    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `<i class="fas ${iconClass}"></i> ${message}`;
    
    notificationArea.appendChild(notification);

    // Animate in
    setTimeout(() => notification.style.opacity = '1', 10); // Slight delay for transition

    // Automatically remove after some time
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 500); // Remove after fade
    }, duration);
}

async function loadLeaveData() {
    try {
        // const response = await fetch('/api/leave-data'); // Your actual API endpoint
        // Mock response for demonstration:
        const response = await new Promise(resolve => setTimeout(() => resolve({
            ok: true,
            status: 200,
            json: async () => ({
                success: true,
                data: {
                    username: localStorage.getItem('username') || "Demo User",
                    leaveBalance: 15,
                    leaveTaken: 5,
                    mcBalance: 10,
                    mcTaken: 2,
                    totalLeaveEntitlement: 20, // Example field
                    carryForwardLeave: 3,      // Example field
                    annualLeaveEntitlement: 17,// Example field
                    compassionateLeave: 2,     // Example field
                    monthlyData: [ // Example: { month: "Jan", count: 2 }
                        { month: "Jan", count: 1 }, { month: "Feb", count: 0 }, { month: "Mar", count: 2 },
                        { month: "Apr", count: 1 }, { month: "May", count: 1 }, { month: "Jun", count: 0 }
                    ],
                    isManager: true, // Set to true to test manager section
                    teamApplications: [ // Example team applications
                        { id: 1, employeeName: "John Doe", leaveType: "Annual", startDate: "2025-07-01", endDate: "2025-07-03", days: 3, reason: "Vacation", status: "Pending" },
                        { id: 2, employeeName: "Jane Smith", leaveType: "Sick", startDate: "2025-06-15", endDate: "2025-06-15", days: 1, reason: "Flu", status: "Pending" }
                    ]
                }
            })
        }), 1000));


        if (!response.ok) {
            if (response.status === 401) {
                showNotification('Session expired. Redirecting to login.', 'error');
                localStorage.removeItem('username');
                setTimeout(() => window.location.href = 'login.html', 2000);
                return;
            }
            throw new Error(`Failed to load data. Status: ${response.status}`);
        }
        
        const result = await response.json();

        if (result.success && result.data) {
            if (usernameNavbarDisplay && result.data.username) {
                 usernameNavbarDisplay.textContent = result.data.username;
            }
            
            displayLeaveData(result.data);
            
            if (result.data.isManager) {
                displayManagerSection(result.data.teamApplications || []);
            } else {
                if(managerSection) managerSection.style.display = 'none';
            }
            
            createBalanceChart(result.data);
            createMonthlyChart(result.data.monthlyData || []);
            showNotification('Dashboard data loaded successfully.', 'success');
        } else {
            throw new Error(result.message || 'API call was not successful or data is missing.');
        }
    } catch (error) {
        console.error('Error in loadLeaveData function:', error);
        showNotification(`Error loading dashboard: ${error.message}`, 'error');
        // Optionally hide sections or show error messages within content areas
        if(dashboardContent) dashboardContent.innerHTML = `<p class="text-danger text-center">Could not load dashboard data. ${error.message}</p>`;
    }
}

function displayLeaveData(data) {
    if (!data) {
        showNotification("No leave data available to display.", 'warning');
        return;
    }
    const na = '0'; // Default to '0' instead of 'N/A' for numerical fields
    document.getElementById('leaveBalance').textContent = data.leaveBalance !== undefined ? data.leaveBalance : na;
    document.getElementById('leaveTaken').textContent = data.leaveTaken !== undefined ? data.leaveTaken : na;
    document.getElementById('mcBalance').textContent = data.mcBalance !== undefined ? data.mcBalance : na;
    document.getElementById('mcTaken').textContent = data.mcTaken !== undefined ? data.mcTaken : na;
    
    // For the breakdown section - ensure these IDs match your HTML
    document.getElementById('totalLeave').textContent = data.totalLeaveEntitlement !== undefined ? data.totalLeaveEntitlement : na;
    document.getElementById('carryForward').textContent = data.carryForwardLeave !== undefined ? data.carryForwardLeave : na;
    document.getElementById('annualLeave').textContent = data.annualLeaveEntitlement !== undefined ? data.annualLeaveEntitlement : na;
    document.getElementById('compassionateLeave').textContent = data.compassionateLeave !== undefined ? data.compassionateLeave : na;
}

function createBalanceChart(apiData) {
    const ctx = document.getElementById('leaveBalanceChart')?.getContext('2d');
    if (!ctx) return;

    if (!apiData || apiData.leaveBalance === undefined || apiData.leaveTaken === undefined) {
        ctx.canvas.style.display = 'none';
        // Optionally show a text message in its place
        const parent = ctx.canvas.parentElement;
        if(parent && !parent.querySelector('.no-chart-data')) {
            const noDataMsg = document.createElement('p');
            noDataMsg.textContent = 'Leave balance data not available for chart.';
            noDataMsg.className = 'text-muted text-center no-chart-data';
            parent.appendChild(noDataMsg);
        }
        return;
    }

    if (balanceChartInstance) {
        balanceChartInstance.destroy();
    }

    balanceChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Available Balance', 'Leave Taken'],
            datasets: [{
                label: 'Leave Overview',
                data: [apiData.leaveBalance, apiData.leaveTaken],
                backgroundColor: [
                    'rgba(0, 123, 255, 0.7)', // var(--primary-color)
                    'rgba(220, 53, 69, 0.7)'  // var(--danger-color)
                ],
                borderColor: [
                    'rgba(0, 123, 255, 1)',
                    'rgba(220, 53, 69, 1)'
                ],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth:12, padding:15 } },
                title: { display: false } // Title is already in card header
            }
        }
    });
}

function createMonthlyChart(monthlyData) {
    const ctx = document.getElementById('monthlyLeaveChart')?.getContext('2d');
     if (!ctx) return;

    if (!monthlyData || monthlyData.length === 0) {
        ctx.canvas.style.display = 'none';
         const parent = ctx.canvas.parentElement;
        if(parent && !parent.querySelector('.no-chart-data')) {
            const noDataMsg = document.createElement('p');
            noDataMsg.textContent = 'Monthly leave data not available for chart.';
            noDataMsg.className = 'text-muted text-center no-chart-data';
            parent.appendChild(noDataMsg);
        }
        return;
    }

    if (monthlyChartInstance) {
        monthlyChartInstance.destroy();
    }

    monthlyChartInstance = new Chart(ctx, {
        type: 'bar', // Or 'line'
        data: {
            labels: monthlyData.map(d => d.month),
            datasets: [{
                label: 'Leaves Taken per Month',
                data: monthlyData.map(d => d.count),
                backgroundColor: 'rgba(40, 167, 69, 0.7)', // var(--success-color)
                borderColor: 'rgba(40, 167, 69, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { stepSize: 1 } // Ensure y-axis shows whole numbers for leave counts
                }
            },
            plugins: {
                legend: { display: false }, // Can hide legend if only one dataset
                title: { display: false }
            }
        }
    });
}


function displayManagerSection(teamApplications) {
    if (!managerSection) return;

    managerSection.style.display = 'block';
    if (managerLoadingIndicator) managerLoadingIndicator.style.display = 'block';
    if (managerTableContainer) managerTableContainer.style.display = 'none';
    if (noTeamApplicationsMsg) noTeamApplicationsMsg.style.display = 'none';
    if (teamApplicationsBody) teamApplicationsBody.innerHTML = '';

    // Simulate loading for demo; in real use, this would be part of data fetching
    setTimeout(() => {
        if (managerLoadingIndicator) managerLoadingIndicator.style.display = 'none';
        if (teamApplications && teamApplications.length > 0) {
            if (managerTableContainer) managerTableContainer.style.display = 'block';
            teamApplications.forEach(app => {
                const row = teamApplicationsBody.insertRow();
                row.insertCell().textContent = app.id || 'N/A';
                row.insertCell().textContent = app.employeeName || 'N/A';
                row.insertCell().textContent = app.leaveType || 'N/A';
                row.insertCell().textContent = `${app.startDate || ''} - ${app.endDate || ''}`;
                row.insertCell().textContent = app.days || 'N/A';
                row.insertCell().textContent = app.reason || 'N/A';
                
                const statusCell = row.insertCell();
                statusCell.innerHTML = `<span class="status status-${(app.status || 'unknown').toLowerCase()}">${app.status || 'N/A'}</span>`; // Add styling for status

                const actionsCell = row.insertCell();
                // Add Approve/Reject buttons here if needed and if status is 'Pending'
                if ((app.status || '').toLowerCase() === 'pending') {
                     actionsCell.innerHTML = `
                        <button class="btn btn-sm btn-success" onclick="handleLeaveAction(${app.id}, 'approve')">Approve</button>
                        <button class="btn btn-sm btn-danger" onclick="handleLeaveAction(${app.id}, 'reject')">Reject</button>
                    `;
                } else {
                    actionsCell.textContent = '-';
                }
            });
        } else {
            if (noTeamApplicationsMsg) noTeamApplicationsMsg.style.display = 'block';
        }
    }, 200); // Simulate processing delay
}

// Placeholder for handling leave actions from manager view
function handleLeaveAction(applicationId, action) {
    showNotification(`Action: ${action} for application ID: ${applicationId}. (Implement API call)`, 'info');
    // TODO: Implement API call to approve/reject leave
    // After successful API call, you might want to reload or update the manager section
    // For example:
    // find the row and update its status, or disable buttons.
    // Or, simply call `loadLeaveData()` again to refresh everything, though less efficient.
}


async function handleLogout() {
    if (!logoutButton) return;

    logoutButton.disabled = true;
    logoutButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging out...';

    try {
        // const response = await fetch('/api/logout', { method: 'POST' }); // Your actual API
        // Mock response for demonstration:
        const response = await new Promise(resolve => setTimeout(() => resolve({
            ok: true, json: async () => ({ success: true })
        }), 500));

        const result = await response.json();
        if (result.success) {
            showNotification('Logged out successfully. Redirecting...', 'success');
            localStorage.removeItem('username');
            setTimeout(() => window.location.href = 'login.html', 1500);
        } else {
            showNotification('Logout failed: ' + (result.message || 'Server error'), 'error');
            resetLogoutButton();
        }
    } catch (e) {
        showNotification('Error during logout: ' + e.message, 'error');
        resetLogoutButton();
        console.error("Logout error:", e);
    }
}

function resetLogoutButton() {
    if(logoutButton) {
        logoutButton.disabled = false;
        logoutButton.innerHTML = '<i class="fas fa-sign-out-alt"></i> Logout';
    }
}

// Add some styling for status badges in manager table via JS (or do it in CSS)
const styleSheet = document.createElement("style");
styleSheet.type = "text/css";
styleSheet.innerText = `
    .status { padding: 3px 8px; border-radius: var(--border-radius); font-size: 0.8em; color: white; text-transform: capitalize; }
    .status-pending { background-color: var(--warning-color); color: var(--dark-color); }
    .status-approved { background-color: var(--success-color); }
    .status-rejected { background-color: var(--danger-color); }
    .status-unknown { background-color: var(--secondary-color); }
`;
document.head.appendChild(styleSheet);
