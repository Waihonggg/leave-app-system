// Dashboard functionality
document.addEventListener('DOMContentLoaded', async () => {
    // Authentication: The server uses cookie-based sessions.
    // The /api/leave-data call will determine if the session is valid.
    // We don't strictly need localStorage for auth if the server handles it via sessions.
    // However, if you want to display the username from localStorage immediately, that's fine.
    const storedUsername = localStorage.getItem('username');
    const usernameDisplay = document.getElementById('username');

    if (usernameDisplay && storedUsername) {
        usernameDisplay.textContent = storedUsername; // Display username from localStorage if available
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
    
    // Load leave data - this call relies on the server's session cookie
    await loadLeaveData(); 
    
    // Setup logout
    const logoutButton = document.getElementById('logoutBtn');
    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            try {
                const response = await fetch('/api/logout', { method: 'POST' });
                const result = await response.json();
                localStorage.removeItem('username'); // Clear local storage on logout
                if (result.success) {
                    window.location.href = 'login.html'; // Or simply '/' if server redirects
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
        // This fetch relies on the browser sending the session cookie automatically.
        const response = await fetch('/api/leave-data'); 
        
        if (!response.ok) {
            if (response.status === 401) {
                console.warn('Unauthorized (401) when fetching /api/leave-data. Redirecting to login.');
                localStorage.removeItem('username'); // Clear potentially stale username
                window.location.href = 'login.html'; // Or '/'
                return;
            }
            // For other errors (500, 404, etc.)
            throw new Error(`Failed to load data. Status: ${response.status}`);
        }
        
        const result = await response.json();
        console.log("Data received from /api/leave-data:", result); // DEBUG: Inspect this in browser console

        if (result.success && result.data) {
            // Update username from server data if it's more reliable
            const usernameDisplay = document.getElementById('username');
            if (usernameDisplay && result.data.username) {
                 usernameDisplay.textContent = result.data.username;
                 // Optionally, re-save to localStorage if you want to keep it synced
                 // localStorage.setItem('username', result.data.username);
            }
            displayLeaveData(result.data);
        } else {
            console.error('API call to /api/leave-data was not successful or data is missing:', result.message);
            // Display an error message on the page
            alert('Could not load your leave data: ' + (result.message || 'Unknown error from server.'));
        }
    } catch (error) {
        console.error('Error in loadLeaveData function:', error);
        alert('An error occurred while trying to load your dashboard data. Please try logging in again.');
        // window.location.href = 'login.html'; // Optionally force re-login
    }
}

// Add this to your existing dashboard.js

function updateLeaveApplicationsTable(applications) {
    const tableBody = document.getElementById('leaveApplicationsBody');
    tableBody.innerHTML = '';

    applications.forEach(app => {
        const row = document.createElement('tr');
        
        // Add status-based styling
        row.classList.add(`status-${app.status.toLowerCase()}`);
        
        row.innerHTML = `
            <td>${app.id}</td>
            <td>${app.leaveType}</td>
            <td>${app.startDate}</td>
            <td>${app.endDate}</td>
            <td>${app.days}</td>
            <td>${app.reason}</td>
            <td>
                <span class="status-badge ${app.status.toLowerCase()}">
                    ${app.status}
                </span>
            </td>
        `;
        
        tableBody.appendChild(row);
    });
}
function displayLeaveData(data) {
    // Defensive checks for data object itself
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
    
    // Update monthly table
    const monthlyTableBody = document.getElementById('monthlyTableBody');
    if (!monthlyTableBody) {
        console.error("Element with ID 'monthlyTableBody' not found.");
        return;
    }
    monthlyTableBody.innerHTML = ''; // Clear previous rows
    
    const months = ['Jan', 'Feb', 'March', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
    const currentMonthShort = new Date().toLocaleString('en-US', { month: 'short' }); // e.g., "Mar"

    // CRITICAL CHECK: Ensure data.monthlyData exists and is an object
    if (!data.monthlyData || typeof data.monthlyData !== 'object') {
        console.warn('data.monthlyData is missing or not an object:', data.monthlyData);
        const row = monthlyTableBody.insertRow();
        const cell = row.insertCell();
        cell.colSpan = 3; // Month, Leave, MC
        cell.textContent = 'Monthly data is currently unavailable.';
        return; // Stop further processing of monthly table
    }
    
    months.forEach(monthFullName => { // e.g., monthFullName is "Jan", "Feb", "March"
        const row = document.createElement('tr');
        
        // data.monthlyData uses keys like "Jan", "Feb", "March" (as defined in server.js)
        const monthStats = data.monthlyData[monthFullName]; 
        
        // Highlight current month: Match full name or short name
        // The monthKey from server is full "March", currentMonthShort is "Mar"
        let isCurrentMonth = false;
        if (monthFullName.startsWith(currentMonthShort) || (monthFullName === "Sept" && currentMonthShort === "Sep")) { // "Sept" vs "Sep"
             isCurrentMonth = true;
        }


        if (isCurrentMonth) {
            row.style.backgroundColor = '#e3f2fd'; // Using backgroundColor for better compatibility
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
