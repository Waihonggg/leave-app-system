// Modern Dashboard functionality
let masterCalendarData = [];
let balanceChart = null;
let monthlyChart = null;

document.addEventListener('DOMContentLoaded', async () => {
    // Authentication
    const storedUsername = localStorage.getItem('username');
    const usernameDisplay = document.getElementById('username');

    if (usernameDisplay && storedUsername) {
        usernameDisplay.textContent = storedUsername;
    }
    
    // Set current date
    const currentDateDisplay = document.getElementById('currentDate');
    if (currentDateDisplay) {
        currentDateDisplay.textContent = new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }
    
    // Load leave data
    await loadLeaveData();
    
    // Load master calendar data
    await loadMasterCalendar();
    
    // Setup logout
    const logoutButton = document.getElementById('logoutBtn');
    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            try {
                const response = await fetch('/api/logout', { method: 'POST' });
                const result = await response.json();
                localStorage.removeItem('username');
                if (result.success) {
                    window.location.href = 'login.html';
                } else {
                    alert('Logout failed: ' + (result.message || 'Server error'));
                }
            } catch (e) {
                alert('Error during logout: ' + e.message);
                console.error("Logout error:", e);
            }
        });
    }
});

async function loadLeaveData() {
    try {
        const response = await fetch('/api/leave-data'); 
        
        if (!response.ok) {
            if (response.status === 401) {
                console.warn('Unauthorized (401) when fetching /api/leave-data. Redirecting to login.');
                localStorage.removeItem('username');
                window.location.href = 'login.html';
                return;
            }
            throw new Error(`Failed to load data. Status: ${response.status}`);
        }
        
        const result = await response.json();
        console.log("Data received from /api/leave-data:", result);

        if (result.success && result.data) {
            const usernameDisplay = document.getElementById('username');
            if (usernameDisplay && result.data.username) {
                 usernameDisplay.textContent = result.data.username;
            }
            displayLeaveData(result.data);
            
            // If user is a manager, load team applications
            if (result.data.isManager && result.data.teamApplications) {
                displayManagerSection(result.data.teamApplications);
            }
            
            // Create charts
            createBalanceChart(result.data);
            createMonthlyChart(result.data.monthlyData);
        } else {
            console.error('API call to /api/leave-data was not successful or data is missing:', result.message);
            alert('Could not load your leave data: ' + (result.message || 'Unknown error from server.'));
        }
    } catch (error) {
        console.error('Error in loadLeaveData function:', error);
        alert('An error occurred while trying to load your dashboard data. Please try logging in again.');
    }
}

function displayLeaveData(data) {
    if (!data) {
        console.error("displayLeaveData called with undefined or null data.");
        return;
    }

    // Update quick stats
    document.getElementById('leaveBalance').textContent = data.leaveBalance !== undefined ? data.leaveBalance : '0';
    document.getElementById('leaveTaken').textContent = data.leaveTaken !== undefined ? data.leaveTaken : '0';
    document.getElementById('mcBalance').textContent = data.mcBalance !== undefined ? data.mcBalance : '0';
    document.getElementById('mcTaken').textContent = data.mcTaken !== undefined ? data.mcTaken : '0';

    // Update balance overview
    document.getElementById('totalLeave').textContent = data.totalLeave !== undefined ? data.totalLeave : 'N/A';
    document.getElementById('leaveTakenDetail').textContent = data.leaveTaken !== undefined ? data.leaveTaken : 'N/A';
    document.getElementById('leaveBalanceDetail').textContent = data.leaveBalance !== undefined ? data.leaveBalance : 'N/A';
    
    // Update leave breakdown
    document.getElementById('carryForward').textContent = data.carryForward !== undefined ? data.carryForward : 'N/A';
    document.getElementById('annualLeave').textContent = data.annualLeave !== undefined ? data.annualLeave : 'N/A';
    document.getElementById('compassionateLeave').textContent = data.compassionateLeave !== undefined ? data.compassionateLeave : 'N/A';
    document.getElementById('wfhCount').textContent = data.wfhCount !== undefined ? data.wfhCount : 'N/A';
    
    // Update leave applications table
    if (data.applications && Array.isArray(data.applications)) {
        updateLeaveApplicationsTable(data.applications);
    }
    
    // Update monthly table
    if (data.monthlyData) {
        updateMonthlyTable(data.monthlyData);
    }
}

