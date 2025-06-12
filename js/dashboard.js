// Dashboard functionality
document.addEventListener('DOMContentLoaded', async () => {
    // Authentication: The server uses cookie-based sessions.
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

    // Update balance overview
    document.getElementById('totalLeave').textContent = data.totalLeave !== undefined ? data.totalLeave : 'N/A';
    document.getElementById('leaveTaken').textContent = data.leaveTaken !== undefined ? data.leaveTaken : 'N/A';
    document.getElementById('leaveBalance').textContent = data.leaveBalance !== undefined ? data.leaveBalance : 'N/A';
    document.getElementById('mcTaken').textContent = data.mcTaken !== undefined ? data.mcTaken : 'N/A';
    document.getElementById('mcBalance').textContent = data.mcBalance !== undefined ? data.mcBalance : 'N/A';
    
    // Update leave breakdown
    document.getElementById('carryForward').textContent = data.carryForward !== undefined ? data.carryForward : 'N/A';
    document.getElementById('annualLeave').textContent = data.annualLeave !== undefined ? data.annualLeave : 'N/A';
    document.getElementById('compassionateLeave').textContent = data.compassionateLeave !== undefined ? data.compassionateLeave : 'N/A';
    
    // Update leave applications table
    if (data.applications && Array.isArray(data.applications)) {
        updateLeaveApplicationsTable(data.applications);
    }
    
    // Update monthly table
    updateMonthlyTable(data.monthlyData);
}

function updateMonthlyTable(monthlyData) {
    const monthlyTableBody = document.getElementById('monthlyTableBody');
    if (!monthlyTableBody) {
        console.error("Element with ID 'monthlyTableBody' not found.");
        return;
    }
    monthlyTableBody.innerHTML = '';
    
    const months = ['Jan', 'Feb', 'March', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
    const currentMonthShort = new Date().toLocaleString('en-US', { month: 'short' });

    if (!monthlyData || typeof monthlyData !== 'object') {
        console.warn('monthlyData is missing or not an object:', monthlyData);
        const row = monthlyTableBody.insertRow();
        const cell = row.insertCell();
        cell.colSpan = 3;
        cell.textContent = 'Monthly data is currently unavailable.';
        return;
    }
    
    months.forEach(monthFullName => {
        const row = document.createElement('tr');
        
        const monthStats = monthlyData[monthFullName]; 
        
        let isCurrentMonth = false;
        if (monthFullName.startsWith(currentMonthShort) || (monthFullName === "Sept" && currentMonthShort === "Sep")) {
             isCurrentMonth = true;
        }

        if (isCurrentMonth) {
            row.style.backgroundColor = '#e3f2fd';
        }
        
        let leaveDays = '0';
        let mcDays = '0';

        if (monthStats && typeof monthStats === 'object') {
            leaveDays = monthStats.leave !== undefined ? monthStats.leave.toString() : '0';
            mcDays = monthStats.mc !== undefined ? monthStats.mc.toString() : '0';
        } else {
            console.warn(`Data for month ${monthFullName} is missing or not an object in monthlyData.`);
        }
        
        row.innerHTML = `
            <td>${monthFullName}</td>
            <td>${leaveDays}</td>
            <td>${mcDays}</td>
        `;
        
        monthlyTableBody.appendChild(row);
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
        row.innerHTML = '<td colspan="8" style="text-align: center;">No leave applications found</td>';
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
                <button class="btn btn-sm btn-secondary" onclick="cancelApplication('${app.id}', ${app.rowNumber})">Cancel</button>
            `;
        }
        
        row.innerHTML = `
            <td>${app.id}</td>
            <td>${app.leaveType}</td>
            <td>${formatDate(app.startDate)}</td>
            <td>${formatDate(app.endDate)}</td>
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
        row.innerHTML = '<td colspan="9" style="text-align: center;">No pending team applications</td>';
        teamApplicationsBody.appendChild(row);
        return;
    }
    
    teamApplications.forEach(app => {
        const row = document.createElement('tr');
        row.classList.add(`status-${app.status.toLowerCase()}`);
        
        let actionsHtml = '';
        if (app.status === 'Pending') {
            actionsHtml = `
                <button class="btn btn-sm btn-primary" onclick="approveLeave('${app.id}', ${app.rowNumber})">Approve</button>
                <button class="btn btn-sm btn-danger" onclick="rejectLeave('${app.id}', ${app.rowNumber})">Reject</button>
            `;
        }
        
        row.innerHTML = `
            <td>${app.id}</td>
            <td>${app.username}</td>
            <td>${app.leaveType}</td>
            <td>${formatDate(app.startDate)}</td>
            <td>${formatDate(app.endDate)}</td>
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
