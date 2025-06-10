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
    const monthlyTableBody = document.getElementById('monthlyTableBody');
    if (!monthlyTableBody) {
        console.error("Element with ID 'monthlyTableBody' not found.");
        return;
    }
    monthlyTableBody.innerHTML = '';
    
    const months = ['Jan', 'Feb', 'March', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
    const currentMonthShort = new Date().toLocaleString('en-US', { month: 'short' });

    if (!data.monthlyData || typeof data.monthlyData !== 'object') {
        console.warn('data.monthlyData is missing or not an object:', data.monthlyData);
        const row = monthlyTableBody.insertRow();
        const cell = row.insertCell();
        cell.colSpan = 3;
        cell.textContent = 'Monthly data is currently unavailable.';
        return;
    }
    
    months.forEach(monthFullName => {
        const row = document.createElement('tr');
        
        const monthStats = data.monthlyData[monthFullName]; 
        
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
            console.warn(`Data for month ${monthFullName} is missing or not an object in data.monthlyData.`);
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
        row.innerHTML = '<td colspan="7" style="text-align: center;">No leave applications found</td>';
        tableBody.appendChild(row);
        return;
    }

    applications.forEach(app => {
        const row = document.createElement('tr');
        
        // Add status-based styling
        row.classList.add(`status-${app.status.toLowerCase()}`);
        
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
        `;
        
        tableBody.appendChild(row);
    });
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