function updateMonthlyTable(monthlyData) {
    const tableBody = document.getElementById('monthlyTableBody');
    if (!tableBody) {
        console.error("Element with ID 'monthlyTableBody' not found.");
        return;
    }
    
    tableBody.innerHTML = '';
    
    // Define month order
    const months = [
        { key: 'Jan', name: 'January' },
        { key: 'Feb', name: 'February' },
        { key: 'March', name: 'March' },
        { key: 'Apr', name: 'April' },
        { key: 'May', name: 'May' },
        { key: 'June', name: 'June' },
        { key: 'July', name: 'July' },
        { key: 'Aug', name: 'August' },
        { key: 'Sept', name: 'September' },
        { key: 'Oct', name: 'October' },
        { key: 'Nov', name: 'November' },
        { key: 'Dec', name: 'December' }
    ];
    
    months.forEach(month => {
        const row = document.createElement('tr');
        const monthData = monthlyData[month.key] || { leave: 0, mc: 0 };
        
        row.innerHTML = `
            <td>${month.name}</td>
            <td>${monthData.leave || 0}</td>
            <td>${monthData.mc || 0}</td>
        `;
        
        tableBody.appendChild(row);
    });
}

function createBalanceChart(data) {
    const ctx = document.getElementById('balanceChart');
    if (!ctx) return;
    
    if (balanceChart) {
        balanceChart.destroy();
    }
    
    balanceChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Leave Taken', 'Leave Balance'],
            datasets: [{
                data: [data.leaveTaken || 0, data.leaveBalance || 0],
                backgroundColor: ['#f56565', '#48bb78'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 20,
                        font: {
                            size: 14
                        }
                    }
                }
            }
        }
    });
}

function createMonthlyChart(monthlyData) {
    const ctx = document.getElementById('monthlyChart');
    if (!ctx || !monthlyData) return;
    
    if (monthlyChart) {
        monthlyChart.destroy();
    }
    
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const leaveData = [];
    const mcData = [];
    
    months.forEach(month => {
        const monthKey = month === 'Mar' ? 'March' : 
                        month === 'Jun' ? 'June' : 
                        month === 'Jul' ? 'July' : 
                        month === 'Sep' ? 'Sept' : month;
        
        if (monthlyData[monthKey]) {
            leaveData.push(monthlyData[monthKey].leave || 0);
            mcData.push(monthlyData[monthKey].mc || 0);
        } else {
            leaveData.push(0);
            mcData.push(0);
        }
    });
    
    monthlyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: months,
            datasets: [
                {
                    label: 'Leave Days',
                    data: leaveData,
                    backgroundColor: '#667eea',
                    borderRadius: 5
                },
                {
                    label: 'MC Days',
                    data: mcData,
                    backgroundColor: '#f56565',
                    borderRadius: 5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        padding: 20,
                        font: {
                            size: 14
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            }
        }
    });
}

