// Dashboard functionality
document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication
    const username = localStorage.getItem('username');
    if (!username) {
        window.location.href = 'login.html';
        return;
    }
    
    // Set username and current date
    document.getElementById('username').textContent = username;
    document.getElementById('currentDate').textContent = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    // Load leave data
    await loadLeaveData();
    
    // Setup logout
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        await fetch('/api/logout', { method: 'POST' });
        localStorage.removeItem('username');
        window.location.href = 'login.html';
    });
});

async function loadLeaveData() {
    try {
        const response = await fetch('/api/leave-data');
        
        if (!response.ok) {
            if (response.status === 401) {
                window.location.href = 'login.html';
                return;
            }
            throw new Error('Failed to load data');
        }
        
        const result = await response.json();
        
        if (result.success) {
            displayLeaveData(result.data);
        } else {
            console.error('Failed to load leave data:', result.message);
        }
    } catch (error) {
        console.error('Error loading leave data:', error);
    }
}

function displayLeaveData(data) {
    // Update balance overview
    document.getElementById('totalLeave').textContent = data.totalLeave;
    document.getElementById('leaveTaken').textContent = data.leaveTaken;
    document.getElementById('leaveBalance').textContent = data.leaveBalance;
    document.getElementById('mcTaken').textContent = data.mcTaken;
    document.getElementById('mcBalance').textContent = data.mcBalance;
    
    // Update leave breakdown
    document.getElementById('carryForward').textContent = data.carryForward;
    document.getElementById('annualLeave').textContent = data.annualLeave;
    document.getElementById('compassionateLeave').textContent = data.compassionateLeave;
    
    // Update monthly table
    const monthlyTableBody = document.getElementById('monthlyTableBody');
    monthlyTableBody.innerHTML = '';
    
    const months = ['Jan', 'Feb', 'March', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
    
    months.forEach(month => {
        const row = document.createElement('tr');
        const monthData = data.monthlyData[month];
        
        // Highlight current month
        const currentMonth = new Date().toLocaleString('en-US', { month: 'short' });
        if (month === currentMonth || (month === 'March' && currentMonth === 'Mar')) {
            row.style.background = '#e3f2fd';
        }
        
        row.innerHTML = `
            <td>${month}</td>
            <td>${monthData.leave || 0}</td>
            <td>${monthData.mc || 0}</td>
        `;
        
        monthlyTableBody.appendChild(row);
    });
}