function updateLeaveApplicationsTable(applications) {
    const tableBody = document.getElementById('leaveApplicationsBody');
    if (!tableBody) {
        console.error("Element with ID 'leaveApplicationsBody' not found.");
        return;
    }
    
    tableBody.innerHTML = '';

    if (applications.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="7" style="text-align: center; padding: 2rem;">No leave applications found</td>';
        tableBody.appendChild(row);
        return;
    }

    applications.forEach(app => {
        const row = document.createElement('tr');
        
        // Add status-based styling
        row.classList.add(`status-${app.status.toLowerCase()}`);
        
        let actionsHtml = '';
        if (app.status === 'Pending') {
            actionsHtml = `
                <button class="btn btn-sm btn-secondary" onclick="cancelApplication('${app.id}', ${app.rowNumber})">
                    <i class="fas fa-times"></i> Cancel
                </button>
            `;
        }
        
        row.innerHTML = `
            <td>${app.id}</td>
            <td>${app.leaveType}</td>
            <td>${formatDate(app.startDate)} - ${formatDate(app.endDate)}</td>
            <td>${app.days}</td>
            <td>${app.reason || 'N/A'}</td>
            <td>
                <span class="status-badge ${app.status.toLowerCase()}">
                    ${app.status}
                </span>
            </td>
            <td>${actionsHtml}</td>
        `;
        
        tableBody.appendChild(row);
    });
}

function displayManagerSection(teamApplications) {
    const managerSection = document.getElementById('managerSection');
    const teamApplicationsBody = document.getElementById('teamApplicationsBody');
    
    if (!managerSection || !teamApplicationsBody) return;
    
    // Show manager section
    managerSection.style.display = 'block';
    
    teamApplicationsBody.innerHTML = '';
    
    if (teamApplications.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="8" style="text-align: center; padding: 2rem;">No pending team applications</td>';
        teamApplicationsBody.appendChild(row);
        return;
    }
    
    teamApplications.forEach(app => {
        const row = document.createElement('tr');
        row.classList.add(`status-${app.status.toLowerCase()}`);
        
        let actionsHtml = '';
        if (app.status === 'Pending') {
            actionsHtml = `
                <button class="btn btn-sm btn-primary" onclick="approveLeave('${app.id}', ${app.rowNumber})">
                    <i class="fas fa-check"></i> Approve
                </button>
                <button class="btn btn-sm btn-danger" onclick="rejectLeave('${app.id}', ${app.rowNumber})">
                    <i class="fas fa-times"></i> Reject
                </button>
            `;
        }
        
        row.innerHTML = `
            <td>${app.id}</td>
            <td>${app.username}</td>
            <td>${app.leaveType}</td>
            <td>${formatDate(app.startDate)} - ${formatDate(app.endDate)}</td>
            <td>${app.days}</td>
            <td>${app.reason || 'N/A'}</td>
            <td>
                <span class="status-badge ${app.status.toLowerCase()}">
                    ${app.status}
                </span>
            </td>
            <td>${actionsHtml}</td>
        `;
        
        teamApplicationsBody.appendChild(row);
    });
}

// Master Calendar Functions
async function loadMasterCalendar() {
    try {
        const response = await fetch('/api/master-calendar');
        if (response.ok) {
            const result = await response.json();
            if (result.success) {
                masterCalendarData = result.data;
            }
        }
    } catch (error) {
        console.error('Error loading master calendar:', error);
    }
}

function showMasterCalendar() {
    const modal = document.getElementById('masterCalendarModal');
    if (modal) {
        modal.style.display = 'block';
        renderCalendar();
    }
}

function closeMasterCalendar() {
    const modal = document.getElementById('masterCalendarModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function renderCalendar() {
    const calendarView = document.getElementById('calendarView');
    if (!calendarView) return;
    
    const monthFilter = document.getElementById('monthFilter').value;
    const typeFilter = document.getElementById('typeFilter').value;
    
    // Get current year
    const currentYear = new Date().getFullYear();
    
    // Filter data
    let filteredData = masterCalendarData;
    if (monthFilter) {
        filteredData = filteredData.filter(item => {
            const date = new Date(item.date);
            return date.getMonth() === parseInt(monthFilter);
        });
    }
    if (typeFilter) {
        filteredData = filteredData.filter(item => item.type === typeFilter);
    }
    
    // Group by date
    const groupedData = {};
    filteredData.forEach(item => {
        if (!groupedData[item.date]) {
            groupedData[item.date] = [];
        }
        groupedData[item.date].push(item);
    });
    
    // Create calendar grid
    calendarView.innerHTML = '';
    
    // Add day headers
    const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayHeaders.forEach(day => {
        const header = document.createElement('div');
        header.className = 'calendar-header';
        header.textContent = day;
        header.style.fontWeight = 'bold';
        header.style.textAlign = 'center';
        header.style.padding = '10px';
        header.style.backgroundColor = '#f0f0f0';
        calendarView.appendChild(header);
    });
    
    // Get month to display
    const displayMonth = monthFilter ? parseInt(monthFilter) : new Date().getMonth();
    const firstDay = new Date(currentYear, displayMonth, 1);
    const lastDay = new Date(currentYear, displayMonth + 1, 0);
    
    // Add empty cells for days before month starts
    for (let i = 0; i < firstDay.getDay(); i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-day empty';
        calendarView.appendChild(emptyCell);
    }
    
    // Add days of the month
    for (let day = 1; day <= lastDay.getDate(); day++) {
        const dateStr = `${currentYear}-${String(displayMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayDiv = document.createElement('div');
        dayDiv.className = 'calendar-day';
        
        if (groupedData[dateStr]) {
            dayDiv.classList.add('has-leave');
        }
        
        dayDiv.innerHTML = `
            <div class="calendar-day-number">${day}</div>
        `;
        
        if (groupedData[dateStr]) {
            groupedData[dateStr].forEach(leave => {
                const leaveItem = document.createElement('div');
                leaveItem.className = `calendar-leave-item leave-type-${leave.type}`;
                leaveItem.textContent = `${leave.username} (${leave.type})`;
                leaveItem.title = `${leave.username} - ${leave.type}`;
                dayDiv.appendChild(leaveItem);
            });
        }
        
        calendarView.appendChild(dayDiv);
    }
}

function filterCalendar() {
    renderCalendar();
}

// Action functions
async function approveLeave(applicationId, rowNumber) {
    if (confirm('Are you sure you want to approve this leave application?')) {
        try {
            const response = await fetch(`/api/approve-leave?row=${rowNumber}&id=${applicationId}`, {
                method: 'GET'
            });
            
            if (response.ok) {
                alert('Leave application approved successfully');
                window.location.reload();
            } else {
                alert('Failed to approve leave application');
            }
        } catch (error) {
            console.error('Error approving leave:', error);
            alert('An error occurred while approving the leave');
        }
    }
}

async function rejectLeave(applicationId, rowNumber) {
    if (confirm('Are you sure you want to reject this leave application?')) {
        try {
            const response = await fetch(`/api/reject-leave?row=${rowNumber}&id=${applicationId}`, {
                method: 'GET'
            });
            
            if (response.ok) {
                alert('Leave application rejected successfully');
                window.location.reload();
            } else {
                alert('Failed to reject leave application');
            }
        } catch (error) {
            console.error('Error rejecting leave:', error);
            alert('An error occurred while rejecting the leave');
        }
    }
}

async function cancelApplication(applicationId, rowNumber) {
    if (confirm('Are you sure you want to cancel this leave application?')) {
        try {
            const response = await fetch(`/api/cancel-leave`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ applicationId, rowNumber })
            });
            
            const result = await response.json();
            
            if (result.success) {
                alert('Leave application cancelled successfully');
                window.location.reload();
            } else {
                alert(result.message || 'Failed to cancel leave application');
            }
        } catch (error) {
            console.error('Error cancelling leave:', error);
            alert('An error occurred while cancelling the leave');
        }
    }
}

function formatDate(dateString) {
    if (!dateString || dateString === 'N/A') return 'N/A';
    
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch (e) {
        return dateString;
    }
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('masterCalendarModal');
    if (event.target === modal) {
        closeMasterCalendar();
    }
}
